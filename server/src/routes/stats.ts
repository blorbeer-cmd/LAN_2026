// Playtime statistics (FR-29): aggregated from the play_sessions history the
// agent report endpoint writes on every start/stop transition. activeMs
// (only non-zero for players who opted into activity tracking) reflects time
// the game was actually focused+used, as opposed to just running.

import { Router } from 'express';
import { db } from '../db';
import { computePlaytime, aggregateByGame, formatDurationMs, type PlaySession } from '../playtime';
import { clipSessionsToRange } from '../sessionStats';
import { parseTimeRangeQuery } from './queryHelpers';

export const statsRouter = Router();

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

// GET /api/stats/playtime - optionally filtered by ?gameId= and/or a day/time
// range (?from=&to=, epoch ms). Returns both the per-player-per-game
// breakdown and a per-player grand total (handy for an overall "who's played
// the most" view when unfiltered).
statsRouter.get('/playtime', (req, res) => {
  const { gameId } = req.query;
  const filterGameId = typeof gameId === 'string' ? gameId : null;

  const range = parseTimeRangeQuery(req.query as Record<string, unknown>);
  if ('error' in range) return res.status(400).json({ error: range.error });

  const rows = (
    filterGameId
      ? db
          .prepare(
            'SELECT player_id, game_id, started_at, ended_at, active_ms FROM play_sessions WHERE game_id = ?'
          )
          .all(filterGameId)
      : db.prepare('SELECT player_id, game_id, started_at, ended_at, active_ms FROM play_sessions').all()
  ) as Array<{ player_id: string; game_id: string; started_at: number; ended_at: number | null; active_ms: number }>;

  const now = Date.now();
  const rawSessions: PlaySession[] = rows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));
  const sessions = clipSessionsToRange(rawSessions, now, range.from, range.to);

  const perGame = computePlaytime(sessions, now);

  const playerIds = [...new Set(perGame.map((e) => e.playerId))];
  const gameIds = [...new Set(perGame.map((e) => e.gameId))];

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
  const playerById = new Map(players.map((p) => [p.id, p]));
  const gameByIdMap = new Map(games.map((g) => [g.id, g]));

  const entries = perGame.map((e) => ({
    playerId: e.playerId,
    playerName: playerById.get(e.playerId)?.name ?? 'Unbekannt',
    playerColor: playerById.get(e.playerId)?.color ?? '#999999',
    gameId: e.gameId,
    gameName: gameByIdMap.get(e.gameId)?.name ?? 'Unbekannt',
    gameIcon: gameByIdMap.get(e.gameId)?.icon ?? '🎮',
    totalMs: e.totalMs,
    formatted: formatDurationMs(e.totalMs),
    activeMs: e.activeMs,
    activeFormatted: formatDurationMs(e.activeMs),
  }));

  const totalsByPlayer = new Map<string, { totalMs: number; activeMs: number }>();
  for (const e of entries) {
    const current = totalsByPlayer.get(e.playerId) ?? { totalMs: 0, activeMs: 0 };
    current.totalMs += e.totalMs;
    current.activeMs += e.activeMs;
    totalsByPlayer.set(e.playerId, current);
  }
  const totals = [...totalsByPlayer.entries()]
    .map(([playerId, v]) => ({
      playerId,
      playerName: playerById.get(playerId)?.name ?? 'Unbekannt',
      playerColor: playerById.get(playerId)?.color ?? '#999999',
      totalMs: v.totalMs,
      formatted: formatDurationMs(v.totalMs),
      activeMs: v.activeMs,
      activeFormatted: formatDurationMs(v.activeMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // Per-game total across everyone — "how long did this game run at the
  // party in total", not per person.
  const totalsByGame = aggregateByGame(perGame).map(({ gameId: id, totalMs, activeMs }) => ({
    gameId: id,
    gameName: gameByIdMap.get(id)?.name ?? 'Unbekannt',
    gameIcon: gameByIdMap.get(id)?.icon ?? '🎮',
    totalMs,
    formatted: formatDurationMs(totalMs),
    activeMs,
    activeFormatted: formatDurationMs(activeMs),
  }));

  res.json({ gameId: filterGameId, entries, totals, totalsByGame });
});
