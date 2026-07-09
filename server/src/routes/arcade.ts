import { Router } from 'express';
import { db } from '../db';

export const arcadeRouter = Router();

// Display names per arcade game_type, so the stats view labels each tab
// nicely instead of showing the raw internal key.
const ARCADE_TITLES: Record<string, string> = {
  quiz: 'Gaming-Quiz',
  tetris: 'Tetris Battle',
};

interface ArcadeResultRow {
  game_type: string;
  winner_id: string | null;
  scores: string;
}

interface ScoreEntry {
  playerId: string;
  name: string;
  score: number;
}

arcadeRouter.get('/stats', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT game_type, winner_id, scores
       FROM arcade_results
       WHERE reason = 'completed'
       ORDER BY ended_at DESC`
    )
    .all() as ArcadeResultRow[];

  const games = new Map<string, { gameType: string; matches: number; players: Map<string, { playerId: string; name: string; matches: number; wins: number; points: number }> }>();

  for (const row of rows) {
    const game = games.get(row.game_type) ?? { gameType: row.game_type, matches: 0, players: new Map() };
    game.matches += 1;
    const scores = JSON.parse(row.scores) as ScoreEntry[];
    for (const score of scores) {
      const current = game.players.get(score.playerId) ?? {
        playerId: score.playerId,
        name: score.name,
        matches: 0,
        wins: 0,
        points: 0,
      };
      current.matches += 1;
      current.points += score.score;
      if (row.winner_id === score.playerId) current.wins += 1;
      game.players.set(score.playerId, current);
    }
    games.set(row.game_type, game);
  }

  res.json({
    games: [...games.values()].map((game) => {
      const players = [...game.players.values()].sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name, 'de'));
      return {
        gameType: game.gameType,
        title: ARCADE_TITLES[game.gameType] ?? game.gameType,
        matches: game.matches,
        leader: players[0] ?? null,
        players,
      };
    }),
  });
});
