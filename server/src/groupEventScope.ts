import { config } from './config';
import { db, OUTSIDE_EVENTS_ID } from './db';

export type GroupEventScope = string | null;

export type GroupEventResolution =
  { ok: true; eventId: GroupEventScope } | { ok: false; status: 400 | 404; error: string };

// Resolves an optional event selector inside an already-authorized group.
// NULL is the permanent group room; the legacy outside-events sentinel maps
// to that room so new group-owned tables do not inherit the global sentinel.
export function resolveGroupEventScope(groupId: string, requestedEventId: unknown): GroupEventResolution {
  if (requestedEventId !== undefined && requestedEventId !== null && typeof requestedEventId !== 'string') {
    return { ok: false, status: 400, error: 'eventId muss eine Zeichenkette sein.' };
  }

  if (typeof requestedEventId === 'string' && requestedEventId) {
    if (requestedEventId === OUTSIDE_EVENTS_ID) return { ok: true, eventId: null };
    const event = db.prepare('SELECT group_id FROM events WHERE id = ?').get(requestedEventId) as
      { group_id: string | null } | undefined;
    if (!event || event.group_id !== groupId) {
      return { ok: false, status: 404, error: 'Event nicht gefunden.' };
    }
    return { ok: true, eventId: requestedEventId };
  }

  // Deliberately scoped to this group, not the single-row global tracking
  // helper (getTrackingEvent()/getTrackingEventId() in events.ts): with
  // MULTI_GROUPS_ENABLED, several groups can each have their own event
  // tracking_enabled at the same time (see startTracking() in events.ts),
  // and the global helper only ever returns one arbitrary row across all of
  // them. Filtering by group_id here is what actually makes "this group's
  // currently tracked event" well-defined once more than one exists.
  const tracking = db
    .prepare("SELECT id FROM events WHERE tracking_enabled = 1 AND group_id = ? AND id != ?")
    .get(groupId, OUTSIDE_EVENTS_ID) as { id: string } | undefined;
  return { ok: true, eventId: tracking?.id ?? null };
}

export function groupPlayerRows<T>(groupId: string, columns: string): T[] {
  if (config.authMode === 'legacy') {
    return db
      .prepare(`SELECT ${columns} FROM players p WHERE p.deactivated_at IS NULL ORDER BY p.name COLLATE NOCASE`)
      .all() as T[];
  }
  return db
    .prepare(
      `SELECT ${columns}
       FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id
       WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all(groupId) as T[];
}
