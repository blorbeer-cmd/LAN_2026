// Pure scoring logic shared by the leaderboard, Hall of Fame and export.

export const WIN_POINTS = 3;
export const PARTICIPATION_POINTS = 1;
export const TOURNAMENT_PLACEMENT_POINTS: Readonly<Record<number, number>> = { 1: 5, 2: 3, 3: 1 };

export interface MatchForScoring {
  teams: Array<{ playerIds: string[] }>;
  winnerTeamIndex: number | null;
  isDraw?: boolean;
}

export interface TournamentPlacementForScoring {
  playerIds: string[];
  place: number;
}

export interface PlayerStanding {
  playerId: string;
  points: number;
  wins: number;
  matchesPlayed: number;
}

export function computeStandings(
  matches: MatchForScoring[],
  placements: TournamentPlacementForScoring[] = [],
): PlayerStanding[] {
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
    // A missing winner alone does not establish a draw or a played result.
    if (match.winnerTeamIndex === null && !match.isDraw) continue;
    match.teams.forEach((team, teamIndex) => {
      const isWinner = match.winnerTeamIndex === teamIndex;
      for (const playerId of team.playerIds) {
        const standing = ensure(playerId);
        standing.matchesPlayed += 1;
        standing.points += isWinner ? WIN_POINTS : PARTICIPATION_POINTS;
        if (isWinner) {
          standing.wins += 1;
        }
      }
    });
  }

  for (const placement of placements) {
    const points = TOURNAMENT_PLACEMENT_POINTS[placement.place] ?? 0;
    if (!points) continue;
    for (const playerId of placement.playerIds) ensure(playerId).points += points;
  }

  return [...byPlayer.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
}
