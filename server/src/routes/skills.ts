// Skill ratings per (player, game), 1-10. This is the basis for balanced
// matchmaking (FR-15).

import { Router } from 'express';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isIntInRange } from '../validation';

export const skillsRouter = Router();

interface SkillRow {
  player_id: string;
  game_id: string;
  rating: number;
}

// GET /api/skills - all ratings, optionally filtered by ?playerId= or ?gameId=.
skillsRouter.get('/', (req, res) => {
  const { playerId, gameId } = req.query;
  const clauses: string[] = [];
  const params: string[] = [];

  if (typeof playerId === 'string') {
    clauses.push('player_id = ?');
    params.push(playerId);
  }
  if (typeof gameId === 'string') {
    clauses.push('game_id = ?');
    params.push(gameId);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM skills ${where}`).all(...params) as SkillRow[];
  res.json(rows);
});

// PUT /api/skills - upsert a single rating. Idempotent by design so the
// frontend can fire-and-forget on every slider change.
skillsRouter.put('/', (req, res) => {
  const { playerId, gameId, rating } = req.body ?? {};

  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (!isIntInRange(rating, 1, 10)) {
    return res.status(400).json({ error: 'rating muss eine Ganzzahl zwischen 1 und 10 sein.' });
  }

  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId);
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  db.prepare(
    `INSERT INTO skills (player_id, game_id, rating) VALUES (?, ?, ?)
     ON CONFLICT(player_id, game_id) DO UPDATE SET rating = excluded.rating`
  ).run(playerId, gameId, rating);

  broadcast(Events.skillsChanged, null);
  res.json({ playerId, gameId, rating });
});

// DELETE /api/skills/:playerId/:gameId - clear a rating.
skillsRouter.delete('/:playerId/:gameId', (req, res) => {
  const result = db
    .prepare('DELETE FROM skills WHERE player_id = ? AND game_id = ?')
    .run(req.params.playerId, req.params.gameId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Rating nicht gefunden.' });
  }
  broadcast(Events.skillsChanged, null);
  res.status(204).end();
});
