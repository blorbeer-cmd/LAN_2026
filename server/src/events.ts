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
    .prepare('SELECT * FROM events WHERE id NOT IN (?, ?) AND group_id = ? ORDER BY starts_at DESC')
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

// Closes an event for good — stops tracking first if it was on (same live
// status wipe as stopTracking), then marks it ended so it can't be
// re-tracked. Valid on any real event regardless of current tracking state
// (e.g. formally closing an event that was never actually tracked).
export function endEvent(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (!event || event.id === OUTSIDE_EVENTS_ID || event.id === BASE_EVENT_ID) return undefined;

  const wasTracking = Boolean(event.tracking_enabled);
  db.prepare("UPDATE events SET tracking_enabled = 0, ended_at = ?, status = 'ended' WHERE id = ?").run(Date.now(), id);
  if (wasTracking) closeEventContexts(id);
  fallbackEventContexts(id);
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
      // Reopening as 'invited' must also clear confirmed_schedule_revision:
      // otherwise a re-invited person whose stale value already equals the
      // event's current revision would find respondToEventInvitation's
      // guard permanently closed (it only reopens for a revision mismatch),
      // even though their actual status is 'invited' and clearly not yet
      // answered again.
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

export type RespondToEventInvitationResult =
  | { ok: true; participant: EventParticipantRow; changed: boolean }
  | { ok: false; currentStatus: EventParticipationStatus | null };

// A participant "confirms" (accepts or declines) for the event's CURRENT
// schedule revision — not just its raw status column. Two situations both
// count as "not yet confirmed for this revision" and are therefore open to a
// fresh answer: a brand new invitation (status 'invited',
// confirmed_schedule_revision NULL) and a stale accepted/declined row left
// over from before a reschedule (confirmed_schedule_revision < the event's
// current schedule_revision — see docs/plans/event-date-poll-concept.md's
// "Erneute Bestätigung erforderlich"). Once confirmed_schedule_revision
// matches the current revision, the answer is locked the same way it always
// was: an identical resubmit is a no-op, a flip to the other answer is 409.
export function respondToEventInvitation(
  eventId: string,
  playerId: string,
  response: 'accepted' | 'declined',
): RespondToEventInvitationResult {
  const transaction = db.transaction((): RespondToEventInvitationResult => {
    const event = db.prepare('SELECT schedule_revision FROM events WHERE id = ?').get(eventId) as
      | { schedule_revision: number }
      | undefined;
    const existing = db
      .prepare('SELECT status, confirmed_schedule_revision AS confirmedRevision FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { status: EventParticipationStatus; confirmedRevision: number | null } | undefined;
    if (!existing || !event) return { ok: false, currentStatus: existing?.status ?? null };

    // The conditional write is the database-side race guard: only a row that
    // is still unconfirmed for the current revision can be claimed by either
    // response, and only one of two concurrent requests can win it.
    const updated = db
      .prepare(
        `UPDATE event_participants SET status = ?, confirmed_schedule_revision = ?
         WHERE event_id = ? AND player_id = ?
           AND (confirmed_schedule_revision IS NULL OR confirmed_schedule_revision != ?)`,
      )
      .run(response, event.schedule_revision, eventId, playerId, event.schedule_revision);
    if (updated.changes === 1) {
      const paid = db
        .prepare('SELECT paid FROM event_participants WHERE event_id = ? AND player_id = ?')
        .get(eventId, playerId) as { paid: number };
      return { ok: true, participant: { playerId, status: response, paid: Boolean(paid.paid) }, changed: true };
    }

    // Already confirmed for this revision (or lost the race above) — re-read
    // and preserve idempotency only for an identical outcome.
    const current = db
      .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { status: EventParticipationStatus } | undefined;
    if (current?.status === response) {
      const paid = db
        .prepare('SELECT paid FROM event_participants WHERE event_id = ? AND player_id = ?')
        .get(eventId, playerId) as { paid: number };
      return { ok: true, participant: { playerId, status: response, paid: Boolean(paid.paid) }, changed: false };
    }
    return { ok: false, currentStatus: current?.status ?? null };
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
