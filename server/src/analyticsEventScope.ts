import type { Request } from 'express';
import { db } from './db';
import { historicallyParticipatedEventIds } from './eventContext';
import { isAdminTestMode } from './testDataVisibility';

export type AnalyticsEventResolution =
  | { ok: true; eventIds: string[]; explicitEventId: string | null }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Personal analytics may aggregate only events the current account has
 * actually accepted at some point. Removal from the current roster does not
 * erase that history. A kiosk remains bound to exactly its token event.
 */
export function resolveAnalyticsEvents(req: Request, requestedEventId: unknown): AnalyticsEventResolution {
  if (requestedEventId !== undefined && requestedEventId !== null && typeof requestedEventId !== 'string') {
    return { ok: false, status: 400, error: 'eventId muss eine Zeichenkette sein.' };
  }
  const explicitEventId = typeof requestedEventId === 'string' && requestedEventId ? requestedEventId : null;
  if (req.kioskScope) {
    const eventId = req.kioskScope.eventId;
    if (!eventId || (explicitEventId && explicitEventId !== eventId)) {
      return { ok: false, status: 404, error: 'Event nicht gefunden.' };
    }
    const event = db.prepare('SELECT is_test FROM events WHERE id = ?').get(eventId) as { is_test: number } | undefined;
    if (!event || (event.is_test && !isAdminTestMode(req))) {
      return { ok: false, status: 404, error: 'Event nicht gefunden.' };
    }
    return { ok: true, eventIds: [eventId], explicitEventId: eventId };
  }
  if (!req.player) return { ok: false, status: 404, error: 'Event nicht gefunden.' };
  let eventIds = historicallyParticipatedEventIds(req.player.id);
  if (!isAdminTestMode(req) && eventIds.length > 0) {
    const placeholders = eventIds.map(() => '?').join(',');
    eventIds = (
      db.prepare(`SELECT id FROM events WHERE is_test = 0 AND id IN (${placeholders})`).all(...eventIds) as Array<{
        id: string;
      }>
    ).map((event) => event.id);
  }
  if (explicitEventId) {
    return eventIds.includes(explicitEventId)
      ? { ok: true, eventIds: [explicitEventId], explicitEventId }
      : { ok: false, status: 404, error: 'Event nicht gefunden.' };
  }
  return { ok: true, eventIds, explicitEventId: null };
}

export function eventIdSql(column: string, eventIds: string[]): { clause: string; params: string[] } {
  if (eventIds.length === 0) return { clause: '1 = 0', params: [] };
  return { clause: `${column} IN (${eventIds.map(() => '?').join(',')})`, params: eventIds };
}
