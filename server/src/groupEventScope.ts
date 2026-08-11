import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import type { Request, Response } from 'express';
import { isParticipant } from './events';

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
  // helper (getTrackingEvent()/getTrackingEventId() in events.ts): filtering
  // by group_id here is what makes "this group's currently tracked event"
  // well-defined, independent of how that global helper resolves ties.
  const tracking = db
    .prepare("SELECT id FROM events WHERE tracking_enabled = 1 AND group_id = ? AND id != ?")
    .get(groupId, OUTSIDE_EVENTS_ID) as { id: string } | undefined;
  return { ok: true, eventId: tracking?.id ?? null };
}

// Resolves a request's effective event scope without turning a private
// tracking event into an error for ordinary group-room requests. An omitted
// selector means "use my current context": accepted participants and group
// moderators enter the tracking event, while everyone else stays in the
// durable group room. A non-empty eventId is an explicit lookup and keeps the
// existing not-found/access-denied behavior at the calling route.
export function resolveRequestGroupEventScope(req: Request, requestedEventId: unknown): GroupEventResolution {
  const scope = resolveGroupEventScope(req.group!.id, requestedEventId);
  if (!scope.ok || scope.eventId === null || requestCanAccessGroupEvent(req, scope.eventId)) return scope;

  const hasExplicitSelector = typeof requestedEventId === 'string' && requestedEventId.length > 0;
  return hasExplicitSelector ? scope : { ok: true, eventId: null };
}

// Applies the existing visibility/role contracts after an event id has been
// resolved inside the request's group. Participant-private events admit only
// accepted participants plus admins/owners. Kiosk requests keep their own
// validated token/allowlist contract and group/public events remain readable
// to every active group member.
export function requestCanAccessGroupEvent(req: Request, eventId: GroupEventScope): boolean {
  if (eventId === null || req.kioskScope) return true;
  const event = db.prepare('SELECT group_id, visibility_scope FROM events WHERE id = ?').get(eventId) as
    | { group_id: string | null; visibility_scope: string }
    | undefined;
  if (!event || event.group_id !== req.group?.id) return false;
  if (event.visibility_scope === 'group' || event.visibility_scope === 'public') return true;
  if (req.groupMembership?.role === 'admin' || req.groupMembership?.role === 'owner') return true;
  return Boolean(req.player && isParticipant(eventId, req.player.id));
}

export function requireGroupEventAccess(req: Request, res: Response, eventId: GroupEventScope): boolean {
  if (requestCanAccessGroupEvent(req, eventId)) return true;
  res.status(404).json({ error: 'Event nicht gefunden.' });
  return false;
}

// Arrivals and food orders still use the legacy event-owned schema with a
// non-null event_id and no denormalized group_id. Resolve that storage key
// from the already-authorized group instead of using the instance-wide
// getTrackingEventId(). Only the migrated start group may use the historic
// outside-events sentinel. Any other retained group_id (for example in direct
// database regression fixtures) has no storage scope without a tracking event.
export function resolveGroupEventStorageId(groupId: string): string | null {
  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return null;
  return scope.eventId ?? (groupId === DEFAULT_GROUP_ID ? OUTSIDE_EVENTS_ID : null);
}

export function resolveRequestGroupEventStorageId(req: Request): string | null {
  const scope = resolveRequestGroupEventScope(req, undefined);
  if (!scope.ok) return null;
  return scope.eventId ?? (req.group!.id === DEFAULT_GROUP_ID ? OUTSIDE_EVENTS_ID : null);
}

export function groupPlayerRows<T>(groupId: string, columns: string): T[] {
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
