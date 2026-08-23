import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';

export interface EventContextEvent {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number | null;
  status: 'draft' | 'published' | 'cancelled' | 'ended';
  group_id: string | null;
  schedule_revision: number;
}

export type EventAccessLevel = 'none' | 'teaser' | 'participant' | 'admin';

export class InvalidEventContextError extends Error {
  constructor() {
    super('Event ist nicht als aktiver Kontext verfügbar.');
  }
}

function getActivePlayer(playerId: string): { id: string } | undefined {
  return db.prepare('SELECT id FROM players WHERE id = ? AND deactivated_at IS NULL').get(playerId) as
    { id: string } | undefined;
}

export function getSelectableEvent(eventId: string): EventContextEvent | undefined {
  if (eventId === OUTSIDE_EVENTS_ID) return undefined;
  return db
    .prepare(
      `SELECT id, name, starts_at, ends_at, status, group_id, schedule_revision
       FROM events
       WHERE id = ? AND group_id = ? AND status = 'published' AND ended_at IS NULL`,
    )
    .get(eventId, DEFAULT_GROUP_ID) as EventContextEvent | undefined;
}

// Takes the event's schedule_revision (not just its id) so the roster row
// this writes is immediately a CURRENT confirmed participation, not just an
// 'accepted' status — see eventParticipation.ts's ACCEPTED_EVENT_PARTICIPANT_SQL.
// Every caller already has the event from getSelectableEvent() (which only
// ever returns published, i.e. dated, events), so this never needs to look
// the revision up separately.
function acceptEventParticipation(playerId: string, event: EventContextEvent): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status, confirmed_schedule_revision)
     VALUES (?, ?, 'accepted', ?)
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted', confirmed_schedule_revision = excluded.confirmed_schedule_revision`,
  ).run(event.id, playerId, event.schedule_revision);
}

function storeActiveEvent(playerId: string, eventId: string): void {
  db.prepare(
    `INSERT INTO player_event_contexts (player_id, active_event_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE
       SET active_event_id = excluded.active_event_id, updated_at = excluded.updated_at`,
  ).run(playerId, eventId, Date.now());
}

function ensureBaseParticipation(playerId: string): EventContextEvent {
  const baseEvent = getSelectableEvent(BASE_EVENT_ID);
  if (!baseEvent) throw new Error('Configured base event is missing or unavailable.');
  acceptEventParticipation(playerId, baseEvent);
  return baseEvent;
}

/**
 * Completes the event side of account registration/claim. The caller may
 * already be inside a better-sqlite3 transaction; nested transactions are
 * savepoints, so account, memberships, event participation, context and
 * invite consumption still commit or roll back together.
 */
export interface EnsureAccountEventContextOptions {
  // A reusable registration link stays valid after its target event is closed;
  // in that case the new account gets the always-available base context.
  fallbackToBase?: boolean;
}

export function ensureAccountEventContext(
  playerId: string,
  preferredEventId = BASE_EVENT_ID,
  options: EnsureAccountEventContextOptions = {},
): EventContextEvent {
  return db.transaction(() => {
    if (!getActivePlayer(playerId)) throw new Error('Active player required for event context.');
    const baseEvent = ensureBaseParticipation(playerId);

    const preferredEvent = getSelectableEvent(preferredEventId);
    if (!preferredEvent) {
      if (options.fallbackToBase) {
        storeActiveEvent(playerId, baseEvent.id);
        return baseEvent;
      }
      throw new InvalidEventContextError();
    }
    acceptEventParticipation(playerId, preferredEvent);
    storeActiveEvent(playerId, preferredEvent.id);
    return preferredEvent;
  })();
}

/** Returns the stored context or repairs it to the base event. */
export function getOrRepairActiveEvent(playerId: string): EventContextEvent {
  return db.transaction(() => {
    if (!getActivePlayer(playerId)) throw new Error('Active player required for event context.');
    const current = db
      .prepare(
        `SELECT e.id, e.name, e.starts_at, e.ends_at, e.status, e.group_id
         FROM player_event_contexts pec
         JOIN events e ON e.id = pec.active_event_id
         JOIN event_participants ep
           ON ep.event_id = e.id AND ep.player_id = pec.player_id AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         WHERE pec.player_id = ? AND e.id != ? AND e.group_id = ?
           AND e.status = 'published' AND e.ended_at IS NULL`,
      )
      .get(playerId, OUTSIDE_EVENTS_ID, DEFAULT_GROUP_ID) as EventContextEvent | undefined;
    if (current) return current;

    const baseEvent = ensureBaseParticipation(playerId);
    storeActiveEvent(playerId, baseEvent.id);
    return baseEvent;
  })();
}

export function setActiveEventForPlayer(playerId: string, eventId: string): EventContextEvent | undefined {
  return db.transaction(() => {
    if (!getActivePlayer(playerId)) return undefined;
    const event = db
      .prepare(
        `SELECT e.id, e.name, e.starts_at, e.ends_at, e.status, e.group_id
         FROM events e
         JOIN event_participants ep
           ON ep.event_id = e.id AND ep.player_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         WHERE e.id = ? AND e.id != ? AND e.group_id = ?
           AND e.status = 'published' AND e.ended_at IS NULL`,
      )
      .get(playerId, eventId, OUTSIDE_EVENTS_ID, DEFAULT_GROUP_ID) as EventContextEvent | undefined;
    if (!event) return undefined;
    storeActiveEvent(playerId, event.id);
    return event;
  })();
}

export function fallbackPlayerEventContext(playerId: string, unavailableEventId: string): boolean {
  return db.transaction(() => {
    const context = db
      .prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?')
      .get(playerId) as { active_event_id: string } | undefined;
    if (context?.active_event_id !== unavailableEventId || !getActivePlayer(playerId)) return false;
    ensureBaseParticipation(playerId);
    storeActiveEvent(playerId, BASE_EVENT_ID);
    return true;
  })();
}

export function fallbackEventContexts(unavailableEventId: string): string[] {
  if (unavailableEventId === BASE_EVENT_ID) return [];
  return db.transaction(() => {
    const players = db
      .prepare('SELECT player_id FROM player_event_contexts WHERE active_event_id = ?')
      .all(unavailableEventId) as Array<{ player_id: string }>;
    const changed: string[] = [];
    for (const { player_id: playerId } of players) {
      if (!getActivePlayer(playerId)) continue;
      ensureBaseParticipation(playerId);
      storeActiveEvent(playerId, BASE_EVENT_ID);
      changed.push(playerId);
    }
    return changed;
  })();
}

export function isBaseEvent(eventId: string): boolean {
  return eventId === BASE_EVENT_ID;
}

export function historicallyParticipatedEventIds(playerId: string): string[] {
  return (
    db
      .prepare(
        `SELECT h.event_id AS eventId
         FROM event_participation_history h
         JOIN events e ON e.id = h.event_id
         WHERE h.player_id = ? AND h.accepted_at IS NOT NULL AND e.id != ?
         ORDER BY h.accepted_at, h.event_id`,
      )
      .all(playerId, OUTSIDE_EVENTS_ID) as Array<{ eventId: string }>
  ).map((row) => row.eventId);
}

export function eventAccessLevel(
  eventId: string,
  playerId: string,
  instanceRole: 'owner' | 'admin' | 'member' = 'member',
): EventAccessLevel {
  const event = db
    .prepare('SELECT id, created_by, status FROM events WHERE id = ? AND id != ? AND group_id = ?')
    .get(eventId, OUTSIDE_EVENTS_ID, DEFAULT_GROUP_ID) as
    | { id: string; created_by: string | null; status: string }
    | undefined;
  if (!event) return 'none';
  if (instanceRole === 'owner' || instanceRole === 'admin') return 'admin';
  const participation = db
    .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
    .get(eventId, playerId) as { status: 'invited' | 'interested' | 'accepted' | 'declined' } | undefined;
  if (participation?.status === 'accepted') return 'participant';
  // A planning event (draft, no fixed date yet) has no event_participants row
  // at all until the regular invitations are sent after a date is chosen —
  // its creator and anyone invited to one of its date poll rounds still need
  // to see it (docs/plans/event-date-poll-concept.md's visibility rule).
  if (event.created_by === playerId) return 'participant';
  // Restricted to the draft phase (mirrors routes/events.ts's plannedEvents
  // query): once the event is published, real event_participants rows are
  // the only source of truth. Without this, a stale invitee row from any
  // past round — including one on an event that has since been scheduled —
  // would outrank a since-recorded 'declined'/'invited' status and leak
  // participant-only fields (payments, accepted-roster names) to someone who
  // isn't actually confirmed.
  if (event.status === 'draft') {
    const pollInvited = db
      .prepare(
        `SELECT 1 FROM event_date_poll_invitees edpi
         JOIN event_date_polls edp ON edp.id = edpi.poll_id
         WHERE edp.event_id = ? AND edpi.player_id = ? LIMIT 1`,
      )
      .get(eventId, playerId);
    if (pollInvited) return 'participant';
  }
  if (participation?.status === 'invited' || participation?.status === 'interested') return 'teaser';
  return 'none';
}
