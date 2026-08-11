import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';

export interface EventContextEvent {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number | null;
  status: 'draft' | 'published' | 'cancelled' | 'ended';
  group_id: string | null;
}

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
      `SELECT id, name, starts_at, ends_at, status, group_id
       FROM events
       WHERE id = ? AND group_id = ? AND status = 'published' AND ended_at IS NULL`,
    )
    .get(eventId, DEFAULT_GROUP_ID) as EventContextEvent | undefined;
}

function acceptEventParticipation(playerId: string, eventId: string): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted'`,
  ).run(eventId, playerId);
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
  acceptEventParticipation(playerId, BASE_EVENT_ID);
  return baseEvent;
}

/**
 * Completes the event side of account registration/claim. The caller may
 * already be inside a better-sqlite3 transaction; nested transactions are
 * savepoints, so account, memberships, event participation, context and
 * invite consumption still commit or roll back together.
 */
export function ensureAccountEventContext(playerId: string, preferredEventId = BASE_EVENT_ID): EventContextEvent {
  return db.transaction(() => {
    if (!getActivePlayer(playerId)) throw new Error('Active player required for event context.');
    ensureBaseParticipation(playerId);

    const preferredEvent = getSelectableEvent(preferredEventId);
    if (!preferredEvent) throw new InvalidEventContextError();
    acceptEventParticipation(playerId, preferredEvent.id);
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
           ON ep.event_id = e.id AND ep.player_id = pec.player_id AND ep.status = 'accepted'
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
           ON ep.event_id = e.id AND ep.player_id = ? AND ep.status = 'accepted'
         WHERE e.id = ? AND e.id != ? AND e.group_id = ?
           AND e.status = 'published' AND e.ended_at IS NULL`,
      )
      .get(playerId, eventId, OUTSIDE_EVENTS_ID, DEFAULT_GROUP_ID) as EventContextEvent | undefined;
    if (!event) return undefined;
    storeActiveEvent(playerId, event.id);
    return event;
  })();
}

export function fallbackPlayerEventContext(playerId: string, unavailableEventId: string): void {
  db.transaction(() => {
    const context = db
      .prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?')
      .get(playerId) as { active_event_id: string } | undefined;
    if (context?.active_event_id !== unavailableEventId || !getActivePlayer(playerId)) return;
    ensureBaseParticipation(playerId);
    storeActiveEvent(playerId, BASE_EVENT_ID);
  })();
}

export function fallbackEventContexts(unavailableEventId: string): void {
  if (unavailableEventId === BASE_EVENT_ID) return;
  db.transaction(() => {
    const players = db
      .prepare('SELECT player_id FROM player_event_contexts WHERE active_event_id = ?')
      .all(unavailableEventId) as Array<{ player_id: string }>;
    for (const { player_id: playerId } of players) {
      if (!getActivePlayer(playerId)) continue;
      ensureBaseParticipation(playerId);
      storeActiveEvent(playerId, BASE_EVENT_ID);
    }
  })();
}

export function isBaseEvent(eventId: string): boolean {
  return eventId === BASE_EVENT_ID;
}
