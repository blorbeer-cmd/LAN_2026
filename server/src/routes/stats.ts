// Playtime statistics (FR-29): aggregated from the play_sessions history the
// agent report endpoint writes on every start/stop transition.

import { Router } from 'express';
import { db } from '../db';
import { computePlaytime, aggregateByGame, formatDurationMs, type PlaySession } from '../playtime';

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

// GET /api/stats/playtime - optionally filtered by ?gameId=. Returns both the
// per-player-per-game breakdown and a per-player grand total (handy for an
// overall "who's played the most" view when unfiltered).
statsRouter.get('/playtime', (req, res) => {
  const { gameId } = req.query;
  const filterGameId = typeof gameId === 'string' ? gameId : null;

  const rows = (
    filterGameId
      ? db
          .prepare('SELECT player_id, game_id, started_at, ended_at FROM play_sessions WHERE game_id = ?')
          .all(filterGameId)
      : db.prepare('SELECT player_id, game_id, started_at, ended_at FROM play_sessions').all()
  ) as Array<{ player_id: string; game_id: string; started_at: number; ended_at: number | null }>;

  const sessions: PlaySession[] = rows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }));

  const perGame = computePlaytime(sessions, Date.now());

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
  }));

  const totalsByPlayer = new Map<string, number>();
  for (const e of entries) {
    totalsByPlayer.set(e.playerId, (totalsByPlayer.get(e.playerId) ?? 0) + e.totalMs);
  }
  const totals = [...totalsByPlayer.entries()]
    .map(([playerId, totalMs]) => ({
      playerId,
      playerName: playerById.get(playerId)?.name ?? 'Unbekannt',
      playerColor: playerById.get(playerId)?.color ?? '#999999',
      totalMs,
      formatted: formatDurationMs(totalMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // Per-game total across everyone — "how long did this game run at the
  // party in total", not per person.
  const totalsByGame = aggregateByGame(perGame).map(({ gameId: id, totalMs }) => ({
    gameId: id,
    gameName: gameByIdMap.get(id)?.name ?? 'Unbekannt',
    gameIcon: gameByIdMap.get(id)?.icon ?? '🎮',
    totalMs,
    formatted: formatDurationMs(totalMs),
  }));

  res.json({ gameId: filterGameId, entries, totals, totalsByGame });
});
