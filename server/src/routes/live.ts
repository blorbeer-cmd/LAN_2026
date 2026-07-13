// Browser-facing live-status board (FR-13). Sits behind the shared UI access
// token, unlike the agent's own report endpoint.

import { Router } from 'express';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';

export const liveRouter = Router();

const MAX_NOTE_LENGTH = 60;

liveRouter.get('/', (_req, res) => {
  res.json(getLiveBoard());
});

// POST /api/live/:playerId/note - manual override (FR-28), e.g. "Pause/Essen"
// when someone steps away without closing their game, or to clear it again.
// Body: { note: string | null }
liveRouter.post('/:playerId/note', (req, res) => {
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { note } = req.body ?? {};
  if (note !== null && note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH)) {
    return res.status(400).json({ error: `note muss Text (max. ${MAX_NOTE_LENGTH} Zeichen) oder null sein.` });
  }
  const normalized = typeof note === 'string' && note.trim() ? note.trim() : null;

  // Setting or clearing the note is itself a deliberate, current action from
  // the player, so it counts as a fresh sighting just like an agent report
  // does. Without bumping last_seen here, a player whose agent report has
  // already gone stale (closed the game a while ago) would set manual_note
  // only for deriveState to immediately discard it again as stale, making
  // the pause button appear to silently do nothing (see liveStatus.ts).
  db.prepare(
    `INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET last_seen = excluded.last_seen, manual_note = excluded.manual_note`
  ).run(req.params.playerId, Date.now(), normalized);

  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json({ ok: true });
});
