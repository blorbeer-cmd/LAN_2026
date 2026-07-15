// "Bock"-Ratings per (player, game), 1-10: how much a player currently feels
// like playing it, kept separate from skills.rating (how good they are).
// Meant to be changed on a whim throughout the LAN, aggregated across all
// players into a game's "Beliebtheit" and used to pre-sort/display the
// voting view (see routes/votes.ts).

import { Router } from 'express';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isIntInRange } from '../validation';
import { withBodyPlayerIdentity, withParamPlayerIdentity } from '../sessions';

export const preferencesRouter = Router();

interface PreferenceRow {
  player_id: string;
  game_id: string;
  rating: number;
}

// GET /api/preferences - all ratings, optionally filtered by ?playerId= or ?gameId=.
preferencesRouter.get('/', (req, res) => {
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
  const rows = db.prepare(`SELECT * FROM preferences ${where}`).all(...params) as PreferenceRow[];
  res.json(rows);
});

// PUT /api/preferences - upsert a single rating. Idempotent by design so the
// frontend can fire-and-forget on every slider change.
preferencesRouter.put('/', ...withBodyPlayerIdentity, (req, res) => {
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
    `INSERT INTO preferences (player_id, game_id, rating) VALUES (?, ?, ?)
     ON CONFLICT(player_id, game_id) DO UPDATE SET rating = excluded.rating`
  ).run(playerId, gameId, rating);

  // Carries the changed row directly (rather than just a "something changed"
  // null, like skills.ts does) so the frontend can patch its local state and
  // re-sort the voting view instantly instead of waiting on a full reload.
  broadcast(Events.preferencesChanged, { playerId, gameId, rating });
  res.json({ playerId, gameId, rating });
});

// DELETE /api/preferences/:playerId/:gameId - clear a rating.
preferencesRouter.delete('/:playerId/:gameId', ...withParamPlayerIdentity(), (req, res) => {
  const { playerId, gameId } = req.params;
  const result = db.prepare('DELETE FROM preferences WHERE player_id = ? AND game_id = ?').run(playerId, gameId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Rating nicht gefunden.' });
  }
  broadcast(Events.preferencesChanged, { playerId, gameId, rating: null });
  res.status(204).end();
});
