// Competition organizers earn Orga points only when a documented result exists.
import { db, OUTSIDE_EVENTS_ID } from './db';
import { syncAutomaticPoints, type AutomaticAward } from './automaticPoints';
import { computeStandings } from './leaderboard';
import { readScoringInputs } from './leaderboardData';
import { syncPlayingPoints } from './playingPoints';

export function syncOrgaPoints(groupId: string, eventId: string): boolean {
  return syncAutomaticPoints(groupId, eventId, 'orga', () => {
    const { matches } = readScoringInputs(groupId, [eventId]);
    const awards: AutomaticAward[] = [];
    for (const match of matches) {
      if (!match.createdBy || computeStandings([match]).length === 0) continue;
      // A tournament result is already one canonical match. Its organizer was
      // copied when the result was created, so deleting a bracket cannot mint
      // a second standalone-match reward or change the original recipient.
      awards.push({
        playerId: match.createdBy,
        sourceKey: `match:${match.id}`,
        amount: 1,
        title: `Spiel organisiert: ${match.gameName}`,
      });
    }
    const completed = db
      .prepare(
        `SELECT id, name, created_by FROM tournaments
      WHERE group_id = ? AND event_id = ? AND status = 'completed' AND ended_early = 0
      AND created_by IS NOT NULL`,
      )
      .all(groupId, eventId) as Array<{ id: string; name: string; created_by: string }>;
    for (const tournament of completed)
      awards.push({
        playerId: tournament.created_by,
        sourceKey: `tournament:${tournament.id}:completion`,
        amount: 5,
        title: `Turnier organisiert: ${tournament.name}`,
      });
    return awards;
  });
}

export function syncCompetitionPoints(groupId: string, eventId: string): boolean {
  return db
    .transaction(() => {
      const playingChanged = syncPlayingPoints(groupId, eventId);
      const orgaChanged = syncOrgaPoints(groupId, eventId);
      return playingChanged || orgaChanged;
    })
    .immediate();
}

export function backfillCompetitionPoints(): void {
  const events = db
    .prepare('SELECT id, group_id FROM events WHERE group_id IS NOT NULL AND id != ?')
    .all(OUTSIDE_EVENTS_ID) as Array<{ id: string; group_id: string }>;
  for (const event of events) {
    try {
      syncCompetitionPoints(event.group_id, event.id);
    } catch (error) {
      console.error(`Competition points could not be synchronized for event ${event.id}:`, error);
    }
  }
}
