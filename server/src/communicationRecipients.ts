import { config } from './config';
import { db } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';

// A group-room message targets every active member. An event message targets
// the current event roster, intersected with active accounts/memberships so a
// removed or deactivated account can never become a new recipient.
export function communicationRecipientIds(groupId: string, eventId: string | null): string[] {
  if (config.authMode === 'legacy') {
    const ids = (
      eventId === null
        ? (db.prepare('SELECT id FROM players WHERE deactivated_at IS NULL ORDER BY id').all() as Array<{ id: string }>)
        : (db
            .prepare(
              `SELECT ep.player_id AS id
               FROM event_participants ep JOIN players p ON p.id = ep.player_id
               WHERE ep.event_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
                 AND p.deactivated_at IS NULL ORDER BY ep.player_id`,
            )
            .all(eventId) as Array<{ id: string }>)
    ).map((row) => row.id);
    const insertMembership = db.prepare(
      `INSERT OR IGNORE INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, 'member', 'active', ?, NULL, 1, NULL)`,
    );
    const now = Date.now();
    for (const id of ids) insertMembership.run(groupId, id, now);
    return ids;
  }
  if (eventId === null) {
    return (
      db
        .prepare(
          `SELECT gm.player_id AS id
           FROM group_memberships gm JOIN players p ON p.id = gm.player_id
           WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
           ORDER BY gm.player_id`,
        )
        .all(groupId) as Array<{ id: string }>
    ).map((row) => row.id);
  }
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
