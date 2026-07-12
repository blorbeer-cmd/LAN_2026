import { db } from '../db';

export function playerMayUseArcadeAi(playerId: unknown): boolean {
  if (typeof playerId !== 'string' || playerId.length === 0) return false;
  const row = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId) as { is_admin: number } | undefined;
  return row?.is_admin === 1;
}
