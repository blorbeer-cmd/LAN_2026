import { db } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';

export function competitionPlayersBelongToGroup(groupId: string, eventId: string, playerIds: string[]): boolean {
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length === 0) return true;

  const event = db.prepare('SELECT group_id FROM events WHERE id = ?').get(eventId) as
    | { group_id: string | null }
    | undefined;
  if (!event || event.group_id !== groupId) return false;

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(
      `SELECT p.id
       FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id AND gm.group_id = ? AND gm.status = 'active'
       JOIN event_participants ep ON ep.player_id = p.id AND ep.event_id = ?
       WHERE p.deactivated_at IS NULL AND p.id IN (${placeholders})
         AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
    )
    .all(groupId, eventId, ...uniqueIds);
  return players.length === uniqueIds.length;
}
