// Personal "missing skill rating" nudge: games currently being played by
// anyone that this player hasn't rated their own skill for yet — surfaced as
// a card on the Home view's "Aktuell" section. Read-only and cheap (one
// indexed lookup), so it's fine to poll on every Home render. (Used to also
// cover an open vote not yet cast and a ready tournament match, but both are
// now already visible via Home's "Aktuell" status cards and the always-on
// header notification banner, so this endpoint dropped them rather than
// keep computing data nothing reads anymore.)

import { Router } from 'express';
import { db } from '../db';

export const digestRouter = Router();

interface GameRow {
  id: string;
  name: string;
  icon: string;
}

// GET /api/digest?playerId=... - this player's currently-unrated, currently-
// live games.
digestRouter.get('/', (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const missingSkills = db
    .prepare(
      `SELECT DISTINCT g.id, g.name, g.icon
       FROM live_status_games lsg
       JOIN games g ON g.id = lsg.game_id
       WHERE NOT EXISTS (SELECT 1 FROM skills s WHERE s.player_id = ? AND s.game_id = lsg.game_id)
       ORDER BY g.name COLLATE NOCASE`
    )
    .all(playerId) as GameRow[];

  res.json({ missingSkills });
});
