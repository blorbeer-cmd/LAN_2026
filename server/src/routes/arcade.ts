import { Router } from 'express';
import { db } from '../db';
import { openLobbySummaries as quizLobbies } from '../arcade/arcade';
import { openLobbySummaries as tetrisLobbies } from '../arcade/tetris';
import { openLobbySummaries as scribbleLobbies } from '../arcade/scribble';
import { openLobbySummaries as blobbyLobbies } from '../arcade/blobby';
import { openLobbySummaries as snakeLobbies } from '../arcade/snake';

export const arcadeRouter = Router();

// Display names per arcade game_type, so the stats view labels each tab
// nicely instead of showing the raw internal key.
const ARCADE_TITLES: Record<string, string> = {
  quiz: 'Gaming-Quiz',
  tetris: 'Tetris',
  scribble: 'Scribble',
  blobby: 'Blobby Volley',
  snake: 'Snake',
};
const WIN_LOSS_GAMES = new Set(['blobby']);

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

// GET /api/arcade/lobbies - every currently open lobby across all arcade
// games, newest first, for the Home view's "Aktuell" card. Lobbies live
// in-memory in their socket modules (short-lived party state, not data),
// so this just aggregates their summaries.
arcadeRouter.get('/lobbies', (_req, res) => {
  const lobbies = [
    ...quizLobbies().map((l) => ({ ...l, gameType: 'quiz' })),
    ...tetrisLobbies().map((l) => ({ ...l, gameType: 'tetris' })),
    ...scribbleLobbies().map((l) => ({ ...l, gameType: 'scribble' })),
    ...blobbyLobbies().map((l) => ({ ...l, gameType: 'blobby' })),
    ...snakeLobbies().map((l) => ({ ...l, gameType: 'snake' })),
  ]
    .map((l) => ({ ...l, title: ARCADE_TITLES[l.gameType] ?? l.gameType }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ lobbies });
});

arcadeRouter.get('/stats', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT game_type, winner_id, scores
       FROM arcade_results
       WHERE reason = 'completed'
       ORDER BY ended_at DESC`
    )
    .all() as ArcadeResultRow[];

  const games = new Map<
    string,
    { gameType: string; matches: number; players: Map<string, { playerId: string; name: string; matches: number; wins: number; points: number; best: number }> }
  >();

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
        best: 0,
      };
      current.matches += 1;
      current.points += score.score;
      current.best = Math.max(current.best, score.score); // single-game highscore
      if (row.winner_id === score.playerId) current.wins += 1;
      game.players.set(score.playerId, current);
    }
    games.set(row.game_type, game);
  }

  res.json({
    games: [...games.values()].map((game) => {
      // A real highscore board: rank by best single-game score, not by how
      // many duels someone won.
      const players = [...game.players.values()].sort(
        WIN_LOSS_GAMES.has(game.gameType)
          ? (a, b) => b.wins / b.matches - a.wins / a.matches || b.wins - a.wins || a.name.localeCompare(b.name, 'de')
          : (a, b) => b.best - a.best || b.points - a.points || a.name.localeCompare(b.name, 'de')
      );
      return {
        gameType: game.gameType,
        title: ARCADE_TITLES[game.gameType] ?? game.gameType,
        matches: game.matches,
        rankingMode: WIN_LOSS_GAMES.has(game.gameType) ? 'winLoss' : 'highscore',
        leader: players[0] ?? null,
        players: players.map((player) => ({
          ...player,
          losses: player.matches - player.wins,
          winRate: player.matches > 0 ? player.wins / player.matches : 0,
        })),
      };
    }),
  });
});
