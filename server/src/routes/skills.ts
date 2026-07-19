// Skill ratings per (player, game), 1-10. This is the basis for balanced
// matchmaking (FR-15).

import { Router } from 'express';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isIntInRange } from '../validation';
import { computeSkillSuggestionsForGame, MIN_RESULTS_FOR_SUGGESTION, type SkillSuggestionMatch } from '../skillSuggestion';
import { requireConfiguredUser } from '../sessions';

export const skillsRouter = Router();

interface SkillRow {
  player_id: string;
  game_id: string;
  rating: number;
}

// GET /api/skills - all ratings for the caller's current group, optionally
// filtered by ?playerId= or ?gameId=.
skillsRouter.get('/', (req, res) => {
  const { playerId, gameId } = req.query;
  const clauses: string[] = ['group_id = ?'];
  const params: string[] = [req.group!.id];

  if (typeof playerId === 'string') {
    clauses.push('player_id = ?');
    params.push(playerId);
  }
  if (typeof gameId === 'string') {
    clauses.push('game_id = ?');
    params.push(gameId);
  }

  const rows = db.prepare(`SELECT player_id, game_id, rating FROM skills WHERE ${clauses.join(' AND ')}`).all(...params) as SkillRow[];
  res.json(rows);
});

// GET /api/skills/suggestions - read-only skill hints derived from recorded
// match results (see skillSuggestion.ts), one row per (game, player) that
// has enough decided results in that game. Computed fresh on every request
// rather than cached/stored: at this project's scale (a LAN's worth of
// matches) that's cheap, and it means the suggestion is always exactly
// consistent with the current match history, including edits/deletes.
skillsRouter.get('/suggestions', (req, res) => {
  const games = db.prepare('SELECT id FROM games WHERE group_id = ?').all(req.group!.id) as Array<{ id: string }>;
  const suggestions: Array<{
    gameId: string;
    playerId: string;
    rating: number;
    matchCount: number;
    gamesPlayed: number;
    wins: number;
  }> = [];

  for (const game of games) {
    const rows = db
      .prepare('SELECT result, played_at FROM matches WHERE game_id = ?')
      .all(game.id) as Array<{ result: string; played_at: number }>;
    const decided: SkillSuggestionMatch[] = rows
      .map((r) => ({ ...(JSON.parse(r.result) as Omit<SkillSuggestionMatch, 'playedAt'>), playedAt: r.played_at }))
      .filter((m) => m.winnerTeamIndex !== null);
    if (decided.length < MIN_RESULTS_FOR_SUGGESTION) continue;

    for (const s of computeSkillSuggestionsForGame(decided)) {
      suggestions.push({ gameId: game.id, playerId: s.playerId, rating: s.rating, matchCount: decided.length, gamesPlayed: s.gamesPlayed, wins: s.wins });
    }
  }

  res.json({ suggestions });
});

// PUT /api/skills - upsert a single rating. Idempotent by design so the
// frontend can fire-and-forget on every slider change.
skillsRouter.put('/', requireConfiguredUser, (req, res) => {
  const { playerId, gameId, rating } = req.body ?? {};

  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (req.player && playerId !== req.player.id) {
    return res.status(403).json({ error: 'Du kannst nur deine eigenen Skill-Ratings bearbeiten.' });
  }
  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (!isIntInRange(rating, 1, 10)) {
    return res.status(400).json({ error: 'rating muss eine Ganzzahl zwischen 1 und 10 sein.' });
  }

  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const game = db.prepare('SELECT id FROM games WHERE id = ? AND group_id = ?').get(gameId, req.group!.id);
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  db.prepare(
    `INSERT INTO skills (player_id, game_id, group_id, rating) VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, game_id) DO UPDATE SET rating = excluded.rating`
  ).run(playerId, gameId, req.group!.id, rating);

  broadcast(Events.skillsChanged, null, { groupId: req.group!.id });
  res.json({ playerId, gameId, rating });
});

// DELETE /api/skills/:playerId/:gameId - clear a rating.
skillsRouter.delete('/:playerId/:gameId', requireConfiguredUser, (req, res) => {
  if (req.player && req.params.playerId !== req.player.id) {
    return res.status(403).json({ error: 'Du kannst nur deine eigenen Skill-Ratings bearbeiten.' });
  }
  const result = db
    .prepare('DELETE FROM skills WHERE player_id = ? AND game_id = ? AND group_id = ?')
    .run(req.params.playerId, req.params.gameId, req.group!.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Rating nicht gefunden.' });
  }
  broadcast(Events.skillsChanged, null, { groupId: req.group!.id });
  res.status(204).end();
});
