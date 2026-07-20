// Player management: create/rename/recolor/delete participants. Each player
// gets a private API key used by their agent to report live status (FR-06).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, disconnectPlayerSockets, Events } from '../realtime';
import { isNonEmptyString, isHexColor, isValidAvatar } from '../validation';
import { getTrackingEventId } from '../events';
import { formatDurationMs, computePlaytime, type PlaySession } from '../playtime';
import { sessionDurations, computeSimultaneousGameTime, type SessionDuration } from '../sessionStats';
import { computeAwards } from '../awards';
import { hasRecentReauthentication, requireConfiguredUser, withParamPlayerIdentity } from '../sessions';
import { requireAdmin } from '../auth';
import { clearPlayerLiveStatus, getLiveBoard } from '../liveStatus';
import { writeAdminAudit } from '../adminAudit';
import { voidOutstandingInvites } from '../invites';
import { activeGroupPlayers } from '../groupPlayers';
import { activePlayerGroupIds } from '../groups';
import { resolveGroupEventScope } from '../groupEventScope';
import { config } from '../config';

export const playersRouter = Router();

const DEFAULT_COLOR = '#4f9dff';

interface PlayerRow {
  id: string;
  name: string;
  real_name: string | null;
  color: string;
  avatar: string | null;
  api_key: string;
  tracking_paused: number;
  is_admin: number;
  is_test: number;
  deactivated_at: number | null;
  created_at: number;
  agent_last_seen?: number | null;
  password_hash?: string | null;
  last_login_at?: number | null;
}

// realName is optional and clearable (unlike the required gamer `name`): a
// missing field leaves it untouched, null or an all-whitespace string clears
// it, anything else must pass the same 1-60 char check as other free-text
// names.
function resolveRealName(realName: unknown, existing: string | null): string | null | { error: string } {
  if (realName === undefined) return existing;
  if (realName === null || (typeof realName === 'string' && realName.trim() === '')) return null;
  if (!isNonEmptyString(realName)) return { error: 'Richtiger Name muss 1-60 Zeichen lang sein.' };
  return realName.trim();
}

// Case-insensitive lookup used to give a friendly 409 instead of letting the
// unique index throw a raw SQLite constraint error up to the client.
function nameTaken(name: string, excludingId?: string): boolean {
  const row = db
    .prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, excludingId ?? '') as { id: string } | undefined;
  return Boolean(row);
}

function toPublicPlayer(row: PlayerRow) {
  // The API key is left out of bulk listings so a glance at the roster can't
  // be used to spoof someone else's live status; it's only returned when a
  // client explicitly asks for that one player (their own profile).
  const { api_key: _apiKey, password_hash: _passwordHash, last_login_at: _lastLoginAt, ...rest } = row;
  return rest;
}

function toPrivatePlayer(row: PlayerRow) {
  const { password_hash: _passwordHash, last_login_at: _lastLoginAt, ...rest } = row;
  return rest;
}

// GET /api/players - roster without API keys.
playersRouter.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM players WHERE deactivated_at IS NULL ORDER BY name COLLATE NOCASE')
    .all() as PlayerRow[];
  res.json(rows.map(toPublicPlayer));
});

// GET /api/players/:id - public profile details for everyone. Under required
// auth the private agent API key is only visible to its owner or an admin;
// legacy mode reveals it only to the matching device identity.
playersRouter.get('/:id', requireConfiguredUser, (req, res) => {
  const row = db
    .prepare(
      `SELECT p.*, ls.last_seen AS agent_last_seen
     FROM players p LEFT JOIN live_status ls ON ls.player_id = p.id
     WHERE p.id = ?`,
    )
    .get(req.params.id) as PlayerRow | undefined;
  if (!row) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (row.deactivated_at !== null && !req.player?.is_admin) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  const maySeeApiKey = req.player
    ? req.player.id === row.id || Boolean(req.player.is_admin)
    : req.header('x-player-id') === row.id;
  res.json(maySeeApiKey ? toPrivatePlayer(row) : toPublicPlayer(row));
});

// POST /api/players - create a player. Returns the API key once here (and via
// the single-player GET) so the frontend can show/copy it.
playersRouter.post('/', requireConfiguredUser, (req, res) => {
  if (req.player && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur Admins können weitere Spielerprofile anlegen.' });
  }
  const { name, realName, color, avatar } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-60 Zeichen).' });
  }
  const resolvedRealName = resolveRealName(realName, null);
  if (resolvedRealName !== null && typeof resolvedRealName === 'object') {
    return res.status(400).json(resolvedRealName);
  }
  if (color !== undefined && !isHexColor(color)) {
    return res.status(400).json({ error: 'Farbe muss ein Hex-Code sein, z.B. #4f9dff.' });
  }
  if (avatar !== undefined && avatar !== null && !isValidAvatar(avatar)) {
    return res.status(400).json({ error: 'Ungültiges Bildformat.' });
  }
  const trimmedName = name.trim();
  if (nameTaken(trimmedName)) {
    return res.status(409).json({ error: `Der Name "${trimmedName}" ist schon vergeben.` });
  }

  const row: PlayerRow = {
    id: nanoid(),
    name: trimmedName,
    real_name: resolvedRealName,
    color: color ?? DEFAULT_COLOR,
    avatar: avatar ?? null,
    api_key: nanoid(24),
    tracking_paused: 0,
    // New players are regular participants until an existing admin grants
    // the moderation flag. Arcade AI matches rely on this flag too.
    is_admin: 0,
    is_test: 0,
    deactivated_at: null,
    created_at: Date.now(),
  };

  db.prepare(
    'INSERT INTO players (id, name, real_name, color, avatar, api_key, tracking_paused, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.id,
    row.name,
    row.real_name,
    row.color,
    row.avatar,
    row.api_key,
    row.tracking_paused,
    row.is_admin,
    row.created_at,
  );

  broadcast(Events.playersChanged, null, { groupId: req.group!.id });
  res.status(201).json(row);
});

// PATCH /api/players/:id - rename, recolor, update the avatar, and/or
// pause/resume tracking. Profile fields may only be changed by the device
// identity currently assigned to that player. The x-player-id header is the
// temporary identity boundary until future user management replaces the
// device-local "who am I" selection with authenticated sessions.
// trackingPaused is the player-side opt-out: while
// true, the agent's reports for this player are received but silently
// dropped (see routes/agent.ts) — no live status, no playtime, regardless
// of whether an event is tracking.
playersRouter.patch('/:id', requireConfiguredUser, (req, res) => {
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as PlayerRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  if (req.player && req.player.id !== existing.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Du kannst nur dein eigenes Profil bearbeiten.' });
  }

  const { name, realName, color, avatar, trackingPaused, isAdmin } = req.body ?? {};
  const changesProfile = [name, realName, color, avatar, trackingPaused].some((value) => value !== undefined);
  if (changesProfile && req.header('x-player-id') !== existing.id) {
    return res.status(403).json({ error: 'Du kannst nur dein eigenes Profil bearbeiten.' });
  }
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name muss 1-60 Zeichen lang sein.' });
  }
  const nextRealName = resolveRealName(realName, existing.real_name);
  if (nextRealName !== null && typeof nextRealName === 'object') {
    return res.status(400).json(nextRealName);
  }
  if (color !== undefined && !isHexColor(color)) {
    return res.status(400).json({ error: 'Farbe muss ein Hex-Code sein, z.B. #4f9dff.' });
  }
  if (avatar !== undefined && avatar !== null && !isValidAvatar(avatar)) {
    return res.status(400).json({ error: 'Ungültiges Bildformat.' });
  }
  if (trackingPaused !== undefined && typeof trackingPaused !== 'boolean') {
    return res.status(400).json({ error: 'trackingPaused muss ein Boolean sein.' });
  }
  if (isAdmin !== undefined && typeof isAdmin !== 'boolean') {
    return res.status(400).json({ error: 'isAdmin muss ein Boolean sein.' });
  }
  if (req.player && isAdmin !== undefined && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur Admins können Rollen ändern.' });
  }
  if (isAdmin === true && existing.is_test) {
    return res.status(409).json({ error: 'Test-Spieler können keine Admin-Rechte erhalten.' });
  }
  if (
    req.player &&
    isAdmin !== undefined &&
    Number(isAdmin) !== existing.is_admin &&
    !hasRecentReauthentication(req.sessionId)
  ) {
    return res.status(403).json({
      error: 'Bitte bestätige dein Passwort, bevor du Rollen änderst.',
      code: 'reauth_required',
    });
  }
  // Granting/revoking admin remains an admin-panel action in the UI; the
  // endpoint keeps the existing trusted-friend-group API shape.

  const nextName = name !== undefined ? name.trim() : existing.name;
  if (name !== undefined && nameTaken(nextName, existing.id)) {
    return res.status(409).json({ error: `Der Name "${nextName}" ist schon vergeben.` });
  }
  const nextColor = color !== undefined ? color : existing.color;
  const nextAvatar = avatar !== undefined ? avatar : existing.avatar;
  const nextTrackingPaused = trackingPaused !== undefined ? (trackingPaused ? 1 : 0) : existing.tracking_paused;
  const nextIsAdmin = isAdmin !== undefined ? (isAdmin ? 1 : 0) : existing.is_admin;

  const roleChanged = nextIsAdmin !== existing.is_admin;
  const update = db.transaction(() => {
    if (roleChanged && existing.is_admin && nextIsAdmin === 0) {
      const adminCount = (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM players WHERE is_admin = 1 AND deactivated_at IS NULL AND (? = 0 OR password_hash IS NOT NULL)',
          )
          .get(req.player ? 1 : 0) as {
          count: number;
        }
      ).count;
      if (adminCount <= 1) return false;
    }
    db.prepare(
      'UPDATE players SET name = ?, real_name = ?, color = ?, avatar = ?, tracking_paused = ?, is_admin = ? WHERE id = ?',
    ).run(nextName, nextRealName, nextColor, nextAvatar, nextTrackingPaused, nextIsAdmin, existing.id);
    if (roleChanged) {
      writeAdminAudit({
        actorPlayerId: req.player?.id,
        action: nextIsAdmin ? 'admin_granted' : 'admin_revoked',
        targetType: 'player',
        targetId: existing.id,
      });
    }
    return true;
  })();
  if (!update) return res.status(409).json({ error: 'Der letzte Admin kann seine Rolle nicht verlieren.' });

  // Profile changes are visible in every group the player belongs to, not
  // only in the tab the request happened to come from.
  for (const groupId of activePlayerGroupIds(existing.id)) {
    broadcast(Events.playersChanged, null, { groupId });
  }
  if (roleChanged) disconnectPlayerSockets(existing.id);
  res.json(
    toPrivatePlayer({
      ...existing,
      name: nextName,
      real_name: nextRealName,
      color: nextColor,
      avatar: nextAvatar,
      tracking_paused: nextTrackingPaused,
      is_admin: nextIsAdmin,
    }),
  );
});

playersRouter.post('/:id/deactivate', requireAdmin, (req, res) => {
  if (req.player && !hasRecentReauthentication(req.sessionId)) {
    return res.status(403).json({
      error: 'Bitte bestätige dein Passwort, bevor du ein Konto deaktivierst.',
      code: 'reauth_required',
    });
  }
  const target = db
    .prepare('SELECT id, is_admin, is_test, deactivated_at FROM players WHERE id = ?')
    .get(req.params.id) as Pick<PlayerRow, 'id' | 'is_admin' | 'is_test' | 'deactivated_at'> | undefined;
  if (!target) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (target.is_test) return res.status(409).json({ error: 'Test-Spieler werden vollständig gelöscht.' });
  if (target.deactivated_at !== null) return res.status(409).json({ error: 'Dieses Konto ist bereits deaktiviert.' });

  const now = Date.now();
  const deactivated = db.transaction((): 'ok' | 'last_admin' | 'last_group_owner' => {
    if (target.is_admin) {
      const adminCount = (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM players WHERE is_admin = 1 AND deactivated_at IS NULL AND (? = 0 OR password_hash IS NOT NULL)',
          )
          .get(req.player ? 1 : 0) as {
          count: number;
        }
      ).count;
      if (adminCount <= 1) return 'last_admin';
    }
    const soleOwnedGroup = db
      .prepare(
        `SELECT gm.group_id
         FROM group_memberships gm
         JOIN groups g ON g.id = gm.group_id AND g.archived_at IS NULL
         WHERE gm.player_id = ? AND gm.status = 'active' AND gm.role = 'owner'
           AND NOT EXISTS (
             SELECT 1
             FROM group_memberships other
             JOIN players p ON p.id = other.player_id
             WHERE other.group_id = gm.group_id AND other.player_id != gm.player_id
               AND other.status = 'active' AND other.role = 'owner' AND p.deactivated_at IS NULL
           )
         LIMIT 1`,
      )
      .get(target.id);
    if (soleOwnedGroup) return 'last_group_owner';
    db.prepare('UPDATE players SET deactivated_at = ?, is_admin = 0, tracking_paused = 1 WHERE id = ?').run(
      now,
      target.id,
    );
    db.prepare('DELETE FROM sessions WHERE player_id = ?').run(target.id);
    db.prepare('DELETE FROM push_subscriptions WHERE player_id = ?').run(target.id);
    db.prepare('DELETE FROM agent_diagnostics WHERE player_id = ?').run(target.id);
    clearPlayerLiveStatus(target.id, now);
    voidOutstandingInvites(target.id, 'claim');
    voidOutstandingInvites(target.id, 'reset');
    writeAdminAudit({
      actorPlayerId: req.player?.id,
      action: 'player_deactivated',
      targetType: 'player',
      targetId: target.id,
    });
    return 'ok';
  })();
  if (deactivated === 'last_admin') {
    return res.status(409).json({ error: 'Der letzte Admin kann nicht deaktiviert werden.' });
  }
  if (deactivated === 'last_group_owner') {
    return res.status(409).json({ error: 'Der letzte aktive Owner einer Gruppe kann nicht deaktiviert werden.' });
  }
  disconnectPlayerSockets(target.id);
  // Memberships survive deactivation (only current access ends), so they
  // still name every group whose roster and live board just changed.
  for (const groupId of activePlayerGroupIds(target.id)) {
    broadcast(Events.playersChanged, null, { groupId });
    // live:changed carries the fresh board — clients assign the payload to
    // their state directly and do not treat null as a reload signal.
    broadcast(Events.liveStatusChanged, getLiveBoard(groupId), { groupId });
  }
  res.status(204).end();
});

playersRouter.post('/:id/reactivate', requireAdmin, (req, res) => {
  if (req.player && !hasRecentReauthentication(req.sessionId)) {
    return res.status(403).json({
      error: 'Bitte bestätige dein Passwort, bevor du ein Konto reaktivierst.',
      code: 'reauth_required',
    });
  }
  const result = db
    .prepare('UPDATE players SET deactivated_at = NULL WHERE id = ? AND deactivated_at IS NOT NULL')
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Deaktiviertes Konto nicht gefunden.' });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    action: 'player_reactivated',
    targetType: 'player',
    targetId: req.params.id,
  });
  for (const groupId of activePlayerGroupIds(req.params.id)) {
    broadcast(Events.playersChanged, null, { groupId });
  }
  res.status(204).end();
});

playersRouter.post('/:id/api-key/rotate', requireConfiguredUser, (req, res) => {
  const target = db.prepare('SELECT id, deactivated_at FROM players WHERE id = ?').get(req.params.id) as
    { id: string; deactivated_at: number | null } | undefined;
  if (!target || target.deactivated_at !== null) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (req.player && req.player.id !== target.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Du kannst nur deinen eigenen Agent-Key erneuern.' });
  }
  if (req.player?.is_admin && req.player.id !== target.id && !hasRecentReauthentication(req.sessionId)) {
    return res.status(403).json({ error: 'Bitte bestätige dein Passwort.', code: 'reauth_required' });
  }
  const apiKey = nanoid(24);
  db.prepare('UPDATE players SET api_key = ? WHERE id = ?').run(apiKey, target.id);
  clearPlayerLiveStatus(target.id);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    action: 'api_key_rotated',
    targetType: 'player',
    targetId: target.id,
  });
  for (const groupId of activePlayerGroupIds(target.id)) {
    broadcast(Events.liveStatusChanged, getLiveBoard(groupId), { groupId });
  }
  res.json({ apiKey });
});

// Hard-delete is intentionally limited to disposable test identities. Real
// participants are deactivated so historical matches and statistics remain.
playersRouter.delete('/:id', requireAdmin, (req, res) => {
  if (req.player && !hasRecentReauthentication(req.sessionId)) {
    return res.status(403).json({ error: 'Bitte bestätige dein Passwort.', code: 'reauth_required' });
  }
  const target = db.prepare('SELECT is_test FROM players WHERE id = ?').get(req.params.id) as
    { is_test: number } | undefined;
  if (!target) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (!target.is_test) return res.status(409).json({ error: 'Echte Spieler werden deaktiviert statt gelöscht.' });
  // Resolved before the delete: afterwards the membership rows are gone and
  // could no longer name the groups whose roster just lost this test player.
  const affectedGroupIds = activePlayerGroupIds(req.params.id);
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  disconnectPlayerSockets(req.params.id);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    action: 'test_player_deleted',
    targetType: 'player',
    targetId: req.params.id,
  });
  for (const groupId of affectedGroupIds) {
    broadcast(Events.playersChanged, null, { groupId });
  }
  res.status(204).end();
});

// GET /api/players/:id/neighbors - whose monitor this player says they can
// see ("Sichtbare Monitore" in the UI), for the given (or active) event.
// Includes both rows the seating-plan editor auto-derived from same-edge seat
// adjacency and ones the player checked themselves — see seat_neighbors'
// source column in db.ts. Self-service, so this is always scoped to a single
// player, never a roster-wide listing.
playersRouter.get('/:id/neighbors', ...withParamPlayerIdentity('id'), (req, res) => {
  if (!activeGroupPlayers(req.group!.id, [req.params.id]).has(req.params.id)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }

  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

  const rows = db
    .prepare('SELECT neighbor_id FROM seat_neighbors WHERE group_id = ? AND event_id IS ? AND player_id = ?')
    .all(req.group!.id, scope.eventId, req.params.id) as Array<{ neighbor_id: string }>;

  res.json({ groupId: req.group!.id, eventId: scope.eventId, neighborIds: rows.map((r) => r.neighbor_id) });
});

// PUT /api/players/:id/neighbors - replace whose monitor this player says
// they can see for an event, in one shot (like skills.set, meant to be called
// fire-and-forget straight off a checkbox list). Always writes source =
// 'manual', even for ids that were previously auto-derived from the seating
// plan — once a player has touched their own list, it's an explicit
// confirmation and the next seating-plan save won't override it. Body:
// { eventId?, neighborIds: string[] }
playersRouter.put('/:id/neighbors', ...withParamPlayerIdentity('id'), (req, res) => {
  const player = activeGroupPlayers(req.group!.id, [req.params.id]).get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { eventId, neighborIds } = req.body ?? {};
  if (!Array.isArray(neighborIds) || !neighborIds.every((n) => typeof n === 'string')) {
    return res.status(400).json({ error: 'neighborIds muss ein String-Array sein.' });
  }
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

  // Silently drop yourself and anything that isn't actually a player, rather
  // than erroring — a stale id from a checkbox list a moment after someone
  // else got deleted shouldn't block saving the rest.
  const uniqueIds = [...new Set(neighborIds)].filter((id) => id !== player.id);
  const validPlayers = activeGroupPlayers(req.group!.id, uniqueIds);
  if (config.authMode !== 'legacy' && validPlayers.size !== uniqueIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }
  const validIds = [...validPlayers.keys()];

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM seat_neighbors WHERE group_id = ? AND event_id IS ? AND player_id = ?').run(
      req.group!.id,
      scope.eventId,
      player.id,
    );
    const insert = db.prepare(
      `INSERT INTO seat_neighbors
         (group_id, event_id, player_id, neighbor_id, player_name_snapshot, neighbor_name_snapshot, source)
       VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
    );
    for (const neighborId of validIds) {
      insert.run(
        req.group!.id,
        scope.eventId,
        player.id,
        neighborId,
        player.name,
        validPlayers.get(neighborId)!.name,
      );
    }
  });
  replace();

  res.json({ groupId: req.group!.id, eventId: scope.eventId, neighborIds: validIds });
});

interface GameRow {
  id: string;
  name: string;
  icon: string;
}
interface EventRow {
  id: string;
  name: string;
  starts_at: number;
}
interface SessionRow {
  player_id: string;
  game_id: string;
  event_id: string;
  started_at: number;
  ended_at: number | null;
  active_ms: number;
}

// GET /api/players/:id/stats - "my own stats": per-game and per-event
// breakdown, multitasking/AFK ratio, longest sessions, and any awards this
// player holds. Optionally narrowed to one ?eventId=. Read-only and not
// ownership-gated for the same reason the rest of this API isn't (see
// PATCH above) — it's just as visible to everyone as the roster already is.
playersRouter.get('/:id/stats', ...withParamPlayerIdentity('id'), (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as PlayerRow | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' ? eventId : null;
  const now = Date.now();

  const ownClauses = ['player_id = ?', 'group_id = ?'];
  const ownParams: string[] = [player.id, req.group!.id];
  if (filterEventId) {
    ownClauses.push('event_id = ?');
    ownParams.push(filterEventId);
  }
  const ownRows = db
    .prepare(
      `SELECT player_id, game_id, event_id, started_at, ended_at, active_ms FROM play_sessions WHERE ${ownClauses.join(' AND ')}`,
    )
    .all(...ownParams) as SessionRow[];

  const ownSessions: PlaySession[] = ownRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));

  const gameIds = [...new Set(ownRows.map((r) => r.game_id))];
  const eventIds = [...new Set(ownRows.map((r) => r.event_id))];
  let games: GameRow[] = [];
  if (gameIds.length > 0) {
    const ph = gameIds.map(() => '?').join(',');
    games = db
      .prepare(`SELECT id, name, icon FROM games WHERE id IN (${ph}) AND (group_id = ? OR arcade_key IS NOT NULL)`)
      .all(...gameIds, req.group!.id) as GameRow[];
  }
  let events: EventRow[] = [];
  if (eventIds.length > 0) {
    const ph = eventIds.map(() => '?').join(',');
    events = db
      .prepare(`SELECT id, name, starts_at FROM events WHERE id IN (${ph}) ORDER BY starts_at DESC`)
      .all(...eventIds) as EventRow[];
  }
  const gameById = new Map(games.map((g) => [g.id, g]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const perGame = computePlaytime(ownSessions, now);
  const gamesBreakdown = perGame.map((e) => ({
    gameId: e.gameId,
    gameName: gameById.get(e.gameId)?.name ?? 'Unbekannt',
    gameIcon: gameById.get(e.gameId)?.icon ?? '🎮',
    totalMs: e.totalMs,
    formatted: formatDurationMs(e.totalMs),
    activeMs: e.activeMs,
    activeFormatted: formatDurationMs(e.activeMs),
  }));

  const byEvent = new Map<string, { totalMs: number; activeMs: number }>();
  for (const r of ownRows) {
    const end = r.ended_at ?? now;
    const durationMs = Math.max(0, end - r.started_at);
    const cur = byEvent.get(r.event_id) ?? { totalMs: 0, activeMs: 0 };
    cur.totalMs += durationMs;
    cur.activeMs = Math.min(cur.activeMs + r.active_ms, cur.totalMs);
    byEvent.set(r.event_id, cur);
  }
  const eventsBreakdown = [...byEvent.entries()]
    .map(([id, v]) => ({
      eventId: id,
      eventName: eventById.get(id)?.name ?? 'Unbekannt',
      startsAt: eventById.get(id)?.starts_at ?? 0,
      totalMs: v.totalMs,
      formatted: formatDurationMs(v.totalMs),
      activeMs: v.activeMs,
      activeFormatted: formatDurationMs(v.activeMs),
    }))
    .sort((a, b) => b.startsAt - a.startsAt);

  function enrichDuration(d: SessionDuration) {
    return {
      gameId: d.gameId,
      gameName: gameById.get(d.gameId)?.name ?? 'Unbekannt',
      gameIcon: gameById.get(d.gameId)?.icon ?? '🎮',
      startedAt: d.startedAt,
      endedAt: d.endedAt,
      durationMs: d.durationMs,
      formatted: formatDurationMs(d.durationMs),
    };
  }
  const longestSessions = sessionDurations(ownSessions, now).slice(0, 5).map(enrichDuration);

  const overlap = computeSimultaneousGameTime(ownSessions, now)[0];
  const simultaneous = {
    multiGameMs: overlap?.multiGameMs ?? 0,
    multiGameFormatted: formatDurationMs(overlap?.multiGameMs ?? 0),
    maxSimultaneous: overlap?.maxSimultaneous ?? 0,
  };

  const totalMs = perGame.reduce((sum, e) => sum + e.totalMs, 0);
  const activeMs = perGame.reduce((sum, e) => sum + e.activeMs, 0);
  const activePercent = totalMs > 0 && activeMs > 0 ? Math.round((activeMs / totalMs) * 100) : null;

  // Awards are computed across everyone (a "record" only means something
  // relative to the rest of the group), then filtered down to this player's.
  const allClauses: string[] = ['group_id = ?'];
  const allParams: string[] = [req.group!.id];
  if (filterEventId) {
    allClauses.push('event_id = ?');
    allParams.push(filterEventId);
  }
  const allRows = db
    .prepare(`SELECT player_id, game_id, started_at, ended_at, active_ms FROM play_sessions WHERE ${allClauses.join(' AND ')}`)
    .all(...allParams) as SessionRow[];
  const allSessions: PlaySession[] = allRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));
  const myAwards = computeAwards(allSessions, now)
    .filter((a) => a.playerId === player.id)
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      value:
        a.valueMs !== undefined
          ? formatDurationMs(a.valueMs)
          : a.valuePercent !== undefined
            ? `${a.valuePercent}%`
            : `${a.valueCount}`,
    }));

  res.json({
    playerId: player.id,
    playerName: player.name,
    eventId: filterEventId,
    totalMs,
    formatted: formatDurationMs(totalMs),
    activeMs,
    activeFormatted: formatDurationMs(activeMs),
    activePercent,
    sessionCount: ownRows.length,
    distinctGamesCount: gameIds.length,
    games: gamesBreakdown,
    events: eventsBreakdown,
    longestSessions,
    simultaneous,
    awards: myAwards,
  });
});
