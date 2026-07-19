// Event management: create/edit events, manage each one's roster, and
// control tracking (at most one event tracks at a time — see events.ts for
// why). Ending an event is separate from just pausing its tracking.

import { Router, type Request, type Response } from 'express';
import {
  cancelEvent,
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
  type EventRow,
} from '../events';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { clearPlayerLiveStatus, getLiveBoard } from '../liveStatus';
import { isNonEmptyString } from '../validation';
import { requireConfiguredGroupMembership, requireGroupRole, resolveGroupResource } from '../groupAuthorization';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { config } from '../config';
import { setEventTrackingConsent } from '../trackingContexts';

export const eventsRouter = Router();

const resolveEvent = resolveGroupResource<EventRow>({
  resourceType: 'Event',
  load: (id) => {
    const event = getEvent(id);
    return event ? { resource: event, groupId: event.group_id } : undefined;
  },
});

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
    groupId: event.group_id,
    status: event.status,
    visibilityScope: event.visibility_scope,
    isOutsideEvents: event.id === OUTSIDE_EVENTS_ID,
    participantIds: event.id === OUTSIDE_EVENTS_ID ? undefined : getParticipantIds(event.id),
  };
}

// GET /api/events - every real event plus the "außerhalb von Events"
// sentinel (flagged via isOutsideEvents) so filter dropdowns elsewhere in
// the app can just iterate this one list.
eventsRouter.get('/', requireConfiguredGroupMembership, (req, res) => {
  const trackingId = getTrackingEvent().id;
  const real = listEvents(req.group!.id).map((e) => ({ ...serializeEvent(e), isActive: e.id === trackingId }));
  const outside = serializeEvent(getEvent(OUTSIDE_EVENTS_ID))!;
  res.json([...real, { ...outside, groupId: req.group!.id, isActive: trackingId === OUTSIDE_EVENTS_ID }]);
});

// GET /api/events/active - the event currently tracking, or the "außerhalb
// von Events" sentinel if none is.
eventsRouter.get('/active', requireConfiguredGroupMembership, (req, res) => {
  const tracking = getTrackingEvent();
  if (tracking.id !== OUTSIDE_EVENTS_ID && tracking.group_id === req.group!.id) {
    res.json(serializeEvent(tracking));
    return;
  }
  res.json({ ...serializeEvent(getEvent(OUTSIDE_EVENTS_ID)), groupId: req.group!.id });
});

eventsRouter.get('/:id', resolveEvent, (req, res) => {
  const event = req.groupResource as EventRow;
  if (event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  res.json(serializeEvent(event));
});

// Event tracking is an explicit personal acceptance, separate from an
// administrator's roster.  In legacy mode the historical roster remains a
// compatibility acceptance; required mode must use this endpoint.
function acceptEventTracking(req: Request, res: Response): void {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) { res.status(404).json({ error: 'Event nicht gefunden.' }); return; }
  setEventTrackingConsent(event.id, event.group_id!, req.player!.id, true);
  res.json({ ok: true, eventId: event.id, accepted: true });
}

eventsRouter.post('/:id/accept', resolveEvent, acceptEventTracking);
eventsRouter.post('/:id/tracking-consent', resolveEvent, acceptEventTracking);

// Optional freeform text (location/description): undefined = not provided,
// '' or null = explicitly cleared, otherwise validated against maxLength.
function parseOptionalText(
  value: unknown,
  maxLength: number,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    return { ok: false, error: `${label} darf höchstens ${maxLength} Zeichen lang sein.` };
  }
  return { ok: true, value: value.trim() };
}

// Optional timestamp parser for PATCH (undefined = not provided). Event
// boundaries themselves stay mandatory; the route rejects a parsed null.
function parseOptionalTimestamp(
  value: unknown,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${label} muss ein Zeitstempel (ms) sein.` };
  }
  return { ok: true, value };
}

function parseRequiredTimestamp(
  value: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${label} ist erforderlich (Zeitstempel in ms).` };
  }
  return { ok: true, value };
}

// POST /api/events - create a new event. Tracking starts OFF — several
// events can exist side by side, so creating one never touches whichever
// event (if any) is currently tracking.
// Body: { name, startsAt, endsAt, location?, description? }
eventsRouter.post('/', requireConfiguredGroupMembership, requireGroupRole('admin'), (req, res) => {
  const { name, startsAt, endsAt, location, description, visibilityScope } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-80 Zeichen).' });
  }

  const parsedStartsAt = parseRequiredTimestamp(startsAt, 'startsAt');
  if (!parsedStartsAt.ok) return res.status(400).json({ error: parsedStartsAt.error });
  const parsedEndsAt = parseRequiredTimestamp(endsAt, 'endsAt');
  if (!parsedEndsAt.ok) return res.status(400).json({ error: parsedEndsAt.error });
  if (parsedEndsAt.value <= parsedStartsAt.value) {
    return res.status(400).json({ error: 'endsAt muss nach startsAt liegen.' });
  }
  const parsedLocation = parseOptionalText(location, 80, 'location');
  if (!parsedLocation.ok) return res.status(400).json({ error: parsedLocation.error });
  const parsedDescription = parseOptionalText(description, 500, 'description');
  if (!parsedDescription.ok) return res.status(400).json({ error: parsedDescription.error });
  if (visibilityScope !== undefined && !['group', 'participants', 'public'].includes(visibilityScope)) {
    return res.status(400).json({ error: 'visibilityScope ist ungültig.' });
  }

  const event = createEvent(name.trim(), {
    groupId: req.player ? req.group!.id : undefined,
    startsAt: parsedStartsAt.value,
    endsAt: parsedEndsAt.value,
    location: parsedLocation.value,
    description: parsedDescription.value,
  });
  if (visibilityScope !== undefined) db.prepare('UPDATE events SET visibility_scope = ? WHERE id = ?').run(visibilityScope, event.id);

  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_created',
    targetType: 'event',
    targetId: event.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  res.status(201).json(serializeEvent(event));
});

// PATCH /api/events/:id - metadata correction only (name/dates/location/
// description); never touches tracking state or live status.
// Body: any subset of { name?, startsAt?, endsAt?, location?, description? }
eventsRouter.patch('/:id', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const existing = req.groupResource as EventRow;
  if (!existing || existing.id === OUTSIDE_EVENTS_ID) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }

  const { name, startsAt, endsAt, location, description, visibilityScope } = req.body ?? {};
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
    if (parsed.value === null) return res.status(400).json({ error: 'endsAt darf nicht leer sein.' });
    fields.endsAt = parsed.value;
  }
  // Validated against the EFFECTIVE start/end (existing values merged with
  // whatever this request is changing), so e.g. patching just endsAt on an
  // event whose existing startsAt is later still gets caught. endsAt is
  // required at creation and remains required during PATCH.
  const effectiveStartsAt = fields.startsAt ?? existing.starts_at;
  const effectiveEndsAt = fields.endsAt !== undefined ? fields.endsAt : existing.ends_at;
  if (effectiveEndsAt === null || effectiveEndsAt <= effectiveStartsAt) {
    return res.status(400).json({ error: 'endsAt muss nach startsAt liegen.' });
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
  if (visibilityScope !== undefined) {
    if (!['group', 'participants', 'public'].includes(visibilityScope)) return res.status(400).json({ error: 'visibilityScope ist ungültig.' });
    fields.visibilityScope = visibilityScope;
  }

  const updated = updateEvent(req.params.id, fields);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_updated',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  res.json(serializeEvent(updated));
});

// POST /api/events/:id/tracking/start - 409s (with the conflicting event's
// id/name) if a different event is already tracking.
eventsRouter.post('/:id/tracking/start', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const result = startTracking(req.params.id);
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 400;
    const conflict = result.conflictEventId ? getEvent(result.conflictEventId) : undefined;
    const visibleConflict = conflict?.group_id === req.group!.id;
    return res.status(status).json({
      error:
        result.code === 'conflict' && !visibleConflict
          ? 'Tracking läuft bereits in einem anderen Gruppenkontext.'
          : result.error,
      ...(visibleConflict
        ? { conflictEventId: result.conflictEventId, conflictEventName: result.conflictEventName }
        : {}),
    });
  }
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_tracking_started',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.json(serializeEvent(result.event));
});

// POST /api/events/:id/tracking/stop - pauses tracking without ending the
// event; can be resumed with .../tracking/start later.
eventsRouter.post('/:id/tracking/stop', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const updated = stopTracking(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_tracking_stopped',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.json(serializeEvent(updated));
});

// POST /api/events/:id/end - closes the event for good (stops tracking
// first if it was on).
eventsRouter.post('/:id/end', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const updated = endEvent(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_ended',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.json(serializeEvent(updated));
});

// PUT /api/events/:id/participants - replace the whole roster.
// Body: { playerIds: string[] }
eventsRouter.put('/:id/participants', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });

  const { playerIds } = req.body ?? {};
  if (!Array.isArray(playerIds) || !playerIds.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'playerIds muss ein String-Array sein.' });
  }
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => '?').join(',');
    const found = (
      config.authMode === 'legacy'
        ? db.prepare(`SELECT id FROM players WHERE id IN (${placeholders})`).all(...uniqueIds)
        : db
            .prepare(
              `SELECT p.id
             FROM players p
             JOIN group_memberships gm ON gm.player_id = p.id
             WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
               AND p.id IN (${placeholders})`,
            )
            .all(req.group!.id, ...uniqueIds)
    ) as Array<{
      id: string;
    }>;
    if (found.length !== uniqueIds.length) {
      return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
    }
  }

  const previousIds = new Set(getParticipantIds(req.params.id));
  setParticipants(req.params.id, uniqueIds);
  const trackingEvent = getTrackingEvent();
  const removedIds =
    trackingEvent.id === req.params.id ? [...previousIds].filter((playerId) => !uniqueIds.includes(playerId)) : [];
  for (const playerId of removedIds) clearPlayerLiveStatus(playerId);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_participants_updated',
    targetType: 'event',
    targetId: req.params.id,
    details: { participantCount: uniqueIds.length },
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  if (removedIds.length > 0) broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.json(serializeEvent(getEvent(req.params.id)));
});

eventsRouter.delete('/:id', resolveEvent, requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  const cancelled = cancelEvent(req.params.id);
  if (!cancelled) return res.status(409).json({ error: 'Laufende oder beendete Events können nicht abgesagt werden.' });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_cancelled',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  res.json(serializeEvent(cancelled));
});
