// Event management: create/edit events, manage each one's roster, and
// control tracking (at most one event tracks at a time — see events.ts for
// why). Ending an event is separate from just pausing its tracking.

import { Router } from 'express';
import {
  listEvents,
  getEvent,
  getTrackingEvent,
  createEvent,
  updateEvent,
  startTracking,
  stopTracking,
  endEvent,
  getParticipantIds,
  setParticipants,
  OUTSIDE_EVENTS_ID,
  type UpdateEventFields,
} from '../events';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { clearPlayerLiveStatus, getLiveBoard } from '../liveStatus';
import { isNonEmptyString } from '../validation';

export const eventsRouter = Router();

function serializeEvent(event: ReturnType<typeof getEvent>) {
  if (!event) return undefined;
  return {
    id: event.id,
    name: event.name,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    location: event.location,
    description: event.description,
    trackingEnabled: Boolean(event.tracking_enabled),
    isEnded: Boolean(event.ended_at),
    endedAt: event.ended_at,
    isOutsideEvents: event.id === OUTSIDE_EVENTS_ID,
    participantIds: event.id === OUTSIDE_EVENTS_ID ? undefined : getParticipantIds(event.id),
  };
}

// GET /api/events - every real event plus the "außerhalb von Events"
// sentinel (flagged via isOutsideEvents) so filter dropdowns elsewhere in
// the app can just iterate this one list.
eventsRouter.get('/', (_req, res) => {
  const trackingId = getTrackingEvent().id;
  const real = listEvents().map((e) => ({ ...serializeEvent(e), isActive: e.id === trackingId }));
  const outside = serializeEvent(getEvent(OUTSIDE_EVENTS_ID))!;
  res.json([...real, { ...outside, isActive: trackingId === OUTSIDE_EVENTS_ID }]);
});

// GET /api/events/active - the event currently tracking, or the "außerhalb
// von Events" sentinel if none is.
eventsRouter.get('/active', (_req, res) => {
  res.json(serializeEvent(getTrackingEvent()));
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

// Optional timestamp for PATCH (undefined = not provided, null = explicitly
// cleared — only meaningful for endsAt there); POST requires both instead.
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

function parseRequiredTimestamp(value: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${label} ist erforderlich (Zeitstempel in ms).` };
  }
  return { ok: true, value };
}

// POST /api/events - create a new event. Tracking starts OFF — several
// events can exist side by side, so creating one never touches whichever
// event (if any) is currently tracking.
// Body: { name, startsAt, endsAt, location?, description? }
eventsRouter.post('/', (req, res) => {
  const { name, startsAt, endsAt, location, description } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-80 Zeichen).' });
  }

  const parsedStartsAt = parseRequiredTimestamp(startsAt, 'startsAt');
  if (!parsedStartsAt.ok) return res.status(400).json({ error: parsedStartsAt.error });
  const parsedEndsAt = parseRequiredTimestamp(endsAt, 'endsAt');
  if (!parsedEndsAt.ok) return res.status(400).json({ error: parsedEndsAt.error });
  if (parsedEndsAt.value < parsedStartsAt.value) {
    return res.status(400).json({ error: 'endsAt darf nicht vor startsAt liegen.' });
  }
  const parsedLocation = parseOptionalText(location, 80, 'location');
  if (!parsedLocation.ok) return res.status(400).json({ error: parsedLocation.error });
  const parsedDescription = parseOptionalText(description, 500, 'description');
  if (!parsedDescription.ok) return res.status(400).json({ error: parsedDescription.error });

  const event = createEvent(name.trim(), {
    startsAt: parsedStartsAt.value,
    endsAt: parsedEndsAt.value,
    location: parsedLocation.value,
    description: parsedDescription.value,
  });

  broadcast(Events.eventsChanged, null);
  res.status(201).json(serializeEvent(event));
});

// PATCH /api/events/:id - metadata correction only (name/dates/location/
// description); never touches tracking state or live status.
// Body: any subset of { name?, startsAt?, endsAt?, location?, description? }
eventsRouter.patch('/:id', (req, res) => {
  const existing = getEvent(req.params.id);
  if (!existing || existing.id === OUTSIDE_EVENTS_ID) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }

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
  // event whose existing startsAt is later still gets caught. endsAt is
  // required at creation but stays PATCH-clearable (null) for now, matching
  // the general "PATCH only changes what you send" convention.
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
  res.json(serializeEvent(updated));
});

// POST /api/events/:id/tracking/start - 409s (with the conflicting event's
// id/name) if a different event is already tracking.
eventsRouter.post('/:id/tracking/start', (req, res) => {
  const result = startTracking(req.params.id);
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 400;
    return res.status(status).json({
      error: result.error,
      ...(result.conflictEventId ? { conflictEventId: result.conflictEventId, conflictEventName: result.conflictEventName } : {}),
    });
  }
  broadcast(Events.eventsChanged, null);
  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json(serializeEvent(result.event));
});

// POST /api/events/:id/tracking/stop - pauses tracking without ending the
// event; can be resumed with .../tracking/start later.
eventsRouter.post('/:id/tracking/stop', (req, res) => {
  const updated = stopTracking(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  broadcast(Events.eventsChanged, null);
  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json(serializeEvent(updated));
});

// POST /api/events/:id/end - closes the event for good (stops tracking
// first if it was on).
eventsRouter.post('/:id/end', (req, res) => {
  const updated = endEvent(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  broadcast(Events.eventsChanged, null);
  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json(serializeEvent(updated));
});

// PUT /api/events/:id/participants - replace the whole roster.
// Body: { playerIds: string[] }
eventsRouter.put('/:id/participants', (req, res) => {
  const event = getEvent(req.params.id);
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });

  const { playerIds } = req.body ?? {};
  if (!Array.isArray(playerIds) || !playerIds.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'playerIds muss ein String-Array sein.' });
  }
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => '?').join(',');
    const found = db.prepare(`SELECT id FROM players WHERE id IN (${placeholders})`).all(...uniqueIds) as Array<{
      id: string;
    }>;
    if (found.length !== uniqueIds.length) {
      return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
    }
  }

  const previousIds = new Set(getParticipantIds(req.params.id));
  setParticipants(req.params.id, uniqueIds);
  const trackingEvent = getTrackingEvent();
  const removedIds = trackingEvent.id === req.params.id
    ? [...previousIds].filter((playerId) => !uniqueIds.includes(playerId))
    : [];
  for (const playerId of removedIds) clearPlayerLiveStatus(playerId);
  broadcast(Events.eventsChanged, null);
  if (removedIds.length > 0) broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json(serializeEvent(getEvent(req.params.id)));
});
