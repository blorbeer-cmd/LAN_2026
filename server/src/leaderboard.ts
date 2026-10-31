// Pure scoring logic shared by the leaderboard, Hall of Fame and export.

export const WIN_POINTS = 4;
export const PARTICIPATION_POINTS = 1;
export const TOURNAMENT_PLACEMENT_POINTS: Readonly<Record<number, number>> = { 1: 5, 2: 3, 3: 1 };

export interface MatchForScoring {
  teams: Array<{ playerIds: string[]; rank?: number | null }>;
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

function pointsForPosition(position: number, teamCount: number): number {
  // Even with two or three teams, the last place always earns just one point.
  if (position === teamCount - 1) return PARTICIPATION_POINTS;
  return [WIN_POINTS, 3, 2][position] ?? PARTICIPATION_POINTS;
}

function computeMatchPoints(match: MatchForScoring): number[] | null {
  const { teams, winnerTeamIndex } = match;
  if (teams.length < 2) return null;

  // Complete placements are a result in their own right, including tied first
  // places with no single winner. Scores alone have no universal sort direction.
  if (teams.every((team) => Number.isInteger(team.rank) && team.rank! >= 1)) {
    const order = teams.map((_, index) => index).sort((a, b) => teams[a].rank! - teams[b].rank!);
    const points = teams.map(() => 0);
    for (let start = 0; start < order.length;) {
      let end = start + 1;
      while (end < order.length && teams[order[end]].rank === teams[order[start]].rank) end++;
      let total = 0;
      for (let position = start; position < end; position++) total += pointsForPosition(position, teams.length);
      const shared = Math.floor(total / (end - start));
      for (let position = start; position < end; position++) points[order[position]] = shared;
      start = end;
    }
    return points;
  }

  // A winner-only result does not establish the other teams' individual places.
  if (
    winnerTeamIndex !== null &&
    Number.isInteger(winnerTeamIndex) &&
    winnerTeamIndex >= 0 &&
    winnerTeamIndex < teams.length
  ) {
    return teams.map((_, index) => (index === winnerTeamIndex ? WIN_POINTS : PARTICIPATION_POINTS));
  }
  if (match.isDraw) {
    const total = teams.reduce((sum, _, index) => sum + pointsForPosition(index, teams.length), 0);
    return teams.map(() => Math.floor(total / teams.length));
  }
  return null;
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
    const points = computeMatchPoints(match);
    if (!points) continue;
    match.teams.forEach((team, teamIndex) => {
      // Only an outright first place earns four points; tied first places do not
      // count as individual wins, even when a legacy winner field is present.
      const isWinner = points[teamIndex] === WIN_POINTS;
      for (const playerId of team.playerIds) {
        const standing = ensure(playerId);
        standing.matchesPlayed += 1;
        standing.points += points[teamIndex];
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
