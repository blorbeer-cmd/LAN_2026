import { config } from './config';
import { db } from './db';

export interface GroupPlayerSnapshot {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

// New or still-mutable group data may only reference active members of the
// selected group. Legacy mode keeps its single-group compatibility behaviour
// until the required-auth rollout is complete.
export function activeGroupPlayers(groupId: string, playerIds: string[]): Map<string, GroupPlayerSnapshot> {
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length === 0) return new Map();

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = (
    config.authMode === 'legacy'
      ? db
          .prepare(
            `SELECT id, name, color, avatar FROM players WHERE deactivated_at IS NULL AND id IN (${placeholders})`,
          )
          .all(...uniqueIds)
      : db
          .prepare(
            `SELECT p.id, p.name, p.color, p.avatar
             FROM players p
             JOIN group_memberships gm ON gm.player_id = p.id
             WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
               AND p.id IN (${placeholders})`,
          )
          .all(groupId, ...uniqueIds)
  ) as GroupPlayerSnapshot[];

  if (config.authMode === 'legacy') {
    const insertMembership = db.prepare(
      `INSERT OR IGNORE INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, 'member', 'active', ?, NULL, 1, NULL)`,
    );
    const now = Date.now();
    for (const player of rows) insertMembership.run(groupId, player.id, now);
  }

  return new Map(rows.map((player) => [player.id, player]));
}
