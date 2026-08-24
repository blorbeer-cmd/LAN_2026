// Event management: create/edit events, manage each one's roster, and
// control tracking independently for the requesting account's selected
// account. Ending an event is separate from just pausing its tracking.

import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  cancelEvent,
  listEvents,
  getEvent,
  createEvent,
  publishPlanningEventIfScheduled,
  updateEvent,
  startTracking,
  restartEvent,
  stopTracking,
  endEvent,
  getParticipantIds,
  getEventParticipants,
  getAcceptedEventParticipants,
  getEventPaymentSummary,
  getPaidEventParticipantIds,
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
import { isNonEmptyString, isValidPaypalUrl } from '../validation';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from '../eventParticipation';
import type { GroupRole } from '../groups';
import { requireConfiguredGroupMembership, requireGroupRole, resolveGroupResource } from '../groupAuthorization';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { setEventTrackingConsent } from '../trackingContexts';
import { activeGroupPlayers } from '../groupPlayers';
import { createPersistentBackup } from '../backupService';
import { eventAccessLevel, getOrRepairActiveEvent } from '../eventContext';
import { getEnabledEventFeatures, isEventFeatureEnabled } from '../eventFeatures';
import {
  DEFAULT_EVENT_TYPE_KEY,
  EVENT_TYPE_KEYS,
  EVENT_TYPE_PRESETS,
  isEventTypeKey,
} from '../eventFeatureCatalog';
import { isAdminTestMode } from '../testDataVisibility';

export const eventsRouter = Router();

const READ_ONLY_EVENT_CONFIGURATION_FIELDS = ['presetVersion', 'enabledFeatures'] as const;
const EVENT_MINIMUM_DURATION_MS = 5 * 60 * 1000;

function requestsReadOnlyEventConfiguration(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === 'object' &&
    READ_ONLY_EVENT_CONFIGURATION_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field)),
  );
}

function rejectReadOnlyEventConfiguration(res: Response) {
  return res.status(400).json({
    error: 'Preset-Version und Bereichsauswahl sind in diesem Ausbau noch schreibgeschützt.',
  });
}

function eventTypeOptions() {
  return EVENT_TYPE_KEYS.map((eventTypeKey) => {
    const preset = EVENT_TYPE_PRESETS[eventTypeKey];
    return {
      key: preset.key,
      title: preset.title,
      description: preset.description,
      presetVersion: preset.version,
      enabledFeatures: [...preset.recommendedFeatureKeys],
    };
  });
}

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

const resolveEventResource = resolveGroupResource<EventRow>({
  resourceType: 'Event',
  load: (id) => {
    const event = getEvent(id);
    return event ? { resource: event, groupId: event.group_id } : undefined;
  },
});

const resolveEvent: RequestHandler = (req, res, next) => {
  resolveEventResource(req, res, () => {
    const event = req.groupResource as EventRow;
    if (event.is_test && !isAdminTestMode(req)) {
      res.status(404).json({ error: 'Event nicht gefunden.' });
      return;
    }
    next();
  });
};

// The management shape is a strict superset of the summary shape below, so a
// reader never has to know which of the two it got: both name the same value
// the same way. Before that, `starts_at` here versus `startsAt` there made
// every member-visible event render as "Invalid Date".
function paymentDetailsForViewer<T extends { playerId: string }>(
  participant: T,
  viewerId: string | undefined,
  revealAllPayments: boolean,
) {
  if (revealAllPayments || participant.playerId === viewerId) return participant;
  const safeParticipant = { ...participant } as T & Record<string, unknown>;
  delete safeParticipant.paid;
  delete safeParticipant.paidBy;
  delete safeParticipant.paidByName;
  delete safeParticipant.paidAt;
  delete safeParticipant.paidAmountCents;
  return safeParticipant;
}

function acceptedParticipantsForViewer(eventId: string, viewerId: string | undefined, revealAllPayments: boolean) {
  return getAcceptedEventParticipants(eventId).map((participant) =>
    paymentDetailsForViewer(participant, viewerId, revealAllPayments),
  );
}

// The viewer's own raw participation row, independent of the centralized
// "currently confirmed" predicate — acceptedParticipants deliberately hides a
// stale (pre-reschedule, unconfirmed) row, but the date poll UI needs exactly
// that row to tell the affected member they must reconfirm.
function myParticipationField(eventId: string, viewerId: string) {
  const row = db
    .prepare('SELECT status, confirmed_schedule_revision AS confirmedScheduleRevision FROM event_participants WHERE event_id = ? AND player_id = ?')
    .get(eventId, viewerId) as { status: 'invited' | 'accepted' | 'declined'; confirmedScheduleRevision: number | null } | undefined;
  return { myParticipation: row ? { status: row.status, confirmedScheduleRevision: row.confirmedScheduleRevision } : null };
}

function eventParticipantsForViewer(eventId: string, viewerId: string | undefined, revealAllPayments: boolean) {
  return getEventParticipants(eventId).map((participant) => ({
    ...paymentDetailsForViewer(participant, viewerId, revealAllPayments),
    // Administrative roster actions need to explain why removal is blocked,
    // but non-payment managers must not receive amount, actor, or timestamp.
    paymentLocked: Boolean(participant.paid),
  }));
}

function canManageEventPayments(
  event: EventRow,
  viewerId: string | undefined,
  viewerRole: GroupRole | undefined,
): boolean {
  if (!viewerId) return false;
  if (event.created_by === viewerId) return true;
  if (viewerRole !== 'owner') return false;
  if (!event.created_by) return true;
  const activeCreator = db
    .prepare(
      `SELECT 1
       FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id
       WHERE p.id = ? AND p.deactivated_at IS NULL
         AND gm.group_id = ? AND gm.status = 'active'`,
    )
    .get(event.created_by, event.group_id);
  return !activeCreator;
}

function paymentManagementFields(
  event: EventRow,
  viewerId: string | undefined,
  viewerRole: GroupRole | undefined,
) {
  const canManagePayments = canManageEventPayments(event, viewerId, viewerRole);
  if (!canManagePayments) return { canManagePayments: false };
  const summary = getEventPaymentSummary(event.id);
  return {
    canManagePayments: true,
    settlementPaidCents: summary.paidCents,
    settlementPaidCount: summary.paidCount,
    settlementMissingAmountCount: summary.missingAmountCount,
  };
}

// Shared shape for a plain member's own event card — the normal
// `availableEvents` workspace list and `endedEvents` (this account's own
// finished events, kept out of availableEvents for the same "not a switchable
// workspace" reason) both need
// the identical accepted-participant/payment/myParticipation detail to render
// the same card component.
function serializeMemberEvent(event: EventRow, playerId: string, viewerRole: GroupRole | undefined) {
  const managementFields = paymentManagementFields(event, playerId, viewerRole);
  return {
    ...serializeEventSummary(event, {
      includeAcceptedParticipants: true,
      includePaymentDetails: true,
      paymentViewerId: playerId,
      revealAllParticipantPayments: managementFields.canManagePayments,
    }),
    createdBy: event.created_by,
    ...managementFields,
    ...(managementFields.canManagePayments ? { accommodationCostCents: event.accommodation_cost_cents } : {}),
    ...myParticipationField(event.id, playerId),
  };
}

function serializeEvent(
  event: ReturnType<typeof getEvent>,
  viewerId: string | undefined,
  viewerRole?: GroupRole,
) {
  if (!event) return undefined;
  const revealAllPayments = canManageEventPayments(event, viewerId, viewerRole);
  return {
    ...serializeEventSummary(event as EventRow, {
      includeAcceptedParticipants: true,
      includePaymentDetails: true,
      paymentViewerId: viewerId,
      revealAllParticipantPayments: revealAllPayments,
    }),
    endedAt: event.ended_at,
    groupId: event.group_id,
    createdBy: event.created_by,
    ...paymentManagementFields(event, viewerId, viewerRole),
    accommodationCostCents: event.accommodation_cost_cents,
    visibilityScope: event.visibility_scope,
    isOutsideEvents: event.id === OUTSIDE_EVENTS_ID,
    participantIds: event.id === OUTSIDE_EVENTS_ID ? undefined : getParticipantIds(event.id),
    participants:
      event.id === OUTSIDE_EVENTS_ID
        ? undefined
        : eventParticipantsForViewer(event.id, viewerId, revealAllPayments),
    ...(event.id === OUTSIDE_EVENTS_ID || !viewerId ? {} : myParticipationField(event.id, viewerId)),
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

// The default summary is teaser-safe and contains no participant data. The
// accepted-participant extension is only requested after the caller's admin
// or accepted-member access check; invitation teasers must keep using the
// default shape.
function serializeEventSummary(
  event: EventRow,
  {
    includeAcceptedParticipants = false,
    includePaymentDetails = false,
    paymentViewerId,
    revealAllParticipantPayments = false,
  }: {
    includeAcceptedParticipants?: boolean;
    includePaymentDetails?: boolean;
    paymentViewerId?: string;
    revealAllParticipantPayments?: boolean;
  } = {},
) {
  return {
    id: event.id,
    name: event.name,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    scheduleRevision: event.schedule_revision,
    location: event.location,
    description: event.description,
    costCents: event.cost_cents,
    paymentDueAt: event.payment_due_at,
    ...(includePaymentDetails ? { paypalLink: event.paypal_link } : {}),
    status: event.status,
    isBase: event.id === BASE_EVENT_ID,
    eventType: event.event_type_key,
    presetVersion: event.preset_version,
    enabledFeatures: getEnabledEventFeatures(event.id),
    isTest: Boolean(event.is_test),
    trackingEnabled: Boolean(event.tracking_enabled),
    isEnded: Boolean(event.ended_at),
    ...(includeAcceptedParticipants
      ? {
          acceptedParticipants: acceptedParticipantsForViewer(
            event.id,
            paymentViewerId,
            revealAllParticipantPayments,
          ),
        }
      : {}),
  };
}

// GET /api/events - the account's active workspace, accepted workspaces and
// invitation teasers. Admins additionally receive the full
// management list.
eventsRouter.get('/', requireConfiguredGroupMembership, (req, res) => {
  const playerId = req.player!.id;
  const canManage = req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
  const includeTestEvents = isAdminTestMode(req);
  const testEventClause = includeTestEvents ? '' : 'AND e.is_test = 0';
  const storedActiveEvent = getEvent(getOrRepairActiveEvent(playerId).id)!;
  const activeEvent = !includeTestEvents && storedActiveEvent.is_test
    ? getEvent(BASE_EVENT_ID)!
    : storedActiveEvent;
  const availableEvents = db
    .prepare(
      `SELECT e.*
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       WHERE ep.player_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         AND e.id != ? AND e.group_id = ? AND e.status = 'published' AND e.ended_at IS NULL
         ${testEventClause}
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
         ${testEventClause}
       ORDER BY e.starts_at, e.name COLLATE NOCASE`,
    )
    .all(playerId, OUTSIDE_EVENTS_ID, req.group!.id) as EventRow[];
  // A member's own accepted events that have since ended. `availableEvents`
  // deliberately excludes these — it answers "where can I switch to right
  // now", not "what did I finish" (see the dedicated test below) — but the
  // Events tab's own collapsed "Historie" section needs the same rich
  // accepted-participant/payment detail `availableEvents` carries, which the
  // lighter `historicalEvents` summary (built for the analytics event filter)
  // does not. Hence its own query rather than reusing either.
  const endedEvents = db
    .prepare(
      `SELECT e.*
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       WHERE ep.player_id = ? AND ep.status = 'accepted'
         AND e.id != ? AND e.group_id = ? AND e.status = 'ended'
         ${testEventClause}
       ORDER BY e.starts_at DESC, e.name COLLATE NOCASE`,
    )
    .all(playerId, OUTSIDE_EVENTS_ID, req.group!.id) as EventRow[];
  // Compatibility field for older clients. Generic polls never grant event
  // visibility, and accepted invitations never become stale because of a
  // poll, so there are no poll-only or reconfirmation-only event cards.
  const plannedEvents: EventRow[] = [];
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
         ${testEventClause}
       ORDER BY e.starts_at DESC, e.name COLLATE NOCASE`,
    )
    .all(playerId, OUTSIDE_EVENTS_ID, req.group!.id) as EventRow[];
  const managedEvents = canManage
    ? listEvents(req.group!.id)
        .filter((event) => event.id !== BASE_EVENT_ID && (includeTestEvents || !event.is_test))
        .map((event) => serializeEvent(event, playerId, req.groupMembership?.role))
    : undefined;
  res.json({
    eventTypeOptions: eventTypeOptions(),
    activeEvent: {
      ...serializeEventSummary(activeEvent as EventRow),
      // Every picker that draws teams or starts a draft must offer only
      // players who can actually be entered as participants of this
      // workspace (see competitionPlayersBelongToGroup) — otherwise a
      // non-participant selected from the full roster fails that check with
      // a confusing 404 on submit. Accepted-only, like getParticipantIds
      // elsewhere. Tournament creation (routes/tournaments.ts) hits the same
      // check but its player picker (public/js/views/tournament.js) is not
      // wired up to this field yet — see the PR's own follow-up note.
      participantIds: getParticipantIds(activeEvent.id),
    },
    availableEvents: availableEvents.map((event) => serializeMemberEvent(event, playerId, req.groupMembership?.role)),
    // Retained as an empty compatibility field for older clients.
    plannedEvents: plannedEvents.map((event) => serializeMemberEvent(event, playerId, req.groupMembership?.role)),
    endedEvents: endedEvents.map((event) => serializeMemberEvent(event, playerId, req.groupMembership?.role)),
    historicalEvents: historicalEvents.map((event) => serializeEventSummary(event)),
    invitations: invitations.map((event) => ({ ...serializeEventSummary(event), participationStatus: 'invited' })),
    ...(managedEvents ? { managedEvents } : {}),
  });
});

// GET /api/events/active - this account's persisted workspace.
eventsRouter.get('/active', requireConfiguredGroupMembership, (req, res) => {
  const activeEvent = getEvent(getOrRepairActiveEvent(req.player!.id).id)!;
  res.json(serializeEventSummary(!isAdminTestMode(req) && activeEvent.is_test ? getEvent(BASE_EVENT_ID)! : activeEvent));
});

eventsRouter.get('/:id', resolveEvent, (req, res) => {
  const event = req.groupResource as EventRow;
  if (event.id === OUTSIDE_EVENTS_ID) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  const access = eventAccessLevel(event.id, req.player!.id, req.groupMembership!.role);
  if (access === 'none') return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (access === 'teaser') return res.json({ ...serializeEventSummary(event), participationStatus: 'invited' });
  if (access === 'participant') {
    const managementFields = paymentManagementFields(event, req.player!.id, req.groupMembership?.role);
    return res.json({
      ...serializeEventSummary(event, { includePaymentDetails: true }),
      createdBy: event.created_by,
      ...managementFields,
      ...(managementFields.canManagePayments ? { accommodationCostCents: event.accommodation_cost_cents } : {}),
      participantIds: getParticipantIds(event.id),
      acceptedParticipants: acceptedParticipantsForViewer(event.id, req.player!.id, managementFields.canManagePayments),
    });
  }
  return res.json(serializeEvent(event, req.player!.id, req.groupMembership?.role));
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
  if (event.status === 'draft' && event.starts_at === null) {
    return res.status(409).json({
      error: 'Für ein Planungs-Event ohne festen Termin können noch keine regulären Einladungen gesendet werden.',
    });
  }
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId || playerId.length > 200) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }

  const result = inviteParticipant(event.id, playerId);
  if (result.changed) publishPlanningEventIfScheduled(event.id);
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
        url: '/#profile',
      },
      'direct',
      { key: eventInvitationTopicKey(event.id, playerId) },
      { groupId: req.group!.id, eventId: BASE_EVENT_ID },
    );
  }
  res.status(result.changed ? 201 : 200).json({
    playerId: result.participant.playerId,
    status: result.participant.status,
  });
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
    return res.json({ playerId: result.participant.playerId, status: result.participant.status });
  };
}

eventsRouter.post('/:id/invitation/accept', resolveEvent, answerEventInvitation('accepted'));
eventsRouter.post('/:id/invitation/decline', resolveEvent, answerEventInvitation('declined'));

// PATCH /api/events/:id/participants/:playerId/payment - an accepted
// participant may correct only their own state. The recorded event creator
// may additionally correct every accepted participant. If that account no
// longer exists or is inactive, the group owner becomes the explicit fallback.
eventsRouter.patch('/:id/participants/:playerId/payment', resolveEvent, (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID || event.id === BASE_EVENT_ID) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  const actorId = requestPlayerId(req);
  const targetPlayerId = req.params.playerId;
  const { paid } = req.body ?? {};
  if (!actorId) return res.status(401).json({ error: 'Anmeldung erforderlich.' });
  const access = eventAccessLevel(event.id, actorId, req.groupMembership!.role);
  if ((access === 'none' || access === 'teaser') && event.created_by !== actorId) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  if (typeof paid !== 'boolean') return res.status(400).json({ error: 'paid muss ein Boolean sein.' });
  if (paid && event.cost_cents === null) {
    return res.status(409).json({ error: 'Für dieses Event sind keine Kosten hinterlegt.' });
  }
  if (targetPlayerId !== actorId && !canManageEventPayments(event, actorId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Du kannst nur deinen eigenen Bezahlstatus ändern.' });
  }

  const paidAt = paid ? Date.now() : null;
  const updated = db
    .prepare(
      `UPDATE event_participants SET paid = ?, paid_by = ?, paid_at = ?, paid_amount_cents = ?
       WHERE event_id = ? AND player_id = ? AND status = 'accepted'`,
    )
    .run(paid ? 1 : 0, paid ? actorId : null, paidAt, paid ? event.cost_cents : null, event.id, targetPlayerId);
  if (updated.changes !== 1) {
    return res.status(404).json({ error: 'Zugesagter Event-Teilnehmer nicht gefunden.' });
  }

  if (paid) {
    resolvePushTopic(`event-payment-reminder:${targetPlayerId}:${event.id}`, false, {
      groupId: req.group!.id,
      eventId: event.id,
    });
  }

  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  return res.json({
    playerId: targetPlayerId,
    paid,
    paidBy: paid ? actorId : null,
    paidAt,
    paidAmountCents: paid ? event.cost_cents : null,
  });
});

// DELETE /api/events/:id/participants/:playerId - administrative removal
// remains distinct from a member declining their own invitation.
eventsRouter.delete('/:id/participants/:playerId', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (event.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Teilnehmer des Basis-Events können nicht entfernt werden.' });
  }
  if (getPaidEventParticipantIds(event.id).includes(req.params.playerId)) {
    return res.status(409).json({
      error: 'Eine bestätigte Zahlung muss zuerst zurückgesetzt werden, bevor die Teilnahme entfernt werden kann.',
    });
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

const MAX_EVENT_COST_CENTS = 1_000_000;
const MAX_ACCOMMODATION_COST_CENTS = 10_000_000;
const MAX_PAYPAL_LINK_LENGTH = 300;

function parseOptionalCostCents(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > MAX_EVENT_COST_CENTS) {
    return { ok: false, error: 'costCents muss zwischen 1 und 1000000 Cent liegen.' };
  }
  return { ok: true, value: value as number };
}

function parseOptionalAccommodationCostCents(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > MAX_ACCOMMODATION_COST_CENTS) {
    return { ok: false, error: 'accommodationCostCents muss zwischen 1 und 10000000 Cent liegen.' };
  }
  return { ok: true, value: value as number };
}

function parseOptionalPaypalLink(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (!isValidPaypalUrl(value, MAX_PAYPAL_LINK_LENGTH)) {
    return {
      ok: false,
      error: 'paypalLink muss eine sichere PayPal-Adresse mit https:// sein.',
    };
  }
  return { ok: true, value: value.trim() };
}

// POST /api/events - create a new event. Tracking starts OFF — several
// events can exist side by side, so creating one never touches whichever
// event (if any) is currently tracking.
// Body: { name, startsAt, endsAt, eventType?, location?, description?, costCents?, accommodationCostCents?, paypalLink?, paymentDueAt? }
eventsRouter.post('/', requireConfiguredGroupMembership, requireGroupRole('admin'), (req, res) => {
  if (requestsReadOnlyEventConfiguration(req.body)) return rejectReadOnlyEventConfiguration(res);
  const {
    name,
    startsAt,
    endsAt,
    eventType,
    location,
    description,
    costCents,
    accommodationCostCents,
    paypalLink,
    paymentDueAt,
    visibilityScope,
  } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-80 Zeichen).' });
  }
  const eventTypeKey = eventType ?? DEFAULT_EVENT_TYPE_KEY;
  if (!isEventTypeKey(eventTypeKey)) {
    return res.status(400).json({ error: 'eventType muss lan oder general sein.' });
  }

  const parsedStartsAt = parseRequiredTimestamp(startsAt, 'startsAt');
  if (!parsedStartsAt.ok) return res.status(400).json({ error: parsedStartsAt.error });
  const parsedEndsAt = parseRequiredTimestamp(endsAt, 'endsAt');
  if (!parsedEndsAt.ok) return res.status(400).json({ error: parsedEndsAt.error });
  if (parsedEndsAt.value < parsedStartsAt.value + EVENT_MINIMUM_DURATION_MS) {
    return res.status(400).json({ error: 'endsAt muss mindestens fünf Minuten nach startsAt liegen.' });
  }
  const parsedLocation = parseOptionalText(location, 500, 'location');
  if (!parsedLocation.ok) return res.status(400).json({ error: parsedLocation.error });
  const parsedDescription = parseOptionalText(description, 500, 'description');
  if (!parsedDescription.ok) return res.status(400).json({ error: parsedDescription.error });
  const parsedCostCents = parseOptionalCostCents(costCents);
  if (!parsedCostCents.ok) return res.status(400).json({ error: parsedCostCents.error });
  const parsedAccommodationCostCents = parseOptionalAccommodationCostCents(accommodationCostCents);
  if (!parsedAccommodationCostCents.ok) {
    return res.status(400).json({ error: parsedAccommodationCostCents.error });
  }
  const parsedPaypalLink = parseOptionalPaypalLink(paypalLink);
  if (!parsedPaypalLink.ok) return res.status(400).json({ error: parsedPaypalLink.error });
  const parsedPaymentDueAt = parseOptionalTimestamp(paymentDueAt, 'paymentDueAt');
  if (!parsedPaymentDueAt.ok) return res.status(400).json({ error: parsedPaymentDueAt.error });
  if (parsedPaypalLink.value && parsedCostCents.value === null) {
    return res.status(400).json({ error: 'Für einen PayPal-Link müssen Kosten pro Person angegeben werden.' });
  }
  if (parsedPaymentDueAt.value !== null && parsedCostCents.value === null) {
    return res.status(400).json({ error: 'Für ein Zahlungsziel müssen Kosten pro Person angegeben werden.' });
  }
  if (visibilityScope !== undefined && visibilityScope !== 'participants') {
    return res.status(400).json({ error: 'Events sind ausschließlich für angenommene Teilnehmende sichtbar.' });
  }

  const event = createEvent(name.trim(), {
    groupId: req.player ? req.group!.id : undefined,
    startsAt: parsedStartsAt.value,
    endsAt: parsedEndsAt.value,
    location: parsedLocation.value,
    description: parsedDescription.value,
    costCents: parsedCostCents.value,
    accommodationCostCents: parsedAccommodationCostCents.value,
    paypalLink: parsedPaypalLink.value,
    paymentDueAt: parsedPaymentDueAt.value,
    createdBy: req.player?.id ?? null,
    eventTypeKey,
  });

  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_created',
    targetType: 'event',
    targetId: event.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  res.status(201).json(serializeEvent(event, req.player?.id, req.groupMembership?.role));
});

// PATCH /api/events/:id - metadata correction only (name/dates/location/
// description/payment details); never touches tracking state or live status.
// Body: any subset of { name?, startsAt?, endsAt?, location?, description?, costCents?, accommodationCostCents?, paypalLink?, paymentDueAt? }
// The event type is intentionally fixed after creation in the small MVP so a
// type switch cannot hide a running LAN workflow without an impact check.
eventsRouter.patch('/:id', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const existing = req.groupResource as EventRow;
  if (!existing || existing.id === OUTSIDE_EVENTS_ID) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  if (existing.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Das dauerhaft offene Basis-Event kann nicht bearbeitet werden.' });
  }
  if (req.body && typeof req.body === 'object' && Object.prototype.hasOwnProperty.call(req.body, 'eventType')) {
    return res.status(400).json({ error: 'Der Eventtyp ist in diesem MVP nach dem Anlegen schreibgeschützt.' });
  }
  if (requestsReadOnlyEventConfiguration(req.body)) return rejectReadOnlyEventConfiguration(res);

  const {
    name,
    startsAt,
    endsAt,
    location,
    description,
    costCents,
    accommodationCostCents,
    paypalLink,
    paymentDueAt,
    visibilityScope,
  } = req.body ?? {};
  const fields: UpdateEventFields = {};

  if (name !== undefined) {
    if (!isNonEmptyString(name, 80)) return res.status(400).json({ error: 'Name muss 1-80 Zeichen lang sein.' });
    fields.name = name.trim();
  }
  // A planning event's date is set exclusively through its date poll's
  // schedule action (see routes/eventDatePolls.ts) — never through this
  // generic metadata PATCH, so there is only ever one place that writes
  // starts_at/ends_at/schedule_revision together in a single transaction.
  if (existing.status === 'draft' && (startsAt !== undefined || endsAt !== undefined)) {
    return res.status(409).json({
      error: 'Der Termin eines Planungs-Events wird ausschließlich über die Terminabstimmung festgelegt.',
    });
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
  // required for any non-draft event and remains required during PATCH.
  const effectiveStartsAt = fields.startsAt ?? existing.starts_at;
  const effectiveEndsAt = fields.endsAt !== undefined ? fields.endsAt : existing.ends_at;
  if (effectiveStartsAt !== null) {
    if (effectiveEndsAt === null || effectiveEndsAt < effectiveStartsAt + EVENT_MINIMUM_DURATION_MS) {
      return res.status(400).json({ error: 'endsAt muss mindestens fünf Minuten nach startsAt liegen.' });
    }
  }
  if (location !== undefined) {
    const parsed = parseOptionalText(location, 500, 'location');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.location = parsed.value;
  }
  if (description !== undefined) {
    const parsed = parseOptionalText(description, 500, 'description');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.description = parsed.value;
  }
  if (costCents !== undefined) {
    const parsed = parseOptionalCostCents(costCents);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.costCents = parsed.value;
  }
  if (accommodationCostCents !== undefined) {
    const parsed = parseOptionalAccommodationCostCents(accommodationCostCents);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.accommodationCostCents = parsed.value;
  }
  if (paypalLink !== undefined) {
    const parsed = parseOptionalPaypalLink(paypalLink);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.paypalLink = parsed.value;
  }
  if (paymentDueAt !== undefined) {
    const parsed = parseOptionalTimestamp(paymentDueAt, 'paymentDueAt');
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fields.paymentDueAt = parsed.value;
  }
  const effectiveCostCents = fields.costCents !== undefined ? fields.costCents : existing.cost_cents;
  const effectivePaypalLink = fields.paypalLink !== undefined ? fields.paypalLink : existing.paypal_link;
  const effectivePaymentDueAt = fields.paymentDueAt !== undefined ? fields.paymentDueAt : existing.payment_due_at;
  if (effectivePaypalLink && effectiveCostCents === null) {
    return res.status(400).json({ error: 'Für einen PayPal-Link müssen Kosten pro Person angegeben werden.' });
  }
  if (effectivePaymentDueAt !== null && effectiveCostCents === null) {
    return res.status(400).json({ error: 'Für ein Zahlungsziel müssen Kosten pro Person angegeben werden.' });
  }
  if (visibilityScope !== undefined) {
    if (visibilityScope !== 'participants') {
      return res.status(400).json({ error: 'Events sind ausschließlich für angenommene Teilnehmende sichtbar.' });
    }
  }

  const updated = updateEvent(req.params.id, fields)!;
  const startChanged = fields.startsAt !== undefined && fields.startsAt !== existing.starts_at;
  const endChanged = fields.endsAt !== undefined && fields.endsAt !== existing.ends_at;
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.player ? req.group!.id : undefined,
    action: 'event_updated',
    targetType: 'event',
    targetId: req.params.id,
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
  const relevantChanges: string[] = [];
  if (fields.location !== undefined && fields.location !== existing.location) {
    relevantChanges.push(`Ort: ${existing.location || 'offen'} → ${updated.location || 'offen'}`);
  }
  if (fields.costCents !== undefined && fields.costCents !== existing.cost_cents) {
    const money = (value: number | null) => (value === null ? 'offen' : `${(value / 100).toFixed(2).replace('.', ',')} €`);
    relevantChanges.push(`Preis: ${money(existing.cost_cents)} → ${money(updated.cost_cents)}`);
  }
  if (
    fields.accommodationCostCents !== undefined &&
    fields.accommodationCostCents !== existing.accommodation_cost_cents
  ) {
    const money = (value: number | null) => (value === null ? 'offen' : `${(value / 100).toFixed(2).replace('.', ',')} €`);
    relevantChanges.push(
      `Unterkunft: ${money(existing.accommodation_cost_cents)} → ${money(updated.accommodation_cost_cents)}`,
    );
  }
  if (endChanged) {
    relevantChanges.push('Dauer/Ende wurde geändert');
  }
  if (startChanged || relevantChanges.length > 0) {
    const recipients = db
      .prepare(
        `SELECT player_id AS playerId FROM event_participants
         WHERE event_id = ? AND status IN ('invited', 'accepted')`,
      )
      .all(existing.id) as Array<{ playerId: string }>;
    notifyPlayers(
      recipients.map((row) => row.playerId).filter((id) => id !== req.player?.id),
      {
        title: startChanged ? 'Eventtermin geändert' : 'Eventplanung geändert',
        body: `${updated.name}: ${startChanged ? 'Der Termin wurde geändert' : relevantChanges.join('; ')}${startChanged && relevantChanges.length ? `; ${relevantChanges.join('; ')}` : ''}. Deine Zusage bleibt bestehen.`,
        url: '/#events',
      },
      'direct',
      undefined,
      { groupId: req.group!.id, eventId: BASE_EVENT_ID },
    );
  }
  res.json(serializeEvent(updated, req.player?.id, req.groupMembership?.role));
});

// POST /api/events/:id/tracking/start - starts this event's independent
// tracking window. Overlapping events may track simultaneously.
eventsRouter.post('/:id/tracking/start', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  if (!isEventFeatureEnabled(req.params.id, 'tracking')) {
    return res.status(404).json({ error: 'Tracking ist für dieses Event nicht aktiviert.' });
  }
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
  res.json(serializeEvent(result.event, req.player?.id, req.groupMembership?.role));
});

// POST /api/events/:id/restart - reopens an ended event and starts tracking.
eventsRouter.post('/:id/restart', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  if (!isEventFeatureEnabled(req.params.id, 'tracking')) {
    return res.status(404).json({ error: 'Tracking ist für dieses Event nicht aktiviert.' });
  }
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
  res.json(serializeEvent(result.event, req.player?.id, req.groupMembership?.role));
});

// POST /api/events/:id/tracking/stop - pauses tracking without ending the
// event; can be resumed with .../tracking/start later.
eventsRouter.post('/:id/tracking/stop', resolveEvent, requireGroupRole('admin'), async (req, res) => {
  if (!isEventFeatureEnabled(req.params.id, 'tracking')) {
    return res.status(404).json({ error: 'Tracking ist für dieses Event nicht aktiviert.' });
  }
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
  res.json(serializeEvent(updated, req.player?.id, req.groupMembership?.role));
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
  res.json(serializeEvent(updated, req.player?.id, req.groupMembership?.role));
});

// PUT /api/events/:id/participants - replace the whole roster.
// Body: { playerIds: string[] }
eventsRouter.put('/:id/participants', resolveEvent, requireGroupRole('admin'), (req, res) => {
  const event = req.groupResource as EventRow;
  if (!event || event.id === OUTSIDE_EVENTS_ID) return res.status(404).json({ error: 'Event nicht gefunden.' });
  if (event.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Die Teilnehmerliste des Basis-Events wird automatisch gepflegt.' });
  }
  if (event.status === 'draft' && event.starts_at === null && Array.isArray(req.body?.playerIds) && req.body.playerIds.length > 0) {
    return res.status(409).json({
      error: 'Für ein Planungs-Event ohne festen Termin können noch keine regulären Einladungen gesendet werden.',
    });
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
  const paidRemovedIds = getPaidEventParticipantIds(req.params.id).filter((playerId) => !uniqueIds.includes(playerId));
  if (paidRemovedIds.length > 0) {
    return res.status(409).json({
      error: 'Bestätigte Zahlungen müssen zuerst zurückgesetzt werden, bevor Teilnehmende entfernt werden können.',
      playerIds: paidRemovedIds,
    });
  }
  const activeBefore = new Set(activeContextPlayerIds(req.params.id));
  setParticipants(req.params.id, uniqueIds);
  if (uniqueIds.length > 0) publishPlanningEventIfScheduled(event.id);
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
  res.json(serializeEvent(getEvent(req.params.id), req.player?.id, req.groupMembership?.role));
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
  res.json(serializeEvent(cancelled, req.player?.id, req.groupMembership?.role));
});
