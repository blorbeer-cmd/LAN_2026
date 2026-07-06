// Pure matchmaking logic (FR-16..18), kept free of DB/HTTP so it's easy to
// unit-test. Goal: split a group of players into N teams with balanced total
// skill, handling uneven player counts and letting a re-roll shuffle ties.

export interface PlayerRating {
  id: string;
  rating: number;
}

const DEFAULT_TEAM_COUNT = 2;

// Derives how many teams to form when the caller doesn't specify one: default
// to 2 (most of our games are team-vs-team), but grow if the game's max team
// size can't fit everyone into just 2 teams.
export function computeTeamCount(
  explicitTeamCount: number | undefined,
  playerCount: number,
  maxTeamSize: number
): number {
  if (explicitTeamCount) return explicitTeamCount;
  const byMaxSize = Math.ceil(playerCount / Math.max(1, maxTeamSize));
  return Math.max(DEFAULT_TEAM_COUNT, byMaxSize);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Orders players by rating descending, but shuffles players who share the
// same rating. This keeps the greedy assignment balanced while still giving
// varied results on a re-roll (most players default to the same rating).
function orderForDraft(players: PlayerRating[]): PlayerRating[] {
  const byRating = new Map<number, PlayerRating[]>();
  for (const p of players) {
    const group = byRating.get(p.rating) ?? [];
    group.push(p);
    byRating.set(p.rating, group);
  }
  const ratingsDesc = [...byRating.keys()].sort((a, b) => b - a);
  return ratingsDesc.flatMap((r) => shuffle(byRating.get(r)!));
}

// Greedily assigns each player (highest rating first) to the team with the
// lowest current skill sum, skipping teams already at the max allowed size so
// team sizes never differ by more than one player.
export function balanceTeams(players: PlayerRating[], teamCount: number): string[][] {
  if (teamCount < 1) throw new Error('teamCount must be at least 1');

  const maxPerTeam = Math.ceil(players.length / teamCount);
  const teams: { ids: string[]; sum: number }[] = Array.from({ length: teamCount }, () => ({
    ids: [],
    sum: 0,
  }));

  for (const p of orderForDraft(players)) {
    let best = -1;
    for (let i = 0; i < teams.length; i++) {
      if (teams[i].ids.length >= maxPerTeam) continue;
      if (best === -1 || teams[i].sum < teams[best].sum) best = i;
    }
    teams[best].ids.push(p.id);
    teams[best].sum += p.rating;
  }

  return teams.map((t) => t.ids);
}
