// Playing journal and classic leaderboard use the same scoring inputs and rules.
import { computeStandings, TOURNAMENT_PLACEMENT_POINTS } from './leaderboard';
import { readScoringInputs } from './leaderboardData';
import { syncAutomaticPoints, type AutomaticAward } from './automaticPoints';

export function syncPlayingPoints(groupId: string, eventId: string): boolean {
  return syncAutomaticPoints(groupId, eventId, 'playing', () => {
    const { matches, placements } = readScoringInputs(groupId, [eventId]);
    const awards: AutomaticAward[] = [];
    for (const match of matches) {
      for (const standing of computeStandings([match]))
        awards.push({
          playerId: standing.playerId,
          sourceKey: `match:${match.id}`,
          amount: standing.points,
          title: `Spiel: ${match.gameName}`,
        });
    }
    for (const placement of placements) {
      const amount = TOURNAMENT_PLACEMENT_POINTS[placement.place] ?? 0;
      if (!amount) continue;
      for (const playerId of placement.playerIds)
        awards.push({
          playerId,
          sourceKey: `tournament:${placement.tournamentId}:placement`,
          amount,
          title: `Turnier: ${placement.tournamentName} · Platz ${placement.place}`,
        });
    }
    return awards;
  });
}
