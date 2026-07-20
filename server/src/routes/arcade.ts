import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { openLobbySummaries as quizLobbies } from '../arcade/arcade';
import { openLobbySummaries as tetrisLobbies } from '../arcade/tetris';
import { openLobbySummaries as scribbleLobbies } from '../arcade/scribble';
import { openLobbySummaries as blobbyLobbies } from '../arcade/blobby';
import { openLobbySummaries as pongLobbies } from '../arcade/pong';
import { openLobbySummaries as snakeLobbies } from '../arcade/snake';
import { resolveGroupEventScope } from '../groupEventScope';
import { config } from '../config';

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
  id: string;
  event_id: string | null;
  game_type: string;
  winner_id: string | null;
  players: string;
  scores: string;
  reason: string;
  started_at: number;
  ended_at: number;
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

function eventFilter(
  groupId: string,
  requested: unknown,
): { ok: true; eventId?: string | null } | { ok: false; status: 400 | 404; error: string } {
  if (requested === undefined) return { ok: true };
  const resolved = resolveGroupEventScope(groupId, requested);
  return resolved.ok ? { ok: true, eventId: resolved.eventId } : resolved;
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resultPayload(row: ArcadeResultRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    gameType: row.game_type,
    title: ARCADE_TITLES[row.game_type] ?? row.game_type,
    winnerId: row.winner_id,
    players: parseJsonArray(row.players),
    scores: parseJsonArray(row.scores),
    reason: row.reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

// GET /api/arcade/lobbies - every currently open lobby across all arcade
// games, newest first, for the Home view's "Aktuell" card. Lobbies live
// in-memory in their socket modules (short-lived party state, not data),
// so this just aggregates their summaries.
arcadeRouter.get('/lobbies', (req, res) => {
  const selectedEvent = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!selectedEvent.ok) return res.status(selectedEvent.status).json({ error: selectedEvent.error });
  if (config.authMode === 'required' && selectedEvent.eventId) {
    const mayAccess = req.groupMembership?.role === 'admin' || req.groupMembership?.role === 'owner' || Boolean(
      db.prepare('SELECT 1 FROM event_participants WHERE event_id = ? AND player_id = ?').get(
        selectedEvent.eventId,
        req.player?.id,
      ),
    );
    if (!mayAccess) return res.json({ lobbies: [] });
  }
  const groupId = req.group!.id;
  const eventId = selectedEvent.eventId;
  const lobbies = [
    ...quizLobbies(groupId, eventId).map((l) => ({ ...l, gameType: 'quiz' })),
    ...tetrisLobbies(groupId, eventId).map((l) => ({ ...l, gameType: 'tetris' })),
    ...scribbleLobbies(groupId, eventId).map((l) => ({ ...l, gameType: 'scribble' })),
    ...pongLobbies(groupId, eventId).map((l) => ({ ...l, gameType: 'pong' })),
    ...blobbyLobbies(groupId, eventId).map((l) => ({ ...l, gameType: 'blobby' })),
    ...snakeLobbies(groupId, eventId).map((l) => ({ ...l, gameType: 'snake' })),
  ]
    .map((l) => ({ ...l, title: ARCADE_TITLES[l.gameType] ?? l.gameType }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ lobbies });
});

arcadeRouter.get('/stats', (req, res) => {
  const selectedEvent = eventFilter(req.group!.id, req.query.eventId);
  if (!selectedEvent.ok) return res.status(selectedEvent.status).json({ error: selectedEvent.error });
  const clauses = ["group_id = ?", "reason = 'completed'"];
  const params: Array<string | null> = [req.group!.id];
  if (selectedEvent.eventId !== undefined) {
    clauses.push('event_id IS ?');
    params.push(selectedEvent.eventId);
  }
  const rows = db
    .prepare(
      `SELECT id, event_id, game_type, winner_id, players, scores, reason, started_at, ended_at
       FROM arcade_results
       WHERE ${clauses.join(' AND ')}
       ORDER BY ended_at DESC`
    )
    .all(...params) as ArcadeResultRow[];

  const games = new Map<
    string,
    { gameType: string; matches: number; players: Map<string, { playerId: string; name: string; matches: number; wins: number }> }
  >();

  for (const row of rows) {
    const parsed = parseJsonArray(row.scores);
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

  const drawingClauses = ['d.group_id = ?'];
  const drawingParams: Array<string | null> = [req.group!.id];
  if (selectedEvent.eventId !== undefined) {
    drawingClauses.push('d.event_id IS ?');
    drawingParams.push(selectedEvent.eventId);
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
     WHERE ${drawingClauses.join(' AND ')}
     GROUP BY d.artist_id, d.artist_name
     ORDER BY round_wins DESC, favorites DESC, reactions DESC, name COLLATE NOCASE`
  ).all(...drawingParams) as ScribbleArtStatsRow[];

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

arcadeRouter.get('/scribble/gallery', (req, res) => {
  const selectedEvent = eventFilter(req.group!.id, req.query.eventId);
  if (!selectedEvent.ok) return res.status(selectedEvent.status).json({ error: selectedEvent.error });
  const clauses = ['d.group_id = ?', 'd.is_round_winner = 1'];
  const params: Array<string | null> = [req.group!.id];
  if (selectedEvent.eventId !== undefined) {
    clauses.push('d.event_id IS ?');
    params.push(selectedEvent.eventId);
  }
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
     WHERE ${clauses.join(' AND ')}
     GROUP BY d.id
     ORDER BY d.created_at DESC
     LIMIT 50`
  ).all(...params) as Array<{
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

function listResults(req: Request, res: Response) {
  const selectedEvent = eventFilter(req.group!.id, req.query.eventId);
  if (!selectedEvent.ok) return res.status(selectedEvent.status).json({ error: selectedEvent.error });
  const clauses = ['r.group_id = ?'];
  const params: Array<string | number | null> = [req.group!.id];
  if (selectedEvent.eventId !== undefined) {
    clauses.push('r.event_id IS ?');
    params.push(selectedEvent.eventId);
  }
  if (req.query.gameType !== undefined) {
    if (typeof req.query.gameType !== 'string' || !ARCADE_TITLES[req.query.gameType]) {
      return res.status(400).json({ error: 'gameType ist ungültig.' });
    }
    clauses.push('r.game_type = ?');
    params.push(req.query.gameType);
  }
  if (req.query.playerId !== undefined) {
    if (typeof req.query.playerId !== 'string' || !req.query.playerId) {
      return res.status(400).json({ error: 'playerId ist ungültig.' });
    }
    const known = db.prepare(
      'SELECT 1 FROM group_memberships WHERE group_id = ? AND player_id = ?',
    ).get(req.group!.id, req.query.playerId);
    if (!known) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
    clauses.push(
      'EXISTS (SELECT 1 FROM arcade_result_participants p WHERE p.group_id = r.group_id AND p.result_id = r.id AND p.player_id = ?)',
    );
    params.push(req.query.playerId);
  }
  let limit = 50;
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)) {
      return res.status(400).json({ error: 'limit muss zwischen 1 und 100 liegen.' });
    }
    limit = Number(req.query.limit);
    if (limit < 1 || limit > 100) return res.status(400).json({ error: 'limit muss zwischen 1 und 100 liegen.' });
  }
  params.push(limit);
  const rows = db.prepare(
    `SELECT r.id, r.event_id, r.game_type, r.winner_id, r.players, r.scores,
            r.reason, r.started_at, r.ended_at
     FROM arcade_results r
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.ended_at DESC
     LIMIT ?`,
  ).all(...params) as ArcadeResultRow[];
  res.json({ results: rows.map(resultPayload) });
}

// Session-bound historical readers. /history is retained as the semantic UI
// endpoint while /results is useful to API clients; both share one contract.
arcadeRouter.get('/results', listResults);
arcadeRouter.get('/history', listResults);

arcadeRouter.get('/results/:id', (req, res) => {
  const row = db.prepare(
    `SELECT id, event_id, game_type, winner_id, players, scores, reason, started_at, ended_at
     FROM arcade_results WHERE id = ? AND group_id = ?`,
  ).get(req.params.id, req.group!.id) as ArcadeResultRow | undefined;
  if (!row) return res.status(404).json({ error: 'Arcade-Ergebnis nicht gefunden.' });
  res.json(resultPayload(row));
});
