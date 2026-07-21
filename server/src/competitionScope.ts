import { config } from './config';
import { db, OUTSIDE_EVENTS_ID } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';
import { getTrackingEvent } from './events';

export function trackingEventIdForGroup(groupId: string): string | undefined {
  const event = getTrackingEvent();
  if (event.id === OUTSIDE_EVENTS_ID || event.group_id === groupId) return event.id;
  return undefined;
}

export function competitionPlayersBelongToGroup(groupId: string, eventId: string, playerIds: string[]): boolean {
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length === 0) return true;

  const event = db.prepare('SELECT group_id FROM events WHERE id = ?').get(eventId) as
    | { group_id: string | null }
    | undefined;
  if (!event || (eventId !== OUTSIDE_EVENTS_ID && event.group_id !== groupId)) return false;

  const placeholders = uniqueIds.map(() => '?').join(',');
  if (config.authMode === 'legacy') {
    const players = db.prepare(`SELECT id FROM players WHERE id IN (${placeholders})`).all(...uniqueIds);
    return players.length === uniqueIds.length;
  }

  const players = db
    .prepare(
      `SELECT p.id
       FROM players p
       WHERE p.id IN (${placeholders})
         AND (
           EXISTS (
             SELECT 1 FROM group_memberships gm
             WHERE gm.group_id = ? AND gm.player_id = p.id AND gm.status = 'active'
           )
           OR (
             ? != ? AND EXISTS (
               SELECT 1 FROM event_participants ep
               WHERE ep.event_id = ? AND ep.player_id = p.id AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
             )
           )
         )`,
    )
    .all(...uniqueIds, groupId, eventId, OUTSIDE_EVENTS_ID, eventId);
  return players.length === uniqueIds.length;
}
