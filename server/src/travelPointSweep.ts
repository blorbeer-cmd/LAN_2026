import { db, OUTSIDE_EVENTS_ID } from './db';
import { grantTravelPoints } from './travelPoints';
import { broadcast, Events } from './realtime';

const reportedFailures = new Set<string>();

export function sweepTravelPoints(now = Date.now()): void {
  const events = db.prepare(`SELECT e.id,e.group_id FROM events e
    LEFT JOIN points_settings s ON s.event_id=e.id
    WHERE e.id != ? AND e.group_id IS NOT NULL AND e.status IN ('published','ended') AND e.starts_at IS NOT NULL AND e.starts_at <= ? AND s.closed_at IS NULL
    AND EXISTS (SELECT 1 FROM arrivals a JOIN event_participants ep
      ON ep.event_id=a.event_id AND ep.player_id=a.player_id AND ep.status='accepted'
      WHERE a.event_id=e.id AND a.updated_at<=e.starts_at AND (
        (a.arrival_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM points_orga_awards x
          WHERE x.event_id=e.id AND x.player_id=a.player_id AND x.source_key='bonus:arrival')) OR
        (a.departure_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM points_orga_awards x
          WHERE x.event_id=e.id AND x.player_id=a.player_id AND x.source_key='bonus:departure'))))`)
    .all(OUTSIDE_EVENTS_ID, now) as Array<{ id: string; group_id: string }>;
  for (const event of events) {
    try {
      if (grantTravelPoints(event.group_id, event.id, now))
        broadcast(Events.leaderboardChanged, null, { groupId: event.group_id, eventId: event.id });
      reportedFailures.delete(event.id);
    } catch (error) {
      if (!reportedFailures.has(event.id)) {
        console.error(`Travel points could not be synchronized for event ${event.id}:`, error);
        reportedFailures.add(event.id);
      }
    }
  }
}

export function startTravelPointSweep(): NodeJS.Timeout {
  const run = () => {
    try { sweepTravelPoints(); }
    catch (error) { console.error('Travel point sweep failed:', error); }
  };
  run();
  const timer = setInterval(run, 1000);
  timer.unref();
  return timer;
}
