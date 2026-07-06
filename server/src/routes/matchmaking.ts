// Matchmaking endpoint (FR-16..18): draws balanced teams for a game from a
// set of present players, using their skill ratings. Stateless — every call
// is a fresh draw, so "re-roll" is just calling it again. The result is
// broadcast to everyone so the whole LAN sees the same teams, not just
// whoever clicked the button.

import { Router } from 'express';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { balanceTeams, computeTeamCount, type PlayerRating } from '../matchmaking';
import { isIntInRange } from '../validation';

export const matchmakingRouter = Router();

const DEFAULT_RATING = 5; // neutral middle rating for players without one

interface GameRow {
  id: string;
  name: string;
  max_team_size: number;
}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
}

// POST /api/matchmaking
// Body: { gameId: string, playerIds: string[], teamCount?: number }
matchmakingRouter.post('/', (req, res) => {
  const { gameId, playerIds, teamCount } = req.body ?? {};

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (!Array.isArray(playerIds) || playerIds.length < 2 || !playerIds.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'playerIds muss ein Array mit mindestens 2 Spielern sein.' });
  }
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length !== playerIds.length) {
    return res.status(400).json({ error: 'playerIds enthält Duplikate.' });
  }
  if (teamCount !== undefined && !isIntInRange(teamCount, 2, uniqueIds.length)) {
    return res.status(400).json({ error: `teamCount muss zwischen 2 und ${uniqueIds.length} liegen.` });
  }

  const game = db.prepare('SELECT id, name, max_team_size FROM games WHERE id = ?').get(gameId) as
    | GameRow
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(`SELECT id, name, color FROM players WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as PlayerRow[];
  if (players.length !== uniqueIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const ratingRows = db
    .prepare(`SELECT player_id, rating FROM skills WHERE game_id = ? AND player_id IN (${placeholders})`)
    .all(gameId, ...uniqueIds) as Array<{ player_id: string; rating: number }>;
  const ratingByPlayer = new Map(ratingRows.map((r) => [r.player_id, r.rating]));

  const ratings: PlayerRating[] = players.map((p) => ({
    id: p.id,
    rating: ratingByPlayer.get(p.id) ?? DEFAULT_RATING,
  }));

  const resolvedTeamCount = computeTeamCount(teamCount, players.length, game.max_team_size);
  const teamIdLists = balanceTeams(ratings, resolvedTeamCount);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const teams = teamIdLists.map((ids) => {
    const teamPlayers = ids.map((id) => ({
      ...playerById.get(id)!,
      rating: ratingByPlayer.get(id) ?? DEFAULT_RATING,
    }));
    return {
      players: teamPlayers,
      totalRating: teamPlayers.reduce((sum, p) => sum + p.rating, 0),
    };
  });

  const result = { gameId, gameName: game.name, teams, generatedAt: Date.now() };
  broadcast(Events.matchmakingGenerated, result);
  res.json(result);
});
