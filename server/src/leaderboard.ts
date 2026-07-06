// Pure scoring logic for the leaderboard (FR-23), kept separate from the
// route/DB so it's directly unit-testable. The point values are a placeholder
// — the exact scoring rules are still to be decided; change the two
// constants below once that's settled, nothing else needs to move.

export const WIN_POINTS = 3;
export const PARTICIPATION_POINTS = 1;

export interface MatchForScoring {
  teams: Array<{ playerIds: string[] }>;
  winnerTeamIndex: number | null;
}

export interface PlayerStanding {
  playerId: string;
  points: number;
  wins: number;
  matchesPlayed: number;
}

export function computeStandings(matches: MatchForScoring[]): PlayerStanding[] {
  const byPlayer = new Map<string, PlayerStanding>();

  function ensure(playerId: string): PlayerStanding {
    let standing = byPlayer.get(playerId);
    if (!standing) {
      standing = { playerId, points: 0, wins: 0, matchesPlayed: 0 };
      byPlayer.set(playerId, standing);
    }
    return standing;
  }

  for (const match of matches) {
    match.teams.forEach((team, teamIndex) => {
      const isWinner = match.winnerTeamIndex === teamIndex;
      for (const playerId of team.playerIds) {
        const standing = ensure(playerId);
        standing.matchesPlayed += 1;
        standing.points += PARTICIPATION_POINTS;
        if (isWinner) {
          standing.points += WIN_POINTS;
          standing.wins += 1;
        }
      }
    });
  }

  return [...byPlayer.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
}
