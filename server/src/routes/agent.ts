// Agent-facing endpoint: each player's agent periodically reports the process
// names it currently sees running. The server does the process-name -> game
// matching (FR-10), so the mapping can be edited centrally without touching
// any agent. Authenticated by the player's own API key (NFR-15), NOT the
// shared UI access token — the agent only ever knows its server URL + key.
//
// A single PC can have several games running at once (e.g. a launcher plus
// the actual game, or two games side by side), so a report can match several
// games; the server syncs the player's active-games set to match exactly what
// was just reported.
//
// Optionally (only if the player's agent opted in via trackActivity), a
// report also carries which process has the focused window and how long
// since the last input, letting us credit "active" playtime (FR-29 extension)
// to at most one game per tick — only one window can be focused at a time.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';
import { isGameActive } from '../activity';
import { config } from '../config';

export const agentRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
}

// POST /api/agent/report
// Headers: x-api-key: <player's api key>
// Body: { processNames: string[], foregroundProcessName?: string|null, idleSeconds?: number|null }
agentRouter.post('/report', (req, res) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    return res.status(401).json({ error: 'API-Key fehlt (Header x-api-key).' });
  }

  const player = db.prepare('SELECT id, name FROM players WHERE api_key = ?').get(apiKey) as
    | PlayerRow
    | undefined;
  if (!player) {
    return res.status(401).json({ error: 'Ungültiger API-Key.' });
  }

  const { processNames, foregroundProcessName, idleSeconds } = req.body ?? {};
  if (!Array.isArray(processNames) || !processNames.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'processNames muss ein String-Array sein.' });
  }
  if (foregroundProcessName !== undefined && foregroundProcessName !== null && typeof foregroundProcessName !== 'string') {
    return res.status(400).json({ error: 'foregroundProcessName muss ein String oder null sein.' });
  }
  if (idleSeconds !== undefined && idleSeconds !== null && typeof idleSeconds !== 'number') {
    return res.status(400).json({ error: 'idleSeconds muss eine Zahl oder null sein.' });
  }

  const normalized = [...new Set(processNames.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const normalizedForeground =
    typeof foregroundProcessName === 'string' && foregroundProcessName.trim()
      ? foregroundProcessName.trim().toLowerCase()
      : null;
  const normalizedIdleSeconds = typeof idleSeconds === 'number' && Number.isFinite(idleSeconds) ? idleSeconds : null;

  // A report can match several distinct games at once (e.g. cs2.exe AND
  // rocketleague.exe both running).
  let matchedGameIds: string[] = [];
  if (normalized.length > 0) {
    const placeholders = normalized.map(() => '?').join(',');
    const matches = db
      .prepare(`SELECT DISTINCT game_id FROM game_process_names WHERE process_name IN (${placeholders})`)
      .all(...normalized) as Array<{ game_id: string }>;
    matchedGameIds = matches.map((m) => m.game_id);
  }

  // Which (if any) currently-matched game is the one actually being played
  // right now, per the optional foreground/idle signal.
  let activeGameId: string | null = null;
  if (normalizedForeground) {
    const owningGame = db
      .prepare('SELECT game_id FROM game_process_names WHERE process_name = ?')
      .get(normalizedForeground) as { game_id: string } | undefined;
    if (owningGame && matchedGameIds.includes(owningGame.game_id)) {
      const gameProcessNames = db
        .prepare('SELECT process_name FROM game_process_names WHERE game_id = ?')
        .all(owningGame.game_id) as Array<{ process_name: string }>;
      if (
        isGameActive(
          normalizedForeground,
          normalizedIdleSeconds,
          gameProcessNames.map((p) => p.process_name)
        )
      ) {
        activeGameId = owningGame.game_id;
      }
    }
  }

  const now = Date.now();

  const sync = db.transaction(() => {
    const previous = db.prepare('SELECT last_seen FROM live_status WHERE player_id = ?').get(player.id) as
      | { last_seen: number }
      | undefined;
    // How long since the last report, capped so a long gap (agent was down,
    // player reconnected) doesn't get misattributed as active playtime.
    const elapsedMs = previous ? Math.min(now - previous.last_seen, config.offlineTimeoutMs) : 0;

    db.prepare(
      `INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, NULL)
       ON CONFLICT(player_id) DO UPDATE SET last_seen = excluded.last_seen`
    ).run(player.id, now);

    const existing = db
      .prepare('SELECT game_id FROM live_status_games WHERE player_id = ?')
      .all(player.id) as Array<{ game_id: string }>;
    const existingIds = new Set(existing.map((e) => e.game_id));
    const matchedIds = new Set(matchedGameIds);

    // Games no longer detected: remove, and close their open play_sessions
    // row (FR-29) so total playtime stops accumulating for it.
    for (const gameId of existingIds) {
      if (!matchedIds.has(gameId)) {
        db.prepare('DELETE FROM live_status_games WHERE player_id = ? AND game_id = ?').run(
          player.id,
          gameId
        );
        db.prepare(
          `UPDATE play_sessions SET ended_at = ?
           WHERE player_id = ? AND game_id = ? AND ended_at IS NULL`
        ).run(now, player.id, gameId);
      }
    }
    // Newly detected games: add with since=now, and open a play_sessions row.
    // Games still running keep their original "since" untouched (no-op).
    for (const gameId of matchedIds) {
      if (!existingIds.has(gameId)) {
        db.prepare(
          'INSERT INTO live_status_games (player_id, game_id, since) VALUES (?, ?, ?)'
        ).run(player.id, gameId, now);
        db.prepare(
          'INSERT INTO play_sessions (id, player_id, game_id, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)'
        ).run(nanoid(), player.id, gameId, now);
      }
    }

    // Credit the elapsed time since the last report to whichever game was
    // actually focused+active this tick (at most one, since only one window
    // can have focus).
    if (activeGameId && elapsedMs > 0) {
      db.prepare(
        `UPDATE play_sessions SET active_ms = active_ms + ?
         WHERE player_id = ? AND game_id = ? AND ended_at IS NULL`
      ).run(elapsedMs, player.id, activeGameId);
    }
  });
  sync();

  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json({ ok: true, playerId: player.id, gameIds: matchedGameIds });
});
