import { Router } from 'express';
import { db } from '../db';
import { openLobbySummaries as quizLobbies } from '../arcade/arcade';
import { openLobbySummaries as tetrisLobbies } from '../arcade/tetris';
import { openLobbySummaries as scribbleLobbies } from '../arcade/scribble';
import { openLobbySummaries as blobbyLobbies } from '../arcade/blobby';
import { openLobbySummaries as pongLobbies } from '../arcade/pong';
import { openLobbySummaries as snakeLobbies } from '../arcade/snake';

export const arcadeRouter = Router();

// Display names per arcade game_type, so the stats view labels each tab
// nicely instead of showing the raw internal key.
export const ARCADE_TITLES: Record<string, string> = {
  quiz: 'Gaming-Quiz',
  tetris: 'Tetris',
  scribble: 'Scribble',
  blobby: 'Blobby Volley',
  pong: 'Pong',
  snake: 'Snake',
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

interface ScribbleArtStatsRow {
  player_id: string | null;
  name: string;
  drawings: number;
  round_wins: number;
  reactions: number;
  cool: number;
  creative: number;
  funny: number;
  favorites: number;
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
    ...pongLobbies().map((l) => ({ ...l, gameType: 'pong' })),
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
    { gameType: string; matches: number; players: Map<string, { playerId: string; name: string; matches: number; wins: number }> }
  >();

  for (const row of rows) {
    const parsed = JSON.parse(row.scores) as unknown;
    // Only per-player score entries count. Legacy snake results serialized a
    // bare score array ([12, 8]) with no player attribution — those rows are
    // skipped entirely (not counted as matches, no phantom nameless player).
    const scores = (Array.isArray(parsed) ? parsed : []).filter(
      (s): s is ScoreEntry => !!s && typeof (s as ScoreEntry).playerId === 'string'
    );
    if (scores.length === 0) continue;

    const game = games.get(row.game_type) ?? { gameType: row.game_type, matches: 0, players: new Map() };
    game.matches += 1;
    for (const score of scores) {
      const current = game.players.get(score.playerId) ?? {
        playerId: score.playerId,
        name: score.name,
        matches: 0,
        wins: 0,
      };
      current.matches += 1;
      if (row.winner_id === score.playerId) current.wins += 1;
      game.players.set(score.playerId, current);
    }
    games.set(row.game_type, game);
  }

  const scribbleArtPlayers = db.prepare(
    `SELECT d.artist_id AS player_id, d.artist_name AS name,
            COUNT(*) AS drawings,
            SUM(d.is_round_winner) AS round_wins,
            SUM((SELECT COUNT(*) FROM scribble_drawing_reactions r WHERE r.drawing_id = d.id)) AS reactions,
            SUM((SELECT COUNT(*) FROM scribble_drawing_reactions r WHERE r.drawing_id = d.id AND r.reaction = 'cool')) AS cool,
            SUM((SELECT COUNT(*) FROM scribble_drawing_reactions r WHERE r.drawing_id = d.id AND r.reaction = 'creative')) AS creative,
            SUM((SELECT COUNT(*) FROM scribble_drawing_reactions r WHERE r.drawing_id = d.id AND r.reaction = 'funny')) AS funny,
            SUM((SELECT COUNT(*) FROM scribble_drawing_favorites f WHERE f.drawing_id = d.id)) AS favorites
     FROM scribble_drawings d
     GROUP BY d.artist_id, d.artist_name
     ORDER BY round_wins DESC, favorites DESC, reactions DESC, name COLLATE NOCASE`
  ).all() as ScribbleArtStatsRow[];

  res.json({
    games: [...games.values()].map((game) => {
      // Everything ranks by win–loss ratio now (highscores retired): most
      // duels won relative to played, ties broken by absolute wins.
      const players = [...game.players.values()]
        .map((player) => ({
          ...player,
          losses: player.matches - player.wins,
          winRate: player.matches > 0 ? player.wins / player.matches : 0,
        }))
        .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.name.localeCompare(b.name, 'de'));
      return {
        gameType: game.gameType,
        title: ARCADE_TITLES[game.gameType] ?? game.gameType,
        matches: game.matches,
        leader: players[0] ?? null,
        players,
        ...(game.gameType === 'scribble'
          ? {
              artPlayers: scribbleArtPlayers.map((player) => ({
                playerId: player.player_id,
                name: player.name,
                drawings: player.drawings,
                roundWins: player.round_wins,
                reactions: player.reactions,
                averageReactions: player.drawings > 0 ? player.reactions / player.drawings : 0,
                favorites: player.favorites,
                reactionBreakdown: { cool: player.cool, creative: player.creative, funny: player.funny },
              })),
            }
          : {}),
      };
    }),
  });
});

arcadeRouter.get('/scribble/gallery', (_req, res) => {
  const rows = db.prepare(
    `SELECT d.id, d.match_id, d.round_number, d.artist_id, d.artist_name, d.word, d.draw_ops, d.created_at,
            COUNT(DISTINCT r.player_id) AS reaction_count,
            COUNT(DISTINCT CASE WHEN r.reaction = 'cool' THEN r.player_id END) AS cool_count,
            COUNT(DISTINCT CASE WHEN r.reaction = 'creative' THEN r.player_id END) AS creative_count,
            COUNT(DISTINCT CASE WHEN r.reaction = 'funny' THEN r.player_id END) AS funny_count,
            COUNT(DISTINCT f.player_id) AS favorite_votes
     FROM scribble_drawings d
     LEFT JOIN scribble_drawing_reactions r ON r.drawing_id = d.id
     LEFT JOIN scribble_drawing_favorites f ON f.drawing_id = d.id
     WHERE d.is_round_winner = 1
     GROUP BY d.id
     ORDER BY d.created_at DESC
     LIMIT 50`
  ).all() as Array<{
    id: string; match_id: string; round_number: number; artist_id: string | null; artist_name: string;
    word: string; draw_ops: string; created_at: number; reaction_count: number; cool_count: number;
    creative_count: number; funny_count: number; favorite_votes: number;
  }>;
  res.json({
    drawings: rows.map((row) => ({
      id: row.id,
      matchId: row.match_id,
      round: row.round_number,
      artistId: row.artist_id,
      artistName: row.artist_name,
      word: row.word,
      strokes: JSON.parse(row.draw_ops),
      reactionCount: row.reaction_count,
      reactions: { cool: row.cool_count, creative: row.creative_count, funny: row.funny_count },
      favoriteVotes: row.favorite_votes,
      createdAt: row.created_at,
    })),
  });
});
