// Event lifecycle: several events may coexist and track in parallel. Every
// operational request is bound to the requesting account's persisted active
// event; tracking adds its own time-window and consent gates. The historical
// OUTSIDE_EVENTS_ID row remains migration-only and is never selectable.

import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL, type EventParticipationStatus } from './eventParticipation';
import { closeEventContexts } from './trackingContexts';
import { fallbackEventContexts, fallbackPlayerEventContext } from './eventContext';
import {
  DEFAULT_EVENT_PRESET_VERSION,
  DEFAULT_EVENT_TYPE_KEY,
  EVENT_TYPE_PRESETS,
  type EventTypeKey,
} from './eventFeatureCatalog';
import { createEventFeatureSnapshot } from './eventFeatures';

export { OUTSIDE_EVENTS_ID };

export interface EventRow {
  id: string;
  name: string;
  // Only NULL while status is 'draft' (a planning event whose date poll
  // hasn't been scheduled yet) — enforced by a DB CHECK, not just this type.
  starts_at: number | null;
  ends_at: number | null;
  location: string | null;
  description: string | null;
  cost_cents: number | null;
  accommodation_cost_cents: number | null;
  paypal_link: string | null;
  payment_due_at: number | null;
  created_by: string | null;
  event_type_key: EventTypeKey;
  preset_version: number;
  tracking_enabled: number;
  ended_at: number | null;
  is_test: number;
  group_id: string | null;
  status: 'draft' | 'published' | 'cancelled' | 'ended';
  visibility_scope: 'group' | 'participants' | 'public';
  schedule_revision: number;
}

export interface EventParticipantRow {
  playerId: string;
  name?: string;
  status: EventParticipationStatus;
  paid: boolean;
  paidBy?: string | null;
  paidByName?: string | null;
  paidAt?: number | null;
  paidAmountCents?: number | null;
  confirmedScheduleRevision?: number | null;
}

export interface AcceptedEventParticipantRow {
  playerId: string;
  name: string;
  paid: boolean;
  paidBy: string | null;
  paidByName: string | null;
  paidAt: number | null;
  paidAmountCents: number | null;
  confirmedScheduleRevision: number | null;
}

export interface EventPaymentSummary {
  paidCount: number;
  paidCents: number;
  missingAmountCount: number;
}

// All currently trackable events. Tracking is independent per event and an
// account report is attributed only to that account's active event.
export function getTrackingEvents(now = Date.now()): EventRow[] {
  return db.prepare(
    `SELECT * FROM events
     WHERE tracking_enabled = 1 AND id != ? AND status = 'published'
       AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)
     ORDER BY group_id, id`,
  ).all(OUTSIDE_EVENTS_ID, now, now) as EventRow[];
}

export function getEvent(id: string): EventRow | undefined {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
}

// User-managed events only. The permanent base event gets its own workspace
// contract and remains hidden from existing event administration until the
// visible event switcher lands in the next block.
export function listEvents(groupId = DEFAULT_GROUP_ID): EventRow[] {
  return db
    .prepare(
      'SELECT * FROM events WHERE id NOT IN (?, ?) AND group_id = ? ORDER BY starts_at IS NULL, starts_at ASC, name COLLATE NOCASE',
    )
    .all(OUTSIDE_EVENTS_ID, BASE_EVENT_ID, groupId) as EventRow[];
}

export interface CreateEventOptions {
  groupId?: string;
  startsAt: number;
  endsAt: number | null;
  location?: string | null;
  description?: string | null;
  costCents?: number | null;
  accommodationCostCents?: number | null;
  paypalLink?: string | null;
  paymentDueAt?: number | null;
  createdBy?: string | null;
  eventTypeKey?: EventTypeKey;
}

// Just creates the event — tracking starts off, so this never wipes live
// status or conflicts with an already-tracking event. Call startTracking
// separately once you actually want this event to go live. A fixed date is
// known from the start (no date poll involved), so this counts as schedule
// revision 1 right away — the same revision a poll's first "Termin
// festlegen" would produce, and what existing accept/decline writes compare
// against (see ACCEPTED_EVENT_PARTICIPANT_SQL).
export function createEvent(name: string, options: CreateEventOptions): EventRow {
  const id = nanoid();
  const eventTypeKey = options.eventTypeKey ?? DEFAULT_EVENT_TYPE_KEY;
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO events
         (id, name, starts_at, ends_at, location, description, tracking_enabled, ended_at,
          group_id, status, visibility_scope, cost_cents, accommodation_cost_cents, paypal_link, payment_due_at,
          created_by, event_type_key, preset_version, schedule_revision)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, 'published', 'participants', ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      id,
      name,
      options.startsAt,
      options.endsAt,
      options.location ?? null,
      options.description ?? null,
      options.groupId ?? DEFAULT_GROUP_ID,
      options.costCents ?? null,
      options.accommodationCostCents ?? null,
      options.paypalLink ?? null,
      options.paymentDueAt ?? null,
      options.createdBy ?? null,
      eventTypeKey,
      eventTypeKey === DEFAULT_EVENT_TYPE_KEY
        ? DEFAULT_EVENT_PRESET_VERSION
        : EVENT_TYPE_PRESETS[eventTypeKey].version,
    );
    createEventFeatureSnapshot(id, eventTypeKey, options.createdBy ?? null);
    return getEvent(id)!;
  })();
}

export interface UpdateEventFields {
  name?: string;
  startsAt?: number;
  endsAt?: number | null;
  location?: string | null;
  description?: string | null;
  costCents?: number | null;
  accommodationCostCents?: number | null;
  paypalLink?: string | null;
  paymentDueAt?: number | null;
}

// Metadata-only correction — never touches tracking state or live status.
// Safe to call on past/ended events too (e.g. backfilling a forgotten end
// date/location). Not valid for the sentinel (nothing to correct there).
export function updateEvent(id: string, fields: UpdateEventFields): EventRow | undefined {
  const existing = getEvent(id);
  if (!existing || id === OUTSIDE_EVENTS_ID) return undefined;

  const next: EventRow = {
    ...existing,
    name: fields.name !== undefined ? fields.name : existing.name,
    starts_at: fields.startsAt !== undefined ? fields.startsAt : existing.starts_at,
    ends_at: fields.endsAt !== undefined ? fields.endsAt : existing.ends_at,
    location: fields.location !== undefined ? fields.location : existing.location,
    description: fields.description !== undefined ? fields.description : existing.description,
    cost_cents: fields.costCents !== undefined ? fields.costCents : existing.cost_cents,
    accommodation_cost_cents:
      fields.accommodationCostCents !== undefined ? fields.accommodationCostCents : existing.accommodation_cost_cents,
    paypal_link: fields.paypalLink !== undefined ? fields.paypalLink : existing.paypal_link,
    payment_due_at: fields.paymentDueAt !== undefined ? fields.paymentDueAt : existing.payment_due_at,
  };

  db.prepare(
    'UPDATE events SET name = ?, starts_at = ?, ends_at = ?, location = ?, description = ?, cost_cents = ?, accommodation_cost_cents = ?, paypal_link = ?, payment_due_at = ? WHERE id = ?'
  ).run(
    next.name,
    next.starts_at,
    next.ends_at,
    next.location,
    next.description,
    next.cost_cents,
    next.accommodation_cost_cents,
    next.paypal_link,
    next.payment_due_at,
    next.id,
  );

  return next;
}

export type StartTrackingResult =
  | { ok: true; event: EventRow }
  | { ok: false; code: 'not_found' | 'invalid'; error: string };

// Clears the live-status board AND closes any still-open play_sessions rows
// (FR-29) — used whenever tracking starts/stops/ends, since a switch in who
// is being tracked means whatever "currently running" state existed before
// is now stale and would otherwise never get an ended_at.
// Turns tracking on for one event — clearing stale live status from
// whatever was tracked before (a fresh tracking window shouldn't show last
// time's "who's playing what") and giving every existing agent report a
// clean slate. Rejects if a DIFFERENT event is already tracking (only one
// at a time, system-wide) rather than silently switching, since that's the
// one thing that must stay exclusive even though events themselves can
// overlap in time.
function startTrackingInternal(id: string, reopenEnded: boolean): StartTrackingResult {
  const event = getEvent(id);
  if (!event) return { ok: false, code: 'not_found', error: 'Event nicht gefunden.' };
  if (event.id === OUTSIDE_EVENTS_ID) {
    return { ok: false, code: 'invalid', error: 'Dieser technische Migrationskontext kann nicht getrackt werden.' };
  }
  if (event.ended_at && !reopenEnded) {
    return { ok: false, code: 'invalid', error: 'Ein beendetes Event kann nicht wieder getrackt werden.' };
  }
  if (reopenEnded && (!event.ended_at || event.status !== 'ended')) {
    return { ok: false, code: 'invalid', error: 'Nur beendete Events können wieder gestartet werden.' };
  }
  if (event.status === 'cancelled') {
    return { ok: false, code: 'invalid', error: 'Ein abgesagtes Event kann nicht getrackt werden.' };
  }
  if (event.status === 'draft') {
    return {
      ok: false,
      code: 'invalid',
      error: 'Ein Planungs-Event ohne festen Termin kann nicht getrackt werden.',
    };
  }
  if (event.tracking_enabled) return { ok: true, event };

  closeEventContexts(id);

  const updated = reopenEnded
    ? db.prepare("UPDATE events SET tracking_enabled = 1, ended_at = NULL, status = 'published' WHERE id = ? AND ended_at IS NOT NULL AND status = 'ended'").run(id)
    : db.prepare('UPDATE events SET tracking_enabled = 1 WHERE id = ?').run(id);
  if (updated.changes !== 1) {
    return { ok: false, code: 'invalid', error: 'Event konnte nicht gestartet werden.' };
  }

  return { ok: true, event: getEvent(id)! };
}

export function startTracking(id: string): StartTrackingResult {
  return startTrackingInternal(id, false);
}

// Reopens an event that was ended manually and starts tracking it again. The
// caller must use the explicit restart action so a normal tracking start
// cannot accidentally undo an event's completed state.
export function restartEvent(id: string): StartTrackingResult {
  return startTrackingInternal(id, true);
}

// Pauses tracking without ending the event — can be resumed with
// startTracking later. A no-op (not an error) if this event wasn't the one
// tracking, so callers don't need to check first.
export function stopTracking(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (!event) return undefined;
  if (!event.tracking_enabled) return event;

  db.prepare('UPDATE events SET tracking_enabled = 0 WHERE id = ?').run(id);
  closeEventContexts(id);
  return getEvent(id);
}

// A Jam session holds a group-wide exclusive lock (one shared physical
// controller device can only relay commands for one event at a time — see
// activeSessionConflict in routes/music.ts), so an event that ends while its
// Jam is still marked active would otherwise block every other event's Jam
// forever. Releasing it here mirrors the manual POST /api/music/end DB
// update, minus the live Spotify pause call: this runs synchronously from
// plain event-lifecycle code with no controller connection to await, and by
// the time an event is closed for good nobody is expected to still be
// relying on that specific session's live controls.
function endActiveMusicSession(eventId: string, now: number): void {
  const session = db.prepare("SELECT id FROM music_sessions WHERE event_id = ? AND status = 'active'").get(eventId) as
    | { id: string }
    | undefined;
  if (!session) return;
  db.transaction(() => {
    db.prepare("UPDATE music_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(now, session.id);
    db.prepare("UPDATE music_requests SET status = 'failed' WHERE session_id = ? AND status IN ('sending', 'queued')").run(session.id);
  })();
}

// Closes an event for good — stops tracking first if it was on (same live
// status wipe as stopTracking), then marks it ended so it can't be
// re-tracked. Valid on any real event regardless of current tracking state
// (e.g. formally closing an event that was never actually tracked).
export function endEvent(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (!event || event.id === OUTSIDE_EVENTS_ID || event.id === BASE_EVENT_ID) return undefined;

  const now = Date.now();
  const wasTracking = Boolean(event.tracking_enabled);
  db.prepare("UPDATE events SET tracking_enabled = 0, ended_at = ?, status = 'ended' WHERE id = ?").run(now, id);
  if (wasTracking) closeEventContexts(id);
  fallbackEventContexts(id);
  endActiveMusicSession(id, now);
  return getEvent(id);
}

// A planning event stays draft — even after its date poll schedules a date —
// until the creator actually invites people, matching the concept's "Das
// Event bleibt draft, bis der Ersteller die regulären Einladungen ...
// bestätigt". Called from the first successful invite on such an event;
// guarded by starts_at IS NOT NULL so it can only fire once a date exists
// (routes/events.ts separately rejects inviting before that).
export function publishPlanningEventIfScheduled(id: string): void {
  db.prepare("UPDATE events SET status = 'published' WHERE id = ? AND status = 'draft' AND starts_at IS NOT NULL").run(id);
}

export function cancelEvent(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (
    !event ||
    event.id === OUTSIDE_EVENTS_ID ||
    event.id === BASE_EVENT_ID ||
    event.tracking_enabled ||
    event.status === 'ended'
  )
    return undefined;
  db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(id);
  fallbackEventContexts(id);
  return getEvent(id);
}

// ---------- roster ----------

export function getParticipantIds(eventId: string): string[] {
  const rows = db
    .prepare(
      `SELECT ep.player_id
       FROM event_participants ep
       WHERE ep.event_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
       ORDER BY ep.rowid`,
    )
    .all(eventId) as Array<{ player_id: string }>;
  return rows.map((r) => r.player_id);
}

export function getEventParticipants(eventId: string): EventParticipantRow[] {
  return (db
    .prepare(
      `SELECT ep.player_id AS playerId, p.name, ep.status, ep.paid,
              ep.paid_by AS paidBy, confirmer.name AS paidByName, ep.paid_at AS paidAt,
              ep.paid_amount_cents AS paidAmountCents, ep.confirmed_schedule_revision AS confirmedScheduleRevision
       FROM event_participants ep
       JOIN players p ON p.id = ep.player_id
       LEFT JOIN players confirmer ON confirmer.id = ep.paid_by
       WHERE ep.event_id = ?
       ORDER BY ep.rowid`,
    )
    .all(eventId) as Array<Omit<EventParticipantRow, 'paid'> & { paid: number }>)
    .map((participant) => ({ ...participant, paid: Boolean(participant.paid) }));
}

// Member-facing roster shape. It intentionally contains only accepted,
// active participants: invited and declined statuses stay an admin-only
// management concern, while accepted names are useful event context for
// every participant.
export function getAcceptedEventParticipants(eventId: string): AcceptedEventParticipantRow[] {
  return (db
    .prepare(
      `SELECT ep.player_id AS playerId, p.name, ep.paid,
              ep.paid_by AS paidBy, confirmer.name AS paidByName, ep.paid_at AS paidAt,
              ep.paid_amount_cents AS paidAmountCents
       FROM event_participants ep
       JOIN players p ON p.id = ep.player_id
       LEFT JOIN players confirmer ON confirmer.id = ep.paid_by
       WHERE ep.event_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL} AND p.deactivated_at IS NULL
       ORDER BY p.name COLLATE NOCASE, p.id`,
    )
    .all(eventId) as Array<Omit<AcceptedEventParticipantRow, 'paid'> & { paid: number }>)
    .map((participant) => ({ ...participant, paid: Boolean(participant.paid) }));
}

// Accounting intentionally has a wider lifetime than the visible roster.
// Paid rows remain part of the settlement after a decline or account
// deactivation; deleting such rows is rejected by the management routes.
export function getEventPaymentSummary(eventId: string): EventPaymentSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS paidCount,
              COALESCE(SUM(COALESCE(paid_amount_cents, 0)), 0) AS paidCents,
              COALESCE(SUM(CASE WHEN paid_amount_cents IS NULL THEN 1 ELSE 0 END), 0) AS missingAmountCount
       FROM event_participants
       WHERE event_id = ? AND paid = 1`,
    )
    .get(eventId) as EventPaymentSummary;
  return row;
}

export function getPaidEventParticipantIds(eventId: string): string[] {
  return (
    db
      .prepare('SELECT player_id AS playerId FROM event_participants WHERE event_id = ? AND paid = 1 ORDER BY rowid')
      .all(eventId) as Array<{ playerId: string }>
  ).map((row) => row.playerId);
}

export function isParticipant(eventId: string, playerId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM event_participants ep
       WHERE ep.event_id = ? AND ep.player_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
    )
    .get(eventId, playerId);
  return Boolean(row);
}

export type InviteParticipantResult = {
  participant: EventParticipantRow;
  changed: boolean;
};

export function inviteParticipant(eventId: string, playerId: string): InviteParticipantResult {
  const transaction = db.transaction((): InviteParticipantResult => {
    const existing = db
      .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { status: EventParticipationStatus } | undefined;
    if (!existing) {
      db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'invited')").run(
        eventId,
        playerId,
      );
      return { participant: { playerId, status: 'invited', paid: false }, changed: true };
    }
    if (existing.status === 'declined') {
      // Reopening as 'invited' also clears confirmed_schedule_revision, which
      // is what marks an answer as belonging to the event's current period:
      // a re-invited row has explicitly not been answered again yet, so it
      // must not keep claiming a confirmation for the schedule it carries.
      db.prepare(
        "UPDATE event_participants SET status = 'invited', confirmed_schedule_revision = NULL WHERE event_id = ? AND player_id = ?",
      ).run(eventId, playerId);
      return { participant: { playerId, status: 'invited', paid: false }, changed: true };
    }
    const paid = db
      .prepare('SELECT paid FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { paid: number };
    return { participant: { playerId, status: existing.status, paid: Boolean(paid.paid) }, changed: false };
  });
  return transaction();
}

// Why an answer can be blocked. Everything else is a normal, freely
// repeatable decision — see docs/KONZEPT-EINLADUNGS-WORKFLOW.md Abschnitt 3.3.
export type EventParticipationLockReason = 'paid' | 'started' | 'ended' | 'cancelled';

export type RespondToEventInvitationResult =
  | {
      ok: true;
      participant: EventParticipantRow;
      changed: boolean;
      previousStatus: EventParticipationStatus;
    }
  | { ok: false; reason: 'not_invited'; currentStatus: null }
  | { ok: false; reason: EventParticipationLockReason; currentStatus: EventParticipationStatus };

export interface EventParticipationLockInput {
  status: string;
  starts_at: number | null;
  ended_at: number | null;
}

// The locks are deliberately asymmetric. A running event only blocks
// withdrawing an acceptance — by then the participation is a fact rather than
// an intention. Everything else about a running event stays answerable:
// an organizer inviting someone mid-LAN must still get a usable yes, and a
// plain no to that invitation is exactly the answer they asked for. A payment
// recorded against the row is the organizer's to reverse, the same reason
// removing a paid roster row is blocked in routes/events.ts.
export function eventParticipationLockReason(
  event: EventParticipationLockInput,
  change: { from: EventParticipationStatus; to: 'accepted' | 'declined' },
  paid: boolean,
  now = Date.now(),
): EventParticipationLockReason | null {
  if (paid) return 'paid';
  if (event.status === 'cancelled') return 'cancelled';
  if (event.ended_at !== null || event.status === 'ended') return 'ended';
  if (
    change.from === 'accepted' &&
    change.to === 'declined' &&
    event.starts_at !== null &&
    event.starts_at <= now
  ) {
    return 'started';
  }
  return null;
}

// An invitation is answered as often as the person changes their mind: a
// yes may be withdrawn and a no may be reconsidered, as long as no lock above
// applies. Only an actual change stamps confirmed_schedule_revision, which
// records which schedule the current answer was given for so a later
// reschedule can still be shown as "answered for the old date"
// (docs/plans/event-date-poll-concept.md) — it no longer gates the answer.
export function respondToEventInvitation(
  eventId: string,
  playerId: string,
  response: 'accepted' | 'declined',
): RespondToEventInvitationResult {
  const transaction = db.transaction((): RespondToEventInvitationResult => {
    const event = db
      .prepare('SELECT schedule_revision, status, starts_at, ended_at FROM events WHERE id = ?')
      .get(eventId) as (EventParticipationLockInput & { schedule_revision: number }) | undefined;
    const existing = db
      .prepare('SELECT status, paid FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { status: EventParticipationStatus; paid: number } | undefined;
    if (!existing || !event) return { ok: false, reason: 'not_invited', currentStatus: null };

    // Repeating the answer that already stands changes nothing, so it stays
    // idempotent even for an event that has since been locked. Otherwise a
    // client retrying its own last answer would suddenly see a conflict.
    if (existing.status === response) {
      return {
        ok: true,
        participant: { playerId, status: response, paid: Boolean(existing.paid) },
        changed: false,
        previousStatus: existing.status,
      };
    }

    const lock = eventParticipationLockReason(
      event,
      { from: existing.status, to: response },
      Boolean(existing.paid),
    );
    if (lock) return { ok: false, reason: lock, currentStatus: existing.status };

    // The conditional write is the database-side race guard: of two concurrent
    // requests for the same new answer exactly one performs the change, and
    // the other reports the identical result as unchanged.
    const updated = db
      .prepare(
        `UPDATE event_participants SET status = ?, confirmed_schedule_revision = ?
         WHERE event_id = ? AND player_id = ? AND status != ?`,
      )
      .run(response, event.schedule_revision, eventId, playerId, response);
    const paid = db
      .prepare('SELECT paid FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { paid: number };
    return {
      ok: true,
      participant: { playerId, status: response, paid: Boolean(paid.paid) },
      changed: updated.changes === 1,
      previousStatus: existing.status,
    };
  });
  return transaction();
}

export function removeEventParticipant(eventId: string, playerId: string): EventParticipationStatus | null {
  if (eventId === BASE_EVENT_ID) return null;
  return db.transaction(() => {
    const existing = db
      .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { status: EventParticipationStatus } | undefined;
    if (!existing) return null;
    db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
    fallbackPlayerEventContext(playerId, eventId);
    return existing.status;
  })();
}

// Replaces the whole roster in one go — simpler for the UI than incremental
// add/remove calls, mirroring how a tournament's team roster is set. An
// admin setting someone 'accepted' here is a direct, explicit acceptance
// decision for the event's CURRENT schedule revision, exactly like answering
// an invitation — so it stamps confirmed_schedule_revision the same way.
export function setParticipants(eventId: string, playerIds: string[]): void {
  if (eventId === BASE_EVENT_ID) throw new Error('The base event roster cannot be replaced.');
  const tx = db.transaction(() => {
    const previousIds = getParticipantIds(eventId);
    const desired = new Set(playerIds);
    const event = db.prepare('SELECT schedule_revision FROM events WHERE id = ?').get(eventId) as
      | { schedule_revision: number }
      | undefined;
    const upsert = db.prepare(
      `INSERT INTO event_participants (event_id, player_id, status, confirmed_schedule_revision) VALUES (?, ?, 'accepted', ?)
       ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted', confirmed_schedule_revision = excluded.confirmed_schedule_revision`,
    );
    for (const playerId of desired) upsert.run(eventId, playerId, event?.schedule_revision ?? 0);

    const existing = db
      .prepare('SELECT player_id FROM event_participants WHERE event_id = ?')
      .all(eventId) as Array<{ player_id: string }>;
    const remove = db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?');
    for (const { player_id: playerId } of existing) {
      if (!desired.has(playerId)) remove.run(eventId, playerId);
    }
    for (const playerId of previousIds) {
      if (!desired.has(playerId)) fallbackPlayerEventContext(playerId, eventId);
    }
  });
  tx();
}
