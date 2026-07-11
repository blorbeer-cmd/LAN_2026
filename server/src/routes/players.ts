// Player management: create/rename/recolor/delete participants. Each player
// gets a private API key used by their agent to report live status (FR-06).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString, isHexColor, isValidAvatar } from '../validation';
import { adminUnlockValid } from '../auth';
import { getTrackingEventId } from '../events';
import { formatDurationMs, computePlaytime, type PlaySession } from '../playtime';
import {
  sessionDurations,
  computeSimultaneousGameTime,
  type SessionDuration,
} from '../sessionStats';
import { computeAwards } from '../awards';

export const playersRouter = Router();

const DEFAULT_COLOR = '#4f9dff';

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  api_key: string;
  tracking_paused: number;
  is_admin: number;
  created_at: number;
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
  const { api_key: _apiKey, ...rest } = row;
  return rest;
}

// GET /api/players - roster without API keys.
playersRouter.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE')
    .all() as PlayerRow[];
  res.json(rows.map(toPublicPlayer));
});

// GET /api/players/:id - single player including their API key.
playersRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!row) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  res.json(row);
});

// POST /api/players - create a player. Returns the API key once here (and via
// the single-player GET) so the frontend can show/copy it.
playersRouter.post('/', (req, res) => {
  const { name, color, avatar } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-60 Zeichen).' });
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
    color: color ?? DEFAULT_COLOR,
    avatar: avatar ?? null,
    api_key: nanoid(24),
    tracking_paused: 0,
    is_admin: 0,
    created_at: Date.now(),
  };

  db.prepare(
    'INSERT INTO players (id, name, color, avatar, api_key, tracking_paused, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(row.id, row.name, row.color, row.avatar, row.api_key, row.tracking_paused, row.is_admin, row.created_at);

  broadcast(Events.playersChanged, null);
  res.status(201).json(row);
});

// PATCH /api/players/:id - rename, recolor, update the avatar, and/or
// pause/resume tracking. Also used by players managing their own profile
// (no separate ownership check — this tool trusts the friend group it's
// built for; see auth.ts). trackingPaused is the player-side opt-out: while
// true, the agent's reports for this player are received but silently
// dropped (see routes/agent.ts) — no live status, no playtime, regardless
// of whether an event is tracking.
playersRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { name, color, avatar, trackingPaused, isAdmin } = req.body ?? {};
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name muss 1-60 Zeichen lang sein.' });
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
  // Self-service fields (name/color/avatar/tracking) stay open in the LAN
  // trust model, but granting/revoking admin is an admin-only action: when a
  // PIN is configured it must be supplied. Open mode (no PIN) allows it.
  if (isAdmin !== undefined && !adminUnlockValid(req.header('x-admin-pin'))) {
    return res.status(403).json({ error: 'Admin-Rechte ändern ist nur Admins erlaubt.' });
  }

  const nextName = name !== undefined ? name.trim() : existing.name;
  if (name !== undefined && nameTaken(nextName, existing.id)) {
    return res.status(409).json({ error: `Der Name "${nextName}" ist schon vergeben.` });
  }
  const nextColor = color !== undefined ? color : existing.color;
  const nextAvatar = avatar !== undefined ? avatar : existing.avatar;
  const nextTrackingPaused = trackingPaused !== undefined ? (trackingPaused ? 1 : 0) : existing.tracking_paused;
  const nextIsAdmin = isAdmin !== undefined ? (isAdmin ? 1 : 0) : existing.is_admin;

  db.prepare('UPDATE players SET name = ?, color = ?, avatar = ?, tracking_paused = ?, is_admin = ? WHERE id = ?').run(
    nextName,
    nextColor,
    nextAvatar,
    nextTrackingPaused,
    nextIsAdmin,
    existing.id
  );

  broadcast(Events.playersChanged, null);
  res.json({
    ...existing,
    name: nextName,
    color: nextColor,
    avatar: nextAvatar,
    tracking_paused: nextTrackingPaused,
    is_admin: nextIsAdmin,
  });
});

// DELETE /api/players/:id - removes the player and cascades to their skills/
// live status/votes (enforced by SQLite foreign keys).
playersRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  broadcast(Events.playersChanged, null);
  res.status(204).end();
});

// GET /api/players/:id/neighbors - whose monitor this player says they can
// see ("Sichtbare Monitore" in the UI), for the given (or active) event.
// Includes both rows the seating-plan editor auto-derived from same-edge seat
// adjacency and ones the player checked themselves — see seat_neighbors'
// source column in db.ts. Self-service, so this is always scoped to a single
// player, never a roster-wide listing.
playersRouter.get('/:id/neighbors', (req, res) => {
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();

  const rows = db
    .prepare('SELECT neighbor_id FROM seat_neighbors WHERE event_id = ? AND player_id = ?')
    .all(filterEventId, req.params.id) as Array<{ neighbor_id: string }>;

  res.json({ eventId: filterEventId, neighborIds: rows.map((r) => r.neighbor_id) });
});

// PUT /api/players/:id/neighbors - replace whose monitor this player says
// they can see for an event, in one shot (like skills.set, meant to be called
// fire-and-forget straight off a checkbox list). Always writes source =
// 'manual', even for ids that were previously auto-derived from the seating
// plan — once a player has touched their own list, it's an explicit
// confirmation and the next seating-plan save won't override it. Body:
// { eventId?, neighborIds: string[] }
playersRouter.put('/:id/neighbors', (req, res) => {
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.id) as
    | { id: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { eventId, neighborIds } = req.body ?? {};
  if (!Array.isArray(neighborIds) || !neighborIds.every((n) => typeof n === 'string')) {
    return res.status(400).json({ error: 'neighborIds muss ein String-Array sein.' });
  }
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();

  // Silently drop yourself and anything that isn't actually a player, rather
  // than erroring — a stale id from a checkbox list a moment after someone
  // else got deleted shouldn't block saving the rest.
  const uniqueIds = [...new Set(neighborIds)].filter((id) => id !== player.id);
  const validIds =
    uniqueIds.length === 0
      ? []
      : (db
          .prepare(`SELECT id FROM players WHERE id IN (${uniqueIds.map(() => '?').join(',')})`)
          .all(...uniqueIds) as Array<{ id: string }>).map((r) => r.id);

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM seat_neighbors WHERE event_id = ? AND player_id = ?').run(
      filterEventId,
      player.id
    );
    const insert = db.prepare(
      "INSERT INTO seat_neighbors (event_id, player_id, neighbor_id, source) VALUES (?, ?, ?, 'manual')"
    );
    for (const neighborId of validIds) {
      insert.run(filterEventId, player.id, neighborId);
    }
  });
  replace();

  res.json({ eventId: filterEventId, neighborIds: validIds });
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
playersRouter.get('/:id/stats', (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' ? eventId : null;
  const now = Date.now();

  const ownClauses = ['player_id = ?'];
  const ownParams: string[] = [player.id];
  if (filterEventId) {
    ownClauses.push('event_id = ?');
    ownParams.push(filterEventId);
  }
  const ownRows = db
    .prepare(
      `SELECT player_id, game_id, event_id, started_at, ended_at, active_ms FROM play_sessions WHERE ${ownClauses.join(' AND ')}`
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
    games = db.prepare(`SELECT id, name, icon FROM games WHERE id IN (${ph})`).all(...gameIds) as GameRow[];
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
  const allClauses: string[] = [];
  const allParams: string[] = [];
  if (filterEventId) {
    allClauses.push('event_id = ?');
    allParams.push(filterEventId);
  }
  const allWhere = allClauses.length ? `WHERE ${allClauses.join(' AND ')}` : '';
  const allRows = db
    .prepare(`SELECT player_id, game_id, started_at, ended_at, active_ms FROM play_sessions ${allWhere}`)
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
      emoji: a.emoji,
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
