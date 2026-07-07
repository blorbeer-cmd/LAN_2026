// Deeper session analytics beyond simple totals: longest single sessions,
// time spent multitasking across several games, a raw session log ("wer hat
// wann was gespielt"), and a per-game concurrency-over-time timeseries ("zu
// welchen Zeiten wie viele Spieler haben X gespielt"). All filterable by a
// day/time range (?from=&to=, epoch ms).

import { Router } from 'express';
import { db } from '../db';
import { formatDurationMs, type PlaySession } from '../playtime';
import {
  sessionDurations,
  longestSessionPerPlayerGame,
  longestSessionPerGame,
  longestSessionPerPlayer,
  computeSimultaneousGameTime,
  clipSessionsToRange,
  computeConcurrencyOverTime,
  type SessionDuration,
} from '../sessionStats';
import { parseTimeRangeQuery } from './queryHelpers';
import { computeAwards } from '../awards';

export const analyticsRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  color: string;
}
interface GameRow {
  id: string;
  name: string;
  icon: string;
}

// Filters directly by the event_id tagged onto each session at creation time
// (exact) rather than approximating "this event" via a date range — a
// session's real timestamps don't always line up perfectly with an event's
// nominal start/end (agent clock skew, a session still open when the next
// event starts, etc.).
function loadAllSessions(
  gameId: string | null,
  eventId: string | null = null
): Array<{
  player_id: string;
  game_id: string;
  started_at: number;
  ended_at: number | null;
  active_ms: number;
}> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (gameId) {
    clauses.push('game_id = ?');
    params.push(gameId);
  }
  if (eventId) {
    clauses.push('event_id = ?');
    params.push(eventId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT player_id, game_id, started_at, ended_at, active_ms FROM play_sessions ${where}`)
    .all(...params) as Array<{
    player_id: string;
    game_id: string;
    started_at: number;
    ended_at: number | null;
    active_ms: number;
  }>;
}

function loadNamesFor(playerIds: string[], gameIds: string[]) {
  let players: PlayerRow[] = [];
  if (playerIds.length > 0) {
    const ph = playerIds.map(() => '?').join(',');
    players = db.prepare(`SELECT id, name, color FROM players WHERE id IN (${ph})`).all(...playerIds) as PlayerRow[];
  }
  let games: GameRow[] = [];
  if (gameIds.length > 0) {
    const gh = gameIds.map(() => '?').join(',');
    games = db.prepare(`SELECT id, name, icon FROM games WHERE id IN (${gh})`).all(...gameIds) as GameRow[];
  }
  return { playerById: new Map(players.map((p) => [p.id, p])), gameById: new Map(games.map((g) => [g.id, g])) };
}

function enrichDuration(
  d: SessionDuration,
  playerById: Map<string, PlayerRow>,
  gameById: Map<string, GameRow>
) {
  return {
    playerId: d.playerId,
    playerName: playerById.get(d.playerId)?.name ?? 'Unbekannt',
    playerColor: playerById.get(d.playerId)?.color ?? '#999999',
    gameId: d.gameId,
    gameName: gameById.get(d.gameId)?.name ?? 'Unbekannt',
    gameIcon: gameById.get(d.gameId)?.icon ?? '🎮',
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    durationMs: d.durationMs,
    formatted: formatDurationMs(d.durationMs),
  };
}

// GET /api/analytics/overview - optionally filtered by ?gameId= and/or
// ?from=&to=. The core "interesting numbers" for a dashboard, computed
// together since they all need the same session data anyway.
analyticsRouter.get('/overview', (req, res) => {
  const { gameId, eventId } = req.query;
  const filterGameId = typeof gameId === 'string' ? gameId : null;
  const filterEventId = typeof eventId === 'string' ? eventId : null;
  const range = parseTimeRangeQuery(req.query as Record<string, unknown>);
  if ('error' in range) return res.status(400).json({ error: range.error });

  const now = Date.now();
  const rawRows = loadAllSessions(filterGameId, filterEventId);
  const rawSessions: PlaySession[] = rawRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));
  const sessions = clipSessionsToRange(rawSessions, now, range.from, range.to);

  const durations = sessionDurations(sessions, now);
  const allPlayerIds = [...new Set(sessions.map((s) => s.playerId))];
  const allGameIds = [...new Set(sessions.map((s) => s.gameId))];
  const { playerById, gameById } = loadNamesFor(allPlayerIds, allGameIds);

  const longestPerPlayerGame = longestSessionPerPlayerGame(durations).map((d) =>
    enrichDuration(d, playerById, gameById)
  );
  const longestPerGame = longestSessionPerGame(durations).map((d) => enrichDuration(d, playerById, gameById));
  const longestPerPlayer = longestSessionPerPlayer(durations).map((d) => enrichDuration(d, playerById, gameById));

  const simultaneous = computeSimultaneousGameTime(sessions, now)
    .filter((r) => r.multiGameMs > 0)
    .map((r) => ({
      playerId: r.playerId,
      playerName: playerById.get(r.playerId)?.name ?? 'Unbekannt',
      playerColor: playerById.get(r.playerId)?.color ?? '#999999',
      multiGameMs: r.multiGameMs,
      multiGameFormatted: formatDurationMs(r.multiGameMs),
      maxSimultaneous: r.maxSimultaneous,
    }));

  res.json({
    gameId: filterGameId,
    longestSessionsPerPlayerGame: longestPerPlayerGame,
    longestSessionsPerGame: longestPerGame,
    longestSessionsPerPlayer: longestPerPlayer,
    simultaneousGameTime: simultaneous,
  });
});

// GET /api/analytics/sessions - raw session log ("wer hat wann was
// gespielt"), newest first. Filterable by ?gameId=, ?playerId=, ?from=&to=.
analyticsRouter.get('/sessions', (req, res) => {
  const { gameId, playerId, eventId } = req.query;
  const filterGameId = typeof gameId === 'string' ? gameId : null;
  const filterPlayerId = typeof playerId === 'string' ? playerId : null;
  const filterEventId = typeof eventId === 'string' ? eventId : null;
  const range = parseTimeRangeQuery(req.query as Record<string, unknown>);
  if ('error' in range) return res.status(400).json({ error: range.error });

  const now = Date.now();
  const rawRows = loadAllSessions(filterGameId, filterEventId).filter(
    (r) => !filterPlayerId || r.player_id === filterPlayerId
  );
  const rawSessions: PlaySession[] = rawRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));
  const sessions = clipSessionsToRange(rawSessions, now, range.from, range.to);
  const durations = sessionDurations(sessions, now).sort((a, b) => b.startedAt - a.startedAt);

  const allPlayerIds = [...new Set(sessions.map((s) => s.playerId))];
  const allGameIds = [...new Set(sessions.map((s) => s.gameId))];
  const { playerById, gameById } = loadNamesFor(allPlayerIds, allGameIds);

  res.json(durations.map((d) => enrichDuration(d, playerById, gameById)));
});

// GET /api/analytics/concurrency?gameId=&from=&to=&bucketMinutes=
// "zu welchen Zeiten wie viele Spieler haben X gespielt" — bucketed
// timeseries of how many sessions of one specific game were running at once.
analyticsRouter.get('/concurrency', (req, res) => {
  const { gameId, bucketMinutes } = req.query;
  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  const range = parseTimeRangeQuery(req.query as Record<string, unknown>);
  if ('error' in range) return res.status(400).json({ error: range.error });
  if (range.from === undefined || range.to === undefined) {
    return res.status(400).json({ error: 'from und to sind erforderlich.' });
  }

  let bucketMin = 30;
  if (bucketMinutes !== undefined) {
    const parsed = typeof bucketMinutes === 'string' ? parseInt(bucketMinutes, 10) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24 * 60) {
      return res.status(400).json({ error: 'bucketMinutes muss zwischen 1 und 1440 liegen.' });
    }
    bucketMin = parsed;
  }

  const now = Date.now();
  const rawRows = loadAllSessions(gameId);
  const sessions: PlaySession[] = rawRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));

  const buckets = computeConcurrencyOverTime(sessions, range.from, range.to, bucketMin * 60_000, now);
  res.json({ gameId, bucketMinutes: bucketMin, buckets });
});

// GET /api/analytics/awards - the "witzige" awards (Marathon-Zocker,
// Multitasking-Meister, Nachteule, ...), optionally filtered by ?from=&to=.
analyticsRouter.get('/awards', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' ? eventId : null;
  const range = parseTimeRangeQuery(req.query as Record<string, unknown>);
  if ('error' in range) return res.status(400).json({ error: range.error });

  const now = Date.now();
  const rawRows = loadAllSessions(null, filterEventId);
  const rawSessions: PlaySession[] = rawRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));
  const sessions = clipSessionsToRange(rawSessions, now, range.from, range.to);

  const rawAwards = computeAwards(sessions, now);
  const { playerById } = loadNamesFor(
    [...new Set(rawAwards.map((a) => a.playerId))],
    []
  );

  const awards = rawAwards.map((a) => ({
    id: a.id,
    emoji: a.emoji,
    title: a.title,
    description: a.description,
    playerId: a.playerId,
    playerName: playerById.get(a.playerId)?.name ?? 'Unbekannt',
    playerColor: playerById.get(a.playerId)?.color ?? '#999999',
    value:
      a.valueMs !== undefined
        ? formatDurationMs(a.valueMs)
        : a.valuePercent !== undefined
          ? `${a.valuePercent}%`
          : `${a.valueCount}`,
  }));

  res.json({ awards });
});
