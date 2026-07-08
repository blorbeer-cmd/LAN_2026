// Event management (start a new LAN, list history, edit metadata). Exactly
// one event is active at a time — starting a new one automatically closes
// whichever was active.

import { Router } from 'express';
import { db } from '../db';
import { listEvents, getActiveEvent, startNewEvent, updateEvent, type UpdateEventFields } from '../events';
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

// Optional freeform text (location/description): undefined = not provided,
// '' or null = explicitly cleared, otherwise validated against maxLength.
function parseOptionalText(
  value: unknown,
  maxLength: number,
  label: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    return { ok: false, error: `${label} darf höchstens ${maxLength} Zeichen lang sein.` };
  }
  return { ok: true, value: value.trim() };
}

// Optional timestamp (startsAt/endsAt): undefined = not provided, null =
// explicitly cleared (only meaningful for endsAt), otherwise must be a
// finite number (epoch ms).
function parseOptionalTimestamp(
  value: unknown,
  label: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${label} muss ein Zeitstempel (ms) sein.` };
  }
  return { ok: true, value };
}

// POST /api/events - start a new event, closing the current one.
// Body: { name, startsAt?, endsAt?, location?, description? }
eventsRouter.post('/', (req, res) => {
  const { name, startsAt, endsAt, location, description } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-80 Zeichen).' });
  }

  const parsedStartsAt = parseOptionalTimestamp(startsAt, 'startsAt');
  if (!parsedStartsAt.ok) return res.status(400).json({ error: parsedStartsAt.error });
  const parsedEndsAt = parseOptionalTimestamp(endsAt, 'endsAt');
  if (!parsedEndsAt.ok) return res.status(400).json({ error: parsedEndsAt.error });
  if (parsedStartsAt.value !== null && parsedEndsAt.value !== null && parsedEndsAt.value < parsedStartsAt.value) {
    return res.status(400).json({ error: 'endsAt darf nicht vor startsAt liegen.' });
  }
  const parsedLocation = parseOptionalText(location, 80, 'location');
  if (!parsedLocation.ok) return res.status(400).json({ error: parsedLocation.error });
  const parsedDescription = parseOptionalText(description, 500, 'description');
  if (!parsedDescription.ok) return res.status(400).json({ error: parsedDescription.error });

  const event = startNewEvent(name.trim(), {
    startsAt: parsedStartsAt.value ?? undefined,
    endsAt: parsedEndsAt.value,
    location: parsedLocation.value,
    description: parsedDescription.value,
  });

  broadcast(Events.eventsChanged, null);
  // A new event clears live status, so the board needs an immediate refresh
  // rather than waiting for the next agent report.
  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.status(201).json(event);
});

// PATCH /api/events/:id - metadata correction only (name/dates/location/
// description); never changes which event is active or touches live status.
// Body: any subset of { name?, startsAt?, endsAt?, location?, description? }
eventsRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as
    | { starts_at: number; ends_at: number | null }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Event nicht gefunden.' });

  const { name, startsAt, endsAt, location, description } = req.body ?? {};
  const fields: UpdateEventFields = {};

  if (name !== undefined) {
    if (!isNonEmptyString(name, 80)) return res.status(400).json({ error: 'Name muss 1-80 Zeichen lang sein.' });
    fields.name = name.trim();
  }
  if (startsAt !== undefined) {
    const parsed = parseOptionalTimestamp(startsAt, 'startsAt');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    if (parsed.value !== null) fields.startsAt = parsed.value;
  }
  if (endsAt !== undefined) {
    const parsed = parseOptionalTimestamp(endsAt, 'endsAt');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.endsAt = parsed.value;
  }
  // Validated against the EFFECTIVE start/end (existing values merged with
  // whatever this request is changing), so e.g. patching just endsAt on an
  // event whose existing startsAt is later still gets caught.
  const effectiveStartsAt = fields.startsAt ?? existing.starts_at;
  const effectiveEndsAt = fields.endsAt !== undefined ? fields.endsAt : existing.ends_at;
  if (effectiveEndsAt !== null && effectiveEndsAt < effectiveStartsAt) {
    return res.status(400).json({ error: 'endsAt darf nicht vor startsAt liegen.' });
  }
  if (location !== undefined) {
    const parsed = parseOptionalText(location, 80, 'location');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.location = parsed.value;
  }
  if (description !== undefined) {
    const parsed = parseOptionalText(description, 500, 'description');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.description = parsed.value;
  }

  const updated = updateEvent(req.params.id, fields);
  broadcast(Events.eventsChanged, null);
  res.json(updated);
});
