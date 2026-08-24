import { BASE_EVENT_ID, db, OUTSIDE_EVENTS_ID } from './db';
import type { Request, Response } from 'express';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';
import { getOrRepairActiveEvent } from './eventContext';

export type GroupEventScope = string | null;

export type GroupEventResolution =
  { ok: true; eventId: GroupEventScope } | { ok: false; status: 400 | 404; error: string };

// Low-level resolver for explicit/background scopes. Request-facing defaults
// are resolved separately from the account's persisted workspace below.
export function resolveGroupEventScope(groupId: string, requestedEventId: unknown): GroupEventResolution {
  if (requestedEventId !== undefined && requestedEventId !== null && typeof requestedEventId !== 'string') {
    return { ok: false, status: 400, error: 'eventId muss eine Zeichenkette sein.' };
  }

  if (typeof requestedEventId === 'string' && requestedEventId) {
    if (requestedEventId === OUTSIDE_EVENTS_ID) {
      return { ok: false, status: 404, error: 'Event nicht gefunden.' };
    }
    const event = db
      .prepare("SELECT group_id FROM events WHERE id = ? AND status = 'published' AND ended_at IS NULL")
      .get(requestedEventId) as { group_id: string | null } | undefined;
    if (!event || event.group_id !== groupId) return { ok: false, status: 404, error: 'Event nicht gefunden.' };
    return { ok: true, eventId: requestedEventId };
  }
  const base = db.prepare('SELECT id FROM events WHERE id = ? AND group_id = ?').get(BASE_EVENT_ID, groupId) as
    | { id: string }
    | undefined;
  return base
    ? { ok: true, eventId: base.id }
    : { ok: false, status: 404, error: 'Basis-Event nicht gefunden.' };
}

// Resolves a request's effective event scope. An omitted selector always
// means the account's persisted active event; an explicit selector is used
// only by authorized history/administration and kiosk reads.
export function resolveRequestGroupEventScope(req: Request, requestedEventId: unknown): GroupEventResolution {
  const hasExplicitSelector = typeof requestedEventId === 'string' && requestedEventId.length > 0;
  if (hasExplicitSelector) return resolveGroupEventScope(req.group!.id, requestedEventId);
  if (req.kioskScope?.eventId) return resolveGroupEventScope(req.group!.id, req.kioskScope.eventId);
  if (!req.player) return { ok: false, status: 404, error: 'Event nicht gefunden.' };
  const activeEvent = getOrRepairActiveEvent(req.player.id);
  if (activeEvent.group_id !== req.group!.id) return { ok: false, status: 404, error: 'Event nicht gefunden.' };
  return { ok: true, eventId: activeEvent.id };
}

// Confirmed participation is the normal workspace visibility contract.
// Administrative event management uses its own role-guarded routes; it never
// turns into a read bypass for operational event data.
//
// The group boundary is checked here rather than left to the ~30 call sites:
// most of them pre-scope their event id (via resolveRequestGroupEventScope or
// a group_id-filtered row lookup), but a single caller forgetting that must
// not silently turn this shared guard into a participation-only check.
export function requestCanUseEventWorkspace(req: Request, eventId: GroupEventScope): boolean {
  if (eventId === null) return false;
  if (req.kioskScope) return req.kioskScope.eventId === eventId;
  if (!req.player || !req.group) return false;
  // Group boundary and participation in one statement: this runs on every
  // event-scoped request, so the check must not cost an extra round trip
  // compared to the participation-only lookup it replaces.
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM event_participants ep
         JOIN events e ON e.id = ep.event_id
         WHERE ep.event_id = ? AND ep.player_id = ? AND e.group_id = ?
           AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
      )
      .get(eventId, req.player.id, req.group.id),
  );
}

export function requireGroupEventAccess(req: Request, res: Response, eventId: GroupEventScope): boolean {
  if (requestCanUseEventWorkspace(req, eventId)) return true;
  res.status(404).json({ error: 'Event nicht gefunden.' });
  return false;
}

// Resolves an optional event selector to a workspace this request may use.
// There is no group-room fallback: missing participation is always a 404.
export function resolveAccessibleGroupEventScope(
  req: Request,
  res: Response,
  requestedEventId: unknown,
): { eventId: GroupEventScope; usedGroupRoomFallback: boolean } | null {
  const scope = resolveRequestGroupEventScope(req, requestedEventId);
  if (!scope.ok) {
    res.status(scope.status).json({ error: scope.error });
    return null;
  }
  if (!requestCanUseEventWorkspace(req, scope.eventId)) {
    res.status(404).json({ error: 'Event nicht gefunden.' });
    return null;
  }
  return { eventId: scope.eventId, usedGroupRoomFallback: false };
}

// Arrivals and food orders use the request's concrete active event as their
// storage key; both schemas require a non-null event_id.
export function resolveGroupEventStorageId(groupId: string): string | null {
  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return null;
  return scope.eventId;
}

export function resolveRequestGroupEventStorageId(req: Request): string | null {
  const scope = resolveRequestGroupEventScope(req, undefined);
  if (!scope.ok) return null;
  return scope.eventId;
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
