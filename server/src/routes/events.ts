// Event management (start a new LAN, list history, rename). Exactly one
// event is active at a time — starting a new one automatically closes
// whichever was active.

import { Router } from 'express';
import { db } from '../db';
import { listEvents, getActiveEvent, startNewEvent, renameEvent } from '../events';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';
import { isNonEmptyString } from '../validation';

export const eventsRouter = Router();

eventsRouter.get('/', (_req, res) => {
  const active = getActiveEvent();
  res.json(listEvents().map((e) => ({ ...e, isActive: e.id === active.id })));
});

eventsRouter.get('/active', (_req, res) => {
  res.json(getActiveEvent());
});

// POST /api/events - start a new event, closing the current one.
eventsRouter.post('/', (req, res) => {
  const { name } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-80 Zeichen).' });
  }

  const event = startNewEvent(name.trim());

  broadcast(Events.eventsChanged, null);
  // A new event clears live status, so the board needs an immediate refresh
  // rather than waiting for the next agent report.
  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.status(201).json(event);
});

// PATCH /api/events/:id - rename only; doesn't change active/date state.
eventsRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event nicht gefunden.' });

  const { name } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name muss 1-80 Zeichen lang sein.' });
  }

  const updated = renameEvent(req.params.id, name.trim());
  broadcast(Events.eventsChanged, null);
  res.json(updated);
});
