import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { clearPlayerLiveStatus, getLiveBoard } from '../liveStatus';
import { isGameActive } from '../activity';
import { config } from '../config';
import { activeTrackingContexts, closeTrackingContext } from '../trackingContexts';
import { activePlayerGroupIds } from '../groups';

export const agentRouter = Router();

// The union of process names any of a player's active groups has mapped to a
// game. Both the allow-list endpoint below and the report handler use this:
// the agent filters its scan against it locally, and the server independently
// filters what it persists against it too, so an older/unpatched agent can
// never make an arbitrary process name show up in the admin diagnostics view.
function allowedProcessNames(groupIds: string[]): string[] {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT DISTINCT process_name FROM game_process_names WHERE group_id IN (${placeholders})`)
    .all(...groupIds) as Array<{ process_name: string }>;
  return rows.map((row) => row.process_name);
}

// GET /api/agent/process-names — the set of process names the agent is
// allowed to report at all. The agent fetches this before every scan and
// only sends names that match, so anything else currently running on the
// player's PC (browser, chat apps, ...) never leaves it in the first place.
agentRouter.get('/process-names', (req, res) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) return res.status(401).json({ error: 'API-Key fehlt (Header x-api-key).' });
  const player = db.prepare('SELECT id FROM players WHERE api_key = ? AND deactivated_at IS NULL').get(apiKey) as { id: string } | undefined;
  if (!player) return res.status(401).json({ error: 'Ungültiger API-Key.' });
  res.json({ processNames: allowedProcessNames(activePlayerGroupIds(player.id)) });
});

agentRouter.post('/report', (req, res) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) return res.status(401).json({ error: 'API-Key fehlt (Header x-api-key).' });
  const player = db.prepare('SELECT id, tracking_paused FROM players WHERE api_key = ? AND deactivated_at IS NULL').get(apiKey) as { id: string; tracking_paused: number } | undefined;
  if (!player) return res.status(401).json({ error: 'Ungültiger API-Key.' });
  const { processNames, agentVersion, foregroundProcessName, idleSeconds } = req.body ?? {};
  if (!Array.isArray(processNames) || !processNames.every((p) => typeof p === 'string')) return res.status(400).json({ error: 'processNames muss ein String-Array sein.' });
  if (foregroundProcessName !== undefined && foregroundProcessName !== null && typeof foregroundProcessName !== 'string') return res.status(400).json({ error: 'foregroundProcessName muss ein String oder null sein.' });
  if (idleSeconds !== undefined && idleSeconds !== null && typeof idleSeconds !== 'number') return res.status(400).json({ error: 'idleSeconds muss eine Zahl oder null sein.' });
  if (agentVersion !== undefined && agentVersion !== null && (typeof agentVersion !== 'string' || agentVersion.length > 64)) return res.status(400).json({ error: 'agentVersion muss ein kurzer String oder null sein.' });
  const normalized = [...new Set(processNames.map((p: string) => p.trim().toLowerCase()).filter(Boolean))];
  const foreground = typeof foregroundProcessName === 'string' && foregroundProcessName.trim() ? foregroundProcessName.trim().toLowerCase() : null;
  const idle = typeof idleSeconds === 'number' && Number.isFinite(idleSeconds) ? idleSeconds : null;
  const activityTracked = foregroundProcessName !== undefined;
  const now = Date.now();
  const groupIds = activePlayerGroupIds(player.id);
  // A current agent already only ever sends matched names (see the allow-list
  // endpoint above), but this filters again server-side so a stale agent that
  // hasn't picked up that behavior yet still can't leak arbitrary process
  // names into the diagnostics view or the database.
  const allowed = new Set(allowedProcessNames(groupIds));
  const diagnosticProcessNames = normalized.filter((name) => allowed.has(name));
  db.prepare(`INSERT INTO agent_diagnostics (player_id, agent_version, last_report_at, process_names) VALUES (?, ?, ?, ?)
    ON CONFLICT(player_id) DO UPDATE SET agent_version=excluded.agent_version, last_report_at=excluded.last_report_at, process_names=excluded.process_names`)
    .run(player.id, typeof agentVersion === 'string' && agentVersion.trim() ? agentVersion.trim() : null, now, JSON.stringify(diagnosticProcessNames));
  const contexts = player.tracking_paused ? [] : activeTrackingContexts(player.id, now);
  const previousContexts = db.prepare(
    'SELECT group_id, event_id FROM tracking_live_contexts WHERE player_id = ?',
  ).all(player.id) as Array<{ group_id: string; event_id: string | null }>;
  const affectedScopes = new Map<string, { groupId: string; eventId: string }>();
  for (const context of previousContexts) {
    if (context.event_id) affectedScopes.set(`${context.group_id}:${context.event_id}`, { groupId: context.group_id, eventId: context.event_id });
  }
  for (const context of contexts) {
    affectedScopes.set(`${context.groupId}:${context.eventId}`, { groupId: context.groupId, eventId: context.eventId });
  }

  const sync = db.transaction(() => {
    const wanted = new Set(contexts.map((c) => `${c.groupId}:${c.eventId ?? ''}`));
    for (const old of previousContexts) if (!wanted.has(`${old.group_id}:${old.event_id ?? ''}`)) closeTrackingContext(player.id, old.group_id, old.event_id, now);
    for (const context of contexts) {
      const eventId = context.eventId;
      const previous = db.prepare('SELECT last_seen FROM tracking_live_contexts WHERE player_id = ? AND group_id = ? AND event_id IS ?').get(player.id, context.groupId, eventId) as { last_seen: number } | undefined;
      const elapsed = previous ? Math.min(Math.max(0, now - previous.last_seen), config.offlineTimeoutMs) : 0;
      db.prepare(`INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, manual_note, activity_tracked) VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(player_id, group_id, event_id) DO UPDATE SET last_seen=excluded.last_seen, activity_tracked=excluded.activity_tracked`)
        .run(player.id, context.groupId, eventId, now, activityTracked ? 1 : 0);
      const placeholders = normalized.length ? normalized.map(() => '?').join(',') : "''";
      const matches = db.prepare(`SELECT DISTINCT game_id FROM game_process_names WHERE group_id = ? AND process_name IN (${placeholders})`).all(context.groupId, ...normalized) as Array<{ game_id: string }>;
      const matched = new Set(matches.map((m) => m.game_id));
      const oldGames = db.prepare('SELECT game_id FROM tracking_live_games WHERE player_id = ? AND group_id = ? AND event_id IS ?').all(player.id, context.groupId, eventId) as Array<{ game_id: string }>;
      for (const old of oldGames) if (!matched.has(old.game_id)) {
        db.prepare('DELETE FROM tracking_live_games WHERE player_id = ? AND group_id = ? AND event_id IS ? AND game_id = ?').run(player.id, context.groupId, eventId, old.game_id);
        db.prepare('UPDATE play_sessions SET ended_at = ? WHERE player_id = ? AND group_id = ? AND event_id = ? AND game_id = ? AND ended_at IS NULL').run(now, player.id, context.groupId, eventId, old.game_id);
      }
      let activeGame: string | null = null;
      if (foreground) {
        const owner = db.prepare('SELECT game_id FROM game_process_names WHERE group_id = ? AND process_name = ?').get(context.groupId, foreground) as { game_id: string } | undefined;
        if (owner && matched.has(owner.game_id)) {
          const names = db.prepare('SELECT process_name FROM game_process_names WHERE group_id = ? AND game_id = ?').all(context.groupId, owner.game_id) as Array<{ process_name: string }>;
          if (isGameActive(foreground, idle, names.map((n) => n.process_name))) activeGame = owner.game_id;
        }
      }
      for (const gameId of matched) {
        const existing = oldGames.some((g) => g.game_id === gameId);
        if (existing) db.prepare('UPDATE tracking_live_games SET is_foreground = ? WHERE player_id = ? AND group_id = ? AND event_id IS ? AND game_id = ?').run(gameId === activeGame ? 1 : 0, player.id, context.groupId, eventId, gameId);
        else {
          db.prepare('INSERT INTO tracking_live_games (player_id, group_id, event_id, game_id, since, is_foreground) VALUES (?, ?, ?, ?, ?, ?)').run(player.id, context.groupId, eventId, gameId, now, gameId === activeGame ? 1 : 0);
          db.prepare('INSERT INTO play_sessions (id, player_id, game_id, group_id, event_id, started_at, ended_at, allocation_weight) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').run(nanoid(), player.id, gameId, context.groupId, eventId, now, context.weight);
        }
      }
      if (activeGame && elapsed > 0) db.prepare('UPDATE play_sessions SET active_ms = active_ms + ? WHERE player_id = ? AND group_id = ? AND event_id = ? AND game_id = ? AND ended_at IS NULL').run(elapsed * context.weight, player.id, context.groupId, eventId, activeGame);
    }
  });
  sync();
  for (const { groupId, eventId } of affectedScopes.values()) {
    broadcast(Events.liveStatusChanged, getLiveBoard(groupId, eventId), { groupId, eventId });
  }
  const gameIds = [...new Set((db.prepare('SELECT game_id FROM tracking_live_games WHERE player_id = ?').all(player.id) as Array<{ game_id: string }>).map((row) => row.game_id))];
  res.json({ ok: true, playerId: player.id, gameIds, tracked: contexts.length > 0, trackingPaused: Boolean(player.tracking_paused) });
});

agentRouter.post('/tracking-paused', (req, res) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) return res.status(401).json({ error: 'API-Key fehlt (Header x-api-key).' });
  const player = db.prepare('SELECT id FROM players WHERE api_key = ? AND deactivated_at IS NULL').get(apiKey) as { id: string } | undefined;
  if (!player) return res.status(401).json({ error: 'Ungültiger API-Key.' });
  const { paused } = req.body ?? {};
  if (typeof paused !== 'boolean') return res.status(400).json({ error: 'paused muss ein Boolean sein.' });
  db.prepare('UPDATE players SET tracking_paused = ? WHERE id = ?').run(paused ? 1 : 0, player.id);
  if (paused) clearPlayerLiveStatus(player.id);
  for (const groupId of activePlayerGroupIds(player.id)) {
    broadcast(Events.playersChanged, null, { groupId });
  }
  res.json({ ok: true, trackingPaused: paused });
});
