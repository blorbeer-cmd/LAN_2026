import { db } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';

// An event message targets the event roster, intersected with active accounts/memberships so a
// removed or deactivated account can never become a new recipient.
export function communicationRecipientIds(groupId: string, eventId: string): string[] {
  return (
    db
      .prepare(
        `SELECT ep.player_id AS id
         FROM event_participants ep
         JOIN events e ON e.id = ep.event_id AND e.group_id = ?
         JOIN group_memberships gm ON gm.group_id = e.group_id AND gm.player_id = ep.player_id
         JOIN players p ON p.id = ep.player_id
         WHERE ep.event_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
           AND gm.status = 'active' AND p.deactivated_at IS NULL
         ORDER BY ep.player_id`,
      )
      .all(groupId, eventId) as Array<{ id: string }>
  ).map((row) => row.id);
}
