// "Jetzt zocken" pings: a lightweight, spontaneous "I want to play X right
// now, who's in?" — distinct from a vote round (no formal start/close, just
// expires on its own) for the common "let's just get a quick round going"
// case that doesn't need a democratic decision.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getActiveEventId } from '../events';
import { isNonEmptyString } from '../validation';
import { notifyPlayers } from '../push';

export const pingsRouter = Router();

const DEFAULT_EXPIRES_MINUTES = 45;
const MAX_EXPIRES_MINUTES = 180;
const MIN_EXPIRES_MINUTES = 5;

interface PingRow {
  id: string;
  player_id: string;
  game_id: string;
  event_id: string;
  message: string | null;
  created_at: number;
  expires_at: number;
}
interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}
interface GameRow {
  id: string;
  name: string;
  icon: string;
}

function buildActivePings(eventId: string) {
  const rows = db
    .prepare('SELECT * FROM game_pings WHERE event_id = ? AND expires_at > ? ORDER BY created_at DESC')
    .all(eventId, Date.now()) as PingRow[];
  if (rows.length === 0) return [];

  const interestedRows = db
    .prepare(`SELECT ping_id, player_id FROM game_ping_interested WHERE ping_id IN (${rows.map(() => '?').join(',')})`)
    .all(...rows.map((r) => r.id)) as Array<{ ping_id: string; player_id: string }>;

  // Player ids to resolve = ping creators AND everyone who marked interest
  // (not just creators) — otherwise responders silently vanish below.
  const playerIds = [...new Set([...rows.map((r) => r.player_id), ...interestedRows.map((r) => r.player_id)])];
  const gameIds = [...new Set(rows.map((r) => r.game_id))];
  const players = db
    .prepare(`SELECT id, name, color, avatar FROM players WHERE id IN (${playerIds.map(() => '?').join(',')})`)
    .all(...playerIds) as PlayerRow[];
  const games = db
    .prepare(`SELECT id, name, icon FROM games WHERE id IN (${gameIds.map(() => '?').join(',')})`)
    .all(...gameIds) as GameRow[];
  const playerById = new Map(players.map((p) => [p.id, p]));
  const gameById = new Map(games.map((g) => [g.id, g]));
  const interestedByPing = new Map<string, PlayerRow[]>();
  for (const r of interestedRows) {
    const p = playerById.get(r.player_id);
    if (!p) continue;
    interestedByPing.set(r.ping_id, [...(interestedByPing.get(r.ping_id) ?? []), p]);
  }

  return rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    playerName: playerById.get(r.player_id)?.name ?? 'Unbekannt',
    playerColor: playerById.get(r.player_id)?.color ?? '#999999',
    playerAvatar: playerById.get(r.player_id)?.avatar ?? null,
    gameId: r.game_id,
    gameName: gameById.get(r.game_id)?.name ?? 'Unbekannt',
    gameIcon: gameById.get(r.game_id)?.icon ?? '🎮',
    message: r.message,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    interested: interestedByPing.get(r.id) ?? [],
  }));
}

// GET /api/pings - currently active (not yet expired) pings for the active
// event (or an explicit ?eventId=), newest first.
pingsRouter.get('/', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getActiveEventId();
  res.json({ pings: buildActivePings(filterEventId) });
});

// POST /api/pings - create a ping.
// Body: { playerId, gameId, message?, expiresInMinutes? }
pingsRouter.post('/', (req, res) => {
  const { playerId, gameId, message, expiresInMinutes } = req.body ?? {};

  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (message !== undefined && message !== null && !isNonEmptyString(message, 140)) {
    return res.status(400).json({ error: 'message darf höchstens 140 Zeichen lang sein.' });
  }
  const minutes =
    expiresInMinutes === undefined
      ? DEFAULT_EXPIRES_MINUTES
      : typeof expiresInMinutes === 'number' &&
          Number.isInteger(expiresInMinutes) &&
          expiresInMinutes >= MIN_EXPIRES_MINUTES &&
          expiresInMinutes <= MAX_EXPIRES_MINUTES
        ? expiresInMinutes
        : null;
  if (minutes === null) {
    return res.status(400).json({
      error: `expiresInMinutes muss zwischen ${MIN_EXPIRES_MINUTES} und ${MAX_EXPIRES_MINUTES} liegen.`,
    });
  }

  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const game = db.prepare('SELECT id, name, icon FROM games WHERE id = ?').get(gameId) as
    | GameRow
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const now = Date.now();
  const id = nanoid();
  const eventId = getActiveEventId();
  db.prepare(
    'INSERT INTO game_pings (id, player_id, game_id, event_id, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, playerId, gameId, eventId, isNonEmptyString(message, 140) ? (message as string).trim() : null, now, now + minutes * 60_000);

  const pings = buildActivePings(eventId);
  broadcast(Events.pingsChanged, {
    pings,
    notify: {
      // Everyone except the player who just pinged — they already know.
      excludePlayerId: playerId,
      message: `🎮 ${player.name} will jetzt ${game.icon} ${game.name} spielen`,
      pingId: id,
    },
  });
  const otherPlayerIds = (db.prepare('SELECT id FROM players WHERE id != ?').all(playerId) as Array<{ id: string }>).map(
    (p) => p.id
  );
  notifyPlayers(otherPlayerIds, {
    title: `🎮 ${player.name} will jetzt zocken`,
    body: `${game.icon} ${game.name}${message ? ` – „${(message as string).trim()}"` : ''}`,
    url: '/',
  });
  res.status(201).json({ pings });
});

// POST /api/pings/:id/interested - toggle the given player's "Ich bin
// dabei" on a ping. Body: { playerId }
pingsRouter.post('/:id/interested', (req, res) => {
  const ping = db.prepare('SELECT * FROM game_pings WHERE id = ?').get(req.params.id) as PingRow | undefined;
  if (!ping) return res.status(404).json({ error: 'Ping nicht gefunden.' });
  if (ping.expires_at <= Date.now()) return res.status(410).json({ error: 'Dieser Ping ist bereits abgelaufen.' });

  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const existing = db
    .prepare('SELECT 1 FROM game_ping_interested WHERE ping_id = ? AND player_id = ?')
    .get(ping.id, playerId);
  if (existing) {
    db.prepare('DELETE FROM game_ping_interested WHERE ping_id = ? AND player_id = ?').run(ping.id, playerId);
  } else {
    db.prepare('INSERT INTO game_ping_interested (ping_id, player_id) VALUES (?, ?)').run(ping.id, playerId);
  }

  const pings = buildActivePings(ping.event_id);
  broadcast(Events.pingsChanged, { pings });
  res.json({ pings });
});

// DELETE /api/pings/:id - cancel early (e.g. "never mind, we already
// started"). No ownership check, same trust model as the rest of this app
// (see players.ts's PATCH comment) — anyone can clear a stale ping.
pingsRouter.delete('/:id', (req, res) => {
  const ping = db.prepare('SELECT * FROM game_pings WHERE id = ?').get(req.params.id) as PingRow | undefined;
  if (!ping) return res.status(404).json({ error: 'Ping nicht gefunden.' });

  db.prepare('DELETE FROM game_pings WHERE id = ?').run(ping.id);
  const pings = buildActivePings(ping.event_id);
  broadcast(Events.pingsChanged, { pings });
  res.status(204).end();
});
