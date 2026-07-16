// Deeper session analytics beyond simple totals: longest single sessions,
// time spent multitasking across several games, a raw session log ("wer hat
// wann was gespielt"), and a per-game concurrency-over-time timeseries ("zu
// welchen Zeiten wie viele Spieler haben X gespielt"). All filterable by a
// day/time range (?from=&to=, epoch ms).

import { Router } from 'express';
import { db } from '../db';
import { formatDurationMs, computePlaytime, aggregateByGame, type PlaySession } from '../playtime';
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
import { matchCountsByGame, biggestRivalry, bestDuo, biggestUnderdogWin, type MatchForUnderdog } from '../gameStats';
import { ARCADE_TITLES } from './arcade';

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

// GET /api/analytics/games - "Beliebteste Spiele": per-game total playtime,
// distinct player count, and session count, most-played first. Same
// optional ?eventId=&from=&to= filtering as the endpoints above.
analyticsRouter.get('/games', (req, res) => {
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

  const totals = aggregateByGame(computePlaytime(sessions, now));

  const sessionCountByGame = new Map<string, number>();
  const playersByGame = new Map<string, Set<string>>();
  for (const s of sessions) {
    sessionCountByGame.set(s.gameId, (sessionCountByGame.get(s.gameId) ?? 0) + 1);
    if (!playersByGame.has(s.gameId)) playersByGame.set(s.gameId, new Set());
    playersByGame.get(s.gameId)!.add(s.playerId);
  }

  const { gameById } = loadNamesFor([], totals.map((t) => t.gameId));

  const games = totals.map((t) => ({
    gameId: t.gameId,
    gameName: gameById.get(t.gameId)?.name ?? 'Unbekannt',
    gameIcon: gameById.get(t.gameId)?.icon ?? '🎮',
    totalFormatted: formatDurationMs(t.totalMs),
    sessionCount: sessionCountByGame.get(t.gameId) ?? 0,
    playerCount: playersByGame.get(t.gameId)?.size ?? 0,
  }));

  res.json({ games });
});

interface MatchRow {
  id: string;
  game_id: string;
  result: string;
}

function loadAllMatches(eventId: string | null): MatchForUnderdog[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (eventId) {
    clauses.push('event_id = ?');
    params.push(eventId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT id, game_id, result FROM matches ${where}`).all(...params) as MatchRow[];
  return rows.map((r) => {
    const parsed = JSON.parse(r.result) as { teams: Array<{ playerIds: string[] }>; winnerTeamIndex: number | null };
    return { id: r.id, gameId: r.game_id, teams: parsed.teams, winnerTeamIndex: parsed.winnerTeamIndex };
  });
}

function countBy<T>(rows: T[], key: (r: T) => string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return [...counts.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

// GET /api/analytics/games-tournaments - the "Spiele & Turniere" tab: how
// much each game got played/drawn/competed in, plus a few "witzige"
// head-to-head stats. Optionally filtered by ?eventId= (default: all-time,
// since these are the kind of numbers people like comparing across LANs).
analyticsRouter.get('/games-tournaments', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : null;

  const matches = loadAllMatches(filterEventId);
  const matchCounts = matchCountsByGame(matches);

  const eventClause = filterEventId ? 'WHERE event_id = ?' : '';
  const eventParams = filterEventId ? [filterEventId] : [];

  const tournamentRows = db
    .prepare(`SELECT format, status, game_id FROM tournaments ${eventClause}`)
    .all(...eventParams) as Array<{ format: string; status: string; game_id: string }>;
  const tournamentByGame = countBy(tournamentRows, (t) => t.game_id);
  const tournamentByFormat = countBy(tournamentRows, (t) => t.format);

  const drawRows = db
    .prepare(`SELECT game_id, seat_conflicts, seat_pairs_considered FROM matchmaking_draws ${eventClause}`)
    .all(...eventParams) as Array<{ game_id: string; seat_conflicts: number; seat_pairs_considered: number }>;
  const drawsByGame = countBy(drawRows, (d) => d.game_id);
  const totalSeatPairsConsidered = drawRows.reduce((sum, d) => sum + d.seat_pairs_considered, 0);
  const totalSeatConflicts = drawRows.reduce((sum, d) => sum + d.seat_conflicts, 0);

  const rivalry = biggestRivalry(matches);
  const duo = bestDuo(matches);

  // Same neutral default rating as matchmaking.ts's DEFAULT_RATING — a
  // player who's never rated a game isn't meaningfully "weaker" than one
  // who is.
  const skillRows = db.prepare('SELECT player_id, game_id, rating FROM skills').all() as Array<{
    player_id: string;
    game_id: string;
    rating: number;
  }>;
  const ratingByKey = new Map(skillRows.map((r) => [`${r.player_id}::${r.game_id}`, r.rating]));
  const ratingOf = (playerId: string, gameId: string) => ratingByKey.get(`${playerId}::${gameId}`) ?? 5;
  const underdog = biggestUnderdogWin(matches, ratingOf);
  const underdogMatch = underdog ? matches.find((m) => m.id === underdog.matchId) : undefined;

  const involvedPlayerIds = [
    ...(rivalry ? [rivalry.playerAId, rivalry.playerBId] : []),
    ...(duo ? [duo.playerAId, duo.playerBId] : []),
    ...(underdogMatch ? underdogMatch.teams[underdog!.winnerTeamIndex].playerIds : []),
  ];
  const involvedGameIds = [
    ...new Set([
      ...matchCounts.map((m) => m.gameId),
      ...tournamentRows.map((t) => t.game_id),
      ...drawRows.map((d) => d.game_id),
      ...(underdog ? [underdog.gameId] : []),
    ]),
  ];
  const { playerById, gameById } = loadNamesFor(involvedPlayerIds, involvedGameIds);

  const gameLabel = (gameId: string) => ({
    gameId,
    gameName: gameById.get(gameId)?.name ?? 'Unbekannt',
    gameIcon: gameById.get(gameId)?.icon ?? '🎮',
  });
  const playerLabel = (id: string) => ({
    id,
    name: playerById.get(id)?.name ?? 'Unbekannt',
    color: playerById.get(id)?.color ?? '#999999',
  });

  res.json({
    matches: {
      total: matches.length,
      byGame: matchCounts.map((m) => ({ ...gameLabel(m.gameId), count: m.count, decided: m.decided, undecided: m.undecided })),
    },
    tournaments: {
      total: tournamentRows.length,
      completed: tournamentRows.filter((t) => t.status === 'completed').length,
      active: tournamentRows.filter((t) => t.status !== 'completed').length,
      byFormat: tournamentByFormat.map((f) => ({ format: f.key, count: f.count })),
      byGame: tournamentByGame.map((g) => ({ ...gameLabel(g.key), count: g.count })),
    },
    draws: {
      total: drawRows.length,
      byGame: drawsByGame.map((g) => ({ ...gameLabel(g.key), count: g.count })),
      seatConflictRatePercent:
        totalSeatPairsConsidered > 0 ? Math.round((totalSeatConflicts / totalSeatPairsConsidered) * 100) : null,
    },
    fun: {
      biggestRivalry: rivalry
        ? { playerA: playerLabel(rivalry.playerAId), playerB: playerLabel(rivalry.playerBId), count: rivalry.count }
        : null,
      bestDuo: duo
        ? {
            playerA: playerLabel(duo.playerAId),
            playerB: playerLabel(duo.playerBId),
            gamesTogether: duo.gamesTogether,
            winsTogether: duo.winsTogether,
          }
        : null,
      biggestUnderdogWin:
        underdog && underdogMatch
          ? {
              ...gameLabel(underdog.gameId),
              winnerAvgRating: Math.round(underdog.winnerAvgRating * 10) / 10,
              loserAvgRating: Math.round(underdog.loserAvgRating * 10) / 10,
              winners: underdogMatch.teams[underdog.winnerTeamIndex].playerIds.map(playerLabel),
            }
          : null,
    },
  });
});

interface ArcadeResultFullRow {
  game_type: string;
  scores: string;
  started_at: number;
  ended_at: number;
}

interface ArcadeScoreEntry {
  playerId: string;
  name: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/analytics/arcade - the arcade-specific "Auswertungen" tab: match
// durations and most-active player per game, optionally restricted by the
// stored start time. Arcade results have no event id, so a direct time range
// is the only honest equivalent to the other analytics filters.
analyticsRouter.get('/arcade', (req, res) => {
  const range = parseTimeRangeQuery(req.query as Record<string, unknown>);
  if ('error' in range) return res.status(400).json({ error: range.error });
  const clauses = [`reason = 'completed'`];
  const params: number[] = [];
  if (range.from !== undefined) {
    clauses.push('started_at >= ?');
    params.push(range.from);
  }
  if (range.to !== undefined) {
    clauses.push('started_at <= ?');
    params.push(range.to);
  }
  const rows = db
    .prepare(
      `SELECT game_type, scores, started_at, ended_at
       FROM arcade_results
       WHERE ${clauses.join(' AND ')}
       ORDER BY started_at ASC`
    )
    .all(...params) as ArcadeResultFullRow[];

  interface GameAgg {
    gameType: string;
    matches: number;
    totalDurationMs: number;
    longestDurationMs: number;
    players: Set<string>;
    matchesByPlayer: Map<string, { playerId: string; name: string; matches: number }>;
  }
  const games = new Map<string, GameAgg>();
  const dayBuckets = new Map<number, number>();
  const allPlayers = new Set<string>();
  let totalDurationMs = 0;
  let countedMatches = 0;

  for (const row of rows) {
    const parsed = JSON.parse(row.scores) as unknown;
    // Same legacy-row guard as GET /api/arcade/stats: bare score arrays with
    // no player attribution don't count as a match here either.
    const scores = (Array.isArray(parsed) ? parsed : []).filter(
      (s): s is ArcadeScoreEntry => !!s && typeof (s as ArcadeScoreEntry).playerId === 'string'
    );
    if (scores.length === 0) continue;
    countedMatches += 1;

    const durationMs = Math.max(0, row.ended_at - row.started_at);
    totalDurationMs += durationMs;

    const dayStart = Math.floor(row.started_at / DAY_MS) * DAY_MS;
    dayBuckets.set(dayStart, (dayBuckets.get(dayStart) ?? 0) + 1);

    const game = games.get(row.game_type) ?? {
      gameType: row.game_type,
      matches: 0,
      totalDurationMs: 0,
      longestDurationMs: 0,
      players: new Set<string>(),
      matchesByPlayer: new Map(),
    };
    game.matches += 1;
    game.totalDurationMs += durationMs;
    game.longestDurationMs = Math.max(game.longestDurationMs, durationMs);
    for (const score of scores) {
      game.players.add(score.playerId);
      allPlayers.add(score.playerId);
      const current = game.matchesByPlayer.get(score.playerId) ?? {
        playerId: score.playerId,
        name: score.name,
        matches: 0,
      };
      current.matches += 1;
      game.matchesByPlayer.set(score.playerId, current);
    }
    games.set(row.game_type, game);
  }

  const gamesOut = [...games.values()]
    .map((g) => {
      const mostActive =
        [...g.matchesByPlayer.values()].sort(
          (a, b) => b.matches - a.matches || a.name.localeCompare(b.name, 'de')
        )[0] ?? null;
      return {
        gameType: g.gameType,
        title: ARCADE_TITLES[g.gameType] ?? g.gameType,
        matches: g.matches,
        uniquePlayers: g.players.size,
        avgDurationFormatted: formatDurationMs(g.matches > 0 ? Math.round(g.totalDurationMs / g.matches) : 0),
        longestDurationFormatted: formatDurationMs(g.longestDurationMs),
        mostActive,
      };
    })
    .sort((a, b) => b.matches - a.matches);

  const timeline = [...dayBuckets.entries()]
    .map(([dayStart, count]) => ({ dayStart, count }))
    .sort((a, b) => a.dayStart - b.dayStart);

  res.json({
    totals: {
      matches: countedMatches,
      players: allPlayers.size,
      totalDurationFormatted: formatDurationMs(totalDurationMs),
      avgDurationFormatted: formatDurationMs(countedMatches > 0 ? Math.round(totalDurationMs / countedMatches) : 0),
    },
    games: gamesOut,
    timeline,
  });
});
