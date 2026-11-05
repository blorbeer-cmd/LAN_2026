import { db } from './db';

// A financial reset must not be undone by startup backfills, edits or rejoining.
// NULL is a whole domain source; a player ID is a personal, permanent bonus.
export function isResetPointsSource(eventId: string, playerId: string, sourceKey: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM points_reset_sources
    WHERE event_id=? AND source_key=? AND (player_id IS NULL OR player_id=?)`).get(eventId, sourceKey, playerId));
}
