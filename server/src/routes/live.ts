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

  const existing = db.prepare('SELECT last_seen FROM live_status WHERE player_id = ?').get(req.params.playerId) as
    | { last_seen: number }
    | undefined;
  const lastSeen = existing ? existing.last_seen : Date.now();

  db.prepare(
    `INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET manual_note = excluded.manual_note`
  ).run(req.params.playerId, lastSeen, normalized);

  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json({ ok: true });
});
