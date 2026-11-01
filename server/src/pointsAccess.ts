import { db } from './db';

export class PointsError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

export function requirePointsAdmin(groupId: string, actorId: string): void {
  const admin = db
    .prepare(
      `SELECT 1 FROM group_memberships gm JOIN players p ON p.id = gm.player_id
    WHERE gm.group_id = ? AND gm.player_id = ? AND gm.status = 'active'
      AND gm.role IN ('owner','admin') AND p.deactivated_at IS NULL`,
    )
    .get(groupId, actorId);
  if (!admin) throw new PointsError('Dafür ist eine aktive Community-Adminrolle erforderlich.', 403);
}
