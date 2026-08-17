// Event management: create/edit events, manage each one's roster, and
// control tracking independently for the requesting account's selected
// account. Ending an event is separate from just pausing its tracking.

import { Router, type Request, type Response } from 'express';
import {
  cancelEvent,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  startTracking,
  restartEvent,
  stopTracking,
  endEvent,
  getParticipantIds,
  getEventParticipants,
  inviteParticipant,
  isParticipant,
  removeEventParticipant,
  respondToEventInvitation,
  setParticipants,
  OUTSIDE_EVENTS_ID,
  type UpdateEventFields,
  type EventRow,
} from '../events';
import { BASE_EVENT_ID, db } from '../db';
import { broadcast, Events, switchPlayerEventScope } from '../realtime';
import { clearPlayerLiveStatus, getLiveBoard } from '../liveStatus';
import { notifyPlayers, resolvePushTopic } from '../push';
import { isNonEmptyString } from '../validation';
import { requireConfiguredGroupMembership, requireGroupRole, resolveGroupResource } from '../groupAuthorization';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { setEventTrackingConsent } from '../trackingContexts';
import { activeGroupPlayers } from '../groupPlayers';
import { createPersistentBackup } from '../backupService';
import { eventAccessLevel, getOrRepairActiveEvent } from '../eventContext';

export const eventsRouter = Router();

// One key per invited account so accepting or declining retires exactly that
// invitation's notification and never a parallel one for another event.
function eventInvitationTopicKey(eventId: string, playerId: string): string {
  return `event-invitation:${eventId}:${playerId}`;
}

let eventLifecycleQueue: Promise<void> = Promise.resolve();

function enqueueEventLifecycle<T>(operation: () => T | Promise<T>): Promise<T> {
  const pending = eventLifecycleQueue.then(operation, operation);
  eventLifecycleQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function startTrackingWithBackup(id: string, reopenEnded = false) {
  const operation = async () => {
    const event = getEvent(id);
    const canStart = Boolean(
      event &&
      event.id !== OUTSIDE_EVENTS_ID &&
      event.status !== 'cancelled' &&
      !event.tracking_enabled &&
      (reopenEnded ? Boolean(event.ended_at && event.status === 'ended') : !event.ended_at),
    );
    if (canStart) {
      try {
        await createPersistentBackup('pre-event');
      } catch (error) {
        return { backupError: error } as const;
      }
    }
    return { result: reopenEnded ? restartEvent(id) : startTracking(id) } as const;
  };
  return enqueueEventLifecycle(operation);
}

const resolveEvent = resolveGroupResource<EventRow>({
  resourceType: 'Event',
  load: (id) => {
    const event = getEvent(id);
    return event ? { resource: event, groupId: event.group_id } : undefined;
  },
});

// The management shape is a strict superset of the summary shape below, so a
// reader never has to know which of the two it got: both name the same value
// the same way. Before that, `starts_at` here versus `startsAt` there made
// every member-visible event render as "Invalid Date".
function serializeEvent(event: ReturnType<typeof getEvent>) {
  if (!event) return undefined;
  return {
    ...serializeEventSummary(event as EventRow),
    endedAt: event.ended_at,
    groupId: event.group_id,
    visibilityScope: event.visibility_scope,
    isOutsideEvents: event.id === OUTSIDE_EVENTS_ID,
    participantIds: event.id === OUTSIDE_EVENTS_ID ? undefined : getParticipantIds(event.id),
    participants: event.id === OUTSIDE_EVENTS_ID ? undefined : getEventParticipants(event.id),
  };
}

function requestPlayerId(req: Request): string | undefined {
  return req.player?.id;
}

function activeContextPlayerIds(eventId: string): string[] {
  return (
    db.prepare('SELECT player_id FROM player_event_contexts WHERE active_event_id = ?').all(eventId) as Array<{
      player_id: string;
    }>
  ).map((row) => row.player_id);
}

// `trackingEnabled`/`isEnded` are part of the summary rather than management
// data: the workspace switcher shows the state of every event it offers, and
// a member only ever receives this shape. They describe the event itself, not
// anything about its participants, so an invitation teaser may carry them too.
function serializeEventSummary(event: EventRow) {
  return {
    id: event.id,
    name: event.name,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    location: event.location,
    description: event.description,
    status: event.status,
    isBase: event.id === BASE_EVENT_ID,
    trackingEnabled: Boolean(event.tracking_enabled),
    isEnded: Boolean(event.ended_at),
  };
}

// GET /api/events - the account's active workspace, accepted workspaces and
// invitation teasers. Admins additionally receive the full management list.
eventsRouter.get('/', requireConfiguredGroupMembership, (req, res) => {
  const playerId = req.player!.id;
  const activeEvent = getOrRepairActiveEvent(playerId);
  const availableEvents = db
    .prepare(
      `SELECT e.*
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       WHERE ep.player_id = ? AND ep.status = 'accepted'
         AND e.id != ? AND e.group_id = ? AND e.status = 'published' AND e.ended_at IS NULL
       ORDER BY e.id = ? DESC, e.starts_at DESC, e.name COLLATE NOCASE`,
    )
    .all(playerId, OUTSIDE_EVENTS_ID, req.group!.id, BASE_EVENT_ID) as EventRow[];
  const invitations = db
    .prepare(
      `SELECT e.*
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       WHERE ep.player_id = ? AND ep.status = 'invited'
         AND e.id != ? AND e.group_id = ? AND e.status = 'published' AND e.ended_at IS NULL
       ORDER BY e.starts_at, e.name COLLATE NOCASE`,
    )
    .all(playerId, OUTSIDE_EVENTS_ID, req.group!.id) as EventRow[];
  // The personal-analytics allowlist, mirroring resolveAnalyticsEvents on the
  // server: every event this account accepted at some point, ended ones
  // included. `availableEvents` cannot serve that purpose because it is the
  // set of *selectable workspaces* and therefore excludes finished events —
  // without this list the event filters in Auswertungen and Meine Statistiken
  // could no longer name a past LAN the account actually attended
  // (docs/KONZEPT-EVENT-SICHTBARKEIT.md, Abschnitte 4.3 und 4.4).
  const historicalEvents = db
    .prepare(
      // Cancelled events are excluded even though the server-side allowlist
      // in historicallyParticipatedEventIds() still contains them: cancelling
      // leaves roster and history rows untouched, so an accepted event that
      // was called off would otherwise show up as a filter option for a LAN
      // that never happened — and eventStatus() has no vocabulary for it, so
      // it would be labelled "Nicht aktiv". Narrowing here keeps this list a
      // strict subset of what the analytics endpoints accept, so an offered
      // option can still never answer with a 404.
      `SELECT e.*
       FROM events e
       JOIN event_participation_history h ON h.event_id = e.id
       WHERE h.player_id = ? AND h.accepted_at IS NOT NULL
         AND e.id != ? AND e.group_id = ? AND e.status != 'cancelled'
       ORDER BY e.starts_at DESC, e.name COLLATE NOCASE`,
    )
    .all(playerId, OUTSIDE_EVENTS_ID, req.group!.id) as EventRow[];
  const canManage = req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
  const managedEvents = canManage
    ? listEvents(req.group!.id)
        .filter((event) => event.id !== BASE_EVENT_ID)
        .map((event) => serializeEvent(event))
    : undefined;
  res.json({
    activeEvent: {
      ...serializeEventSummary(activeEvent as EventRow),
      // Every picker that draws teams, starts a draft or creates a
      // tournament must offer only players who can actually be entered as
      // participants of this workspace (see competitionPlayersBelongToGroup)
      // — otherwise a non-participant selected from the full roster fails
      // that check with a confusing 404 on submit. Accepted-only, like
      // getParticipantIds elsewhere.
      participantIds: getParticipantIds(activeEvent.id),
    },
    availableEvents: availableEvents.map(serializeEventSummary),
    historicalEvents: historicalEvents.map(serializeEventSummary),
    invitations: invitations.map((event) => ({ ...serializeEventSummary(event), participationStatus: 'invited' })),
    ...(managedEvents ? { managedEvents } : {}),
  });
});

// GET /api/events/active - this account's persisted workspace.
eventsRouter.get('/active', requireConfiguredGroupMembership, (req, res) => {
  res.json(serializeEventSummary(getOrRepairActiveEvent(req.player!.id) as EventRow));
});

eventsRouter.get('/:id', resolveEvent, (req, res) => {
  const event = req.groupResource as EventRow;
  if (event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  const access = eventAccessLevel(event.id, req.player!.id, req.groupMembership!.role);
  if (access === 'none') return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (access === 'teaser') {
    return res.json({ ...serializeEventSummary(event), participationStatus: 'invited' });
  }
  if (access === 'participant') {
    return res.json({
      ...serializeEventSummary(event),
      participantIds: getParticipantIds(event.id),
    });
  }
  return res.json(serializeEvent(event));
});

// Event tracking is an explicit personal decision, separate from an
// administrator's roster.
function updateEventTrackingConsent(req: Request, res: Response, granted: boolean): void {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) { res.status(404).json({ error: 'Event nicht gefunden.' }); return; }
  const playerId = requestPlayerId(req);
  if (!playerId) { res.status(400).json({ error: 'Spieleridentität ist erforderlich.' }); return; }
  if (granted && !isParticipant(event.id, playerId)) {
    res.status(409).json({ error: 'Tracking kann erst nach Annahme der Event-Einladung aktiviert werden.' });
    return;
  }
  setEventTrackingConsent(event.id, event.group_id!, playerId, granted);
  if (!granted) {
    broadcast(Events.liveStatusChanged, getLiveBoard(event.group_id!, event.id), {
      groupId: event.group_id!,
      eventId: event.id,
    });
  }
  res.json({ ok: true, eventId: event.id, accepted: granted });
}

// Compatibility alias: this historical route always grants consent.
eventsRouter.post('/:id/accept', resolveEvent, (req, res) => updateEventTrackingConsent(req, res, true));
eventsRouter.post('/:id/tracking-consent', resolveEvent, (req, res) => {
  const granted = req.body?.granted ?? true;
  if (typeof granted !== 'boolean') {
    return res.status(400).json({ error: 'granted muss ein Boolean sein.' });
  }
  updateEventTrackingConsent(req, res, granted);
});

// POST /api/events/:id/invitations - invite (or re-invite) one active group
// member. Existing invited/accepted rows are idempotent; a declined row is
// reopened as invited.
eventsRouter.post('/:id/invitations', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (event.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Das Basis-Event umfasst automatisch alle aktiven Konten.' });
  }
  if (event.ended_at || event.status === 'ended') {
    return res.status(409).json({ error: 'Für beendete Events können keine neuen Einladungen gesendet werden.' });
  }
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId || playerId.length > 200) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }

  const result = inviteParticipant(event.id, playerId);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.group!.id,
    action: result.changed ? 'event_participant_invited' : 'event_participant_invite_repeated',
    targetType: 'event_participant',
    targetId: `${event.id}:${playerId}`,
    details: { eventId: event.id, playerId, status: result.participant.status },
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  // An invitation has to reach a phone whose app isn't open — that is the
  // whole point of a private event nobody can see yet. Only on an actual
  // status change, so a re-invite (or a double tap) doesn't ping again.
  //
  // Deliberately scoped to the base event, not to `event.id`: notifyPlayers
  // only delivers to accepted participants of its scope event, and the
  // invitee is precisely the one who has not accepted this event yet. The
  // base workspace covers every active account, so it is the only scope that
  // can carry an invitation. The topic key lets accept/decline retire the
  // banner again.
  if (result.changed) {
    notifyPlayers(
      [playerId],
      {
        title: 'Event-Einladung',
        body: `${event.name}: Du wurdest eingeladen.`,
        url: '/#events',
      },
      'direct',
      { key: eventInvitationTopicKey(event.id, playerId) },
      { groupId: req.group!.id, eventId: BASE_EVENT_ID },
    );
  }
  res.status(result.changed ? 201 : 200).json(result.participant);
});

function answerEventInvitation(response: 'accepted' | 'declined') {
  return (req: Request, res: Response): Response => {
    const event = req.groupResource as EventRow;
    if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
    if (event.id === BASE_EVENT_ID) {
      return res.status(409).json({ error: 'Die Teilnahme am Basis-Event kann nicht geändert werden.' });
    }
    const playerId = requestPlayerId(req);
    if (!playerId) return res.status(400).json({ error: 'Spieleridentität ist erforderlich.' });

    const result = respondToEventInvitation(event.id, playerId, response);
    if (!result.ok) {
      return res.status(409).json({
        error:
          result.currentStatus === null
            ? 'Für dieses Event liegt keine Einladung vor.'
            : 'Die Einladung ist nicht mehr offen.',
        currentStatus: result.currentStatus,
      });
    }
    writeAdminAudit({
      actorPlayerId: req.player?.id ?? playerId,
      groupId: req.group!.id,
      action: response === 'accepted' ? 'event_invitation_accepted' : 'event_invitation_declined',
      targetType: 'event_participant',
      targetId: `${event.id}:${playerId}`,
      details: { eventId: event.id, playerId, status: response, changed: result.changed },
    });
    broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
    // The invitation has been answered, so its notification stops being an
    // open item. Same base-event scope the invitation push was recorded in.
    resolvePushTopic(eventInvitationTopicKey(event.id, playerId), false, {
      groupId: req.group!.id,
      eventId: BASE_EVENT_ID,
    });
    return res.json(result.participant);
  };
}

eventsRouter.post('/:id/invitation/accept', resolveEvent, answerEventInvitation('accepted'));
eventsRouter.post('/:id/invitation/decline', resolveEvent, answerEventInvitation('declined'));

// DELETE /api/events/:id/participants/:playerId - administrative removal
// remains distinct from a member declining their own invitation.
eventsRouter.delete('/:id/participants/:playerId', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (event.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Teilnehmer des Basis-Events können nicht entfernt werden.' });
  }
  const wasActiveContext = activeContextPlayerIds(event.id).includes(req.params.playerId);
  const previousStatus = removeEventParticipant(event.id, req.params.playerId);
  if (previousStatus === null) return res.status(404).json({ error: 'Event-Teilnehmer nicht gefunden.' });
  // Withdrawing is the third way an invitation stops being open, next to
  // accept and decline. Without this its notification keeps asking about an
  // event the account can no longer even see.
  resolvePushTopic(eventInvitationTopicKey(event.id, req.params.playerId), false, {
    groupId: req.group!.id,
    eventId: BASE_EVENT_ID,
  });
  if (wasActiveContext) switchPlayerEventScope(req.params.playerId, req.group!.id, BASE_EVENT_ID);

  if (previousStatus === 'accepted' && event.tracking_enabled) {
    clearPlayerLiveStatus(req.params.playerId, Date.now(), event.id);
    broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id, event.id), {
      groupId: req.group!.id,
      eventId: event.id,
    });
  }
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.group!.id,
    action: 'event_participant_removed',
    targetType: 'event_participant',
    targetId: `${event.id}:${req.params.playerId}`,
    details: { eventId: event.id, playerId: req.params.playerId, previousStatus },
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  return res.status(204).end();
});

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
  if (visibilityScope !== undefined && visibilityScope !== 'participants') {
    return res.status(400).json({ error: 'Events sind ausschließlich für angenommene Teilnehmende sichtbar.' });
  }

  const event = createEvent(name.trim(), {
    groupId: req.player ? req.group!.id : undefined,
    startsAt: parsedStartsAt.value,
    endsAt: parsedEndsAt.value,
    location: parsedLocation.value,
    description: parsedDescription.value,
  });

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
  if (existing.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Das dauerhaft offene Basis-Event kann nicht bearbeitet werden.' });
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
    if (visibilityScope !== 'participants') {
      return res.status(400).json({ error: 'Events sind ausschließlich für angenommene Teilnehmende sichtbar.' });
    }
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

// POST /api/events/:id/tracking/start - starts this event's independent
// tracking window. Overlapping events may track simultaneously.
eventsRouter.post('/:id/tracking/start', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  const attempt = await startTrackingWithBackup(req.params.id);
  if ('backupError' in attempt) {
    // eslint-disable-next-line no-console
    console.error('Pre-event backup failed:', attempt.backupError);
    return res.status(503).json({
      error: 'Sicherungs-Snapshot fehlgeschlagen. Eventstart wurde zur Sicherheit abgebrochen.',
    });
  }
  const { result } = attempt;
  if (!result.ok) {
    return res.status(result.code === 'not_found' ? 404 : 400).json({ error: result.error });
  }
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_tracking_started',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id, req.params.id), {
    groupId: req.group!.id,
    eventId: req.params.id,
  });
  res.json(serializeEvent(result.event));
});

// POST /api/events/:id/restart - reopens an ended event and starts tracking.
eventsRouter.post('/:id/restart', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  const attempt = await startTrackingWithBackup(req.params.id, true);
  if ('backupError' in attempt) {
    // eslint-disable-next-line no-console
    console.error('Pre-event backup failed:', attempt.backupError);
    return res.status(503).json({
      error: 'Sicherungs-Snapshot fehlgeschlagen. Neustart wurde zur Sicherheit abgebrochen.',
    });
  }
  const { result } = attempt;
  if (!result.ok) {
    return res.status(result.code === 'not_found' ? 404 : 400).json({ error: result.error });
  }
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_restarted',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id, req.params.id), {
    groupId: req.group!.id,
    eventId: req.params.id,
  });
  res.json(serializeEvent(result.event));
});

// POST /api/events/:id/tracking/stop - pauses tracking without ending the
// event; can be resumed with .../tracking/start later.
eventsRouter.post('/:id/tracking/stop', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  const updated = await enqueueEventLifecycle(() => stopTracking(req.params.id));
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_tracking_stopped',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id, req.params.id), {
    groupId: req.group!.id,
    eventId: req.params.id,
  });
  res.json(serializeEvent(updated));
});

// POST /api/events/:id/end - closes the event for good (stops tracking
// first if it was on).
eventsRouter.post('/:id/end', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  if (req.params.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Das dauerhaft offene Basis-Event kann nicht beendet werden.' });
  }
  const { affectedPlayers, updated } = await enqueueEventLifecycle(() => ({
    affectedPlayers: activeContextPlayerIds(req.params.id),
    updated: endEvent(req.params.id),
  }));
  if (!updated) return res.status(404).json({ error: 'Event nicht gefunden.' });
  for (const playerId of affectedPlayers) switchPlayerEventScope(playerId, req.group!.id, BASE_EVENT_ID);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_ended',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id, req.params.id), {
    groupId: req.group!.id,
    eventId: req.params.id,
  });
  res.json(serializeEvent(updated));
});

// PUT /api/events/:id/participants - replace the whole roster.
// Body: { playerIds: string[] }
eventsRouter.put('/:id/participants', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (event.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Die Teilnehmerliste des Basis-Events wird automatisch gepflegt.' });
  }

  const { playerIds } = req.body ?? {};
  if (!Array.isArray(playerIds) || !playerIds.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'playerIds muss ein String-Array sein.' });
  }
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => '?').join(',');
    const found = db
      .prepare(
        `SELECT p.id
         FROM players p
         JOIN group_memberships gm ON gm.player_id = p.id
         WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
           AND p.id IN (${placeholders})`,
      )
      .all(req.group!.id, ...uniqueIds) as Array<{
      id: string;
    }>;
    if (found.length !== uniqueIds.length) {
      return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
    }
  }

  const previousIds = new Set(getParticipantIds(req.params.id));
  const activeBefore = new Set(activeContextPlayerIds(req.params.id));
  setParticipants(req.params.id, uniqueIds);
  const rosterRemovedIds = [...previousIds].filter((playerId) => !uniqueIds.includes(playerId));
  for (const playerId of rosterRemovedIds) {
    if (activeBefore.has(playerId)) switchPlayerEventScope(playerId, req.group!.id, BASE_EVENT_ID);
  }
  const removedIds = event.tracking_enabled ? rosterRemovedIds : [];
  for (const playerId of removedIds) clearPlayerLiveStatus(playerId, Date.now(), event.id);
  // Replacing the roster resolves every open invitation for this event too:
  // the named accounts are accepted outright, everyone else is gone. Either
  // way no teaser is left for the notification to point at.
  for (const playerId of new Set([...previousIds, ...uniqueIds])) {
    resolvePushTopic(eventInvitationTopicKey(event.id, playerId), false, {
      groupId: req.group!.id,
      eventId: BASE_EVENT_ID,
    });
  }
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_participants_updated',
    targetType: 'event',
    targetId: req.params.id,
    details: { participantCount: uniqueIds.length },
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  if (removedIds.length > 0) {
    broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id, event.id), {
      groupId: req.group!.id,
      eventId: event.id,
    });
  }
  res.json(serializeEvent(getEvent(req.params.id)));
});

eventsRouter.delete('/:id', resolveEvent, requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  if (req.params.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Das dauerhaft offene Basis-Event kann nicht abgesagt werden.' });
  }
  const affectedPlayers = activeContextPlayerIds(req.params.id);
  const cancelled = cancelEvent(req.params.id);
  if (!cancelled) return res.status(409).json({ error: 'Laufende oder beendete Events können nicht abgesagt werden.' });
  for (const playerId of affectedPlayers) switchPlayerEventScope(playerId, req.group!.id, BASE_EVENT_ID);
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
