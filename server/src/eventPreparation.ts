// What a participant should have entered before an event starts: the own
// arrival time and the own skill for every game in the catalog. Shared by
// Home's "Meine To-Dos" (myTodos.ts) and the upcoming-event push reminders
// (eventReminders.ts), so the push asks for exactly what the To-Dos list.

import { db } from './db';
import { isEventFeatureEnabled } from './eventFeatures';

// Accepted catalog games (no suggestions, no built-in Arcade titles) without
// a skill rating of this account. A 0 ("nie gespielt") counts as rated, so
// every game can be settled, including ones the account never played.
export function unratedCatalogGameCount(groupId: string, playerId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM games g
       WHERE g.group_id = ? AND g.status = 'catalog' AND g.arcade_key IS NULL
         AND NOT EXISTS (SELECT 1 FROM skills s WHERE s.group_id = g.group_id AND s.player_id = ? AND s.game_id = g.id)`,
    )
    .get(groupId, playerId) as { count: number };
  return row.count;
}

export interface OpenEventPreparation {
  arrival: boolean;
  skills: boolean;
}

// The open items of one participant for one event, limited to the areas the
// event actually uses (An- & Abreise, Spiele).
export function openEventPreparation(eventId: string, groupId: string, playerId: string): OpenEventPreparation {
  const arrival =
    isEventFeatureEnabled(eventId, 'travel') &&
    !db
      .prepare('SELECT 1 FROM arrivals WHERE event_id = ? AND player_id = ? AND arrival_at IS NOT NULL')
      .get(eventId, playerId);
  const skills = isEventFeatureEnabled(eventId, 'games') && unratedCatalogGameCount(groupId, playerId) > 0;
  return { arrival, skills };
}
