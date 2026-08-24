import { db } from './db';

export interface GroupPlayerSnapshot {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

// New or still-mutable group data may only reference active members of the
// request's retained group_id scope.
export function activeGroupPlayers(groupId: string, playerIds: string[]): Map<string, GroupPlayerSnapshot> {
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length === 0) return new Map();

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.color, p.avatar
       FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id
       WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
         AND p.id IN (${placeholders})`,
    )
    .all(groupId, ...uniqueIds) as GroupPlayerSnapshot[];

  return new Map(rows.map((player) => [player.id, player]));
}
