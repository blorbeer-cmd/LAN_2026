import type { Request } from 'express';
import { db } from './db';

// Admin mode is deliberately device-local and is not an authorization
// boundary. The browser sends this header on every REST request while the
// mode is active so aggregate queries can decide whether fixture rows belong
// in the result before player ids are lost through grouping.
export function isAdminTestMode(req: Request): boolean {
  return req.headers?.['x-admin-mode'] === '1';
}

// A test identity must still be able to exercise the application together
// with the other seeded identities. Real accounts only receive fixture-player
// data while their device is explicitly in Admin mode.
export function includesTestPlayers(req: Request): boolean {
  return isAdminTestMode(req) || req.player?.is_test === 1;
}

export function testPlayerIds(): Set<string> {
  return new Set(
    (db.prepare('SELECT id FROM players WHERE is_test = 1').all() as Array<{ id: string }>).map((row) => row.id),
  );
}

export function matchResultContainsPlayerIds(result: string, playerIds: Set<string>): boolean {
  if (playerIds.size === 0) return false;
  try {
    const parsed = JSON.parse(result) as { teams?: Array<{ playerIds?: unknown }> };
    return (parsed.teams ?? []).some(
      (team) => Array.isArray(team.playerIds) && team.playerIds.some((id) => typeof id === 'string' && playerIds.has(id)),
    );
  } catch {
    // Malformed historical rows are handled by their existing consumers. A
    // visibility filter must not turn them into an otherwise unrelated 500.
    return false;
  }
}
