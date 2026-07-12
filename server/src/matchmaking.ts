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

// A pair of player ids who sit next to each other physically (FR-18
// extension): for games where that matters, they shouldn't end up as
// opponents, since peeking at a neighbor's screen mid-match isn't fun for
// anyone.
export type SeatPair = [string, string];

interface TeamDraft {
  ids: string[];
  sum: number;
}

function teamOfEachPlayer(teams: TeamDraft[]): Map<string, number> {
  const map = new Map<string, number>();
  teams.forEach((t, i) => t.ids.forEach((id) => map.set(id, i)));
  return map;
}

export function countSeatConflicts(teamIdLists: string[][], avoidPairs: SeatPair[]): number {
  if (avoidPairs.length === 0) return 0;
  const teamOf = new Map<string, number>();
  teamIdLists.forEach((ids, i) => ids.forEach((id) => teamOf.set(id, i)));
  let conflicts = 0;
  for (const [a, b] of avoidPairs) {
    const teamA = teamOf.get(a);
    const teamB = teamOf.get(b);
    if (teamA !== undefined && teamB !== undefined && teamA !== teamB) conflicts++;
  }
  return conflicts;
}

// Which players ended up as opponents against a declared seat neighbor
// despite avoidAdjacentOpponents, and *who* that neighbor was — used to flag
// those specific players in the team display (with a tooltip naming the
// neighbor), not just show an aggregate count.
export function seatConflictNeighbors(teamIdLists: string[][], avoidPairs: SeatPair[]): Map<string, string[]> {
  const byPlayer = new Map<string, string[]>();
  if (avoidPairs.length === 0) return byPlayer;
  const teamOf = new Map<string, number>();
  teamIdLists.forEach((teamIds, i) => teamIds.forEach((id) => teamOf.set(id, i)));
  const addConflict = (id: string, opponentId: string) => {
    const list = byPlayer.get(id);
    if (list) list.push(opponentId);
    else byPlayer.set(id, [opponentId]);
  };
  for (const [a, b] of avoidPairs) {
    const teamA = teamOf.get(a);
    const teamB = teamOf.get(b);
    if (teamA !== undefined && teamB !== undefined && teamA !== teamB) {
      addConflict(a, b);
      addConflict(b, a);
    }
  }
  return byPlayer;
}

// How costly one unresolved seat conflict is allowed to be, in skill-sum
// imbalance points, before a swap that would fix it stops being worthwhile.
// Ratings run 1-10, so this comfortably covers fixing a conflict by trading
// two players a few points apart, but won't let a single seating preference
// blow up an otherwise well-balanced draw.
const CONFLICT_WEIGHT = 6;

function draftScore(teams: TeamDraft[], avoidPairs: SeatPair[]): number {
  const sums = teams.map((t) => t.sum);
  const imbalance = Math.max(...sums) - Math.min(...sums);
  const teamOf = teamOfEachPlayer(teams);
  let conflicts = 0;
  for (const [a, b] of avoidPairs) {
    const teamA = teamOf.get(a);
    const teamB = teamOf.get(b);
    if (teamA !== undefined && teamB !== undefined && teamA !== teamB) conflicts++;
  }
  return imbalance + CONFLICT_WEIGHT * conflicts;
}

// Best-effort local search (FR-18 extension): starting from the skill-
// balanced draft, repeatedly looks for the single best swap of two players
// on different teams that improves the combined score (skill imbalance +
// weighted seat conflicts), and applies it. Stops once no swap helps, or
// after a small sweep cap — the search space is tiny at LAN-party scale (a
// few teams of a handful of players each), so this converges in practice
// well before that cap matters. Mutates and returns `teams`.
function reduceSeatConflicts(
  teams: TeamDraft[],
  ratingById: Map<string, number>,
  avoidPairs: SeatPair[]
): TeamDraft[] {
  if (avoidPairs.length === 0 || teams.length < 2) return teams;

  const MAX_SWEEPS = 30;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    const currentScore = draftScore(teams, avoidPairs);
    let bestDelta = 0;
    let bestSwap: [number, number, number, number] | null = null;

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        for (let pi = 0; pi < teams[i].ids.length; pi++) {
          for (let pj = 0; pj < teams[j].ids.length; pj++) {
            const a = teams[i].ids[pi];
            const b = teams[j].ids[pj];
            const ratingA = ratingById.get(a) ?? 0;
            const ratingB = ratingById.get(b) ?? 0;

            teams[i].ids[pi] = b;
            teams[j].ids[pj] = a;
            teams[i].sum += ratingB - ratingA;
            teams[j].sum += ratingA - ratingB;

            const delta = currentScore - draftScore(teams, avoidPairs);

            teams[i].ids[pi] = a;
            teams[j].ids[pj] = b;
            teams[i].sum += ratingA - ratingB;
            teams[j].sum += ratingB - ratingA;

            if (delta > bestDelta + 1e-9) {
              bestDelta = delta;
              bestSwap = [i, pi, j, pj];
            }
          }
        }
      }
    }

    if (!bestSwap) break; // local optimum reached
    const [i, pi, j, pj] = bestSwap;
    const a = teams[i].ids[pi];
    const b = teams[j].ids[pj];
    const ratingA = ratingById.get(a) ?? 0;
    const ratingB = ratingById.get(b) ?? 0;
    teams[i].ids[pi] = b;
    teams[j].ids[pj] = a;
    teams[i].sum += ratingB - ratingA;
    teams[j].sum += ratingA - ratingB;
  }

  return teams;
}

// Greedily assigns each player (highest rating first) to the team with the
// lowest current skill sum, skipping teams already at the max allowed size so
// team sizes never differ by more than one player. Skill balance is always
// the primary goal; if `avoidPairs` is given (seat neighbors for a game
// where that matters), a second pass then tries to move them off opposing
// teams without meaningfully hurting that balance — best-effort, not
// guaranteed to resolve every pair (see countSeatConflicts on the result).
export function balanceTeams(
  players: PlayerRating[],
  teamCount: number,
  avoidPairs: SeatPair[] = []
): string[][] {
  if (teamCount < 1) throw new Error('teamCount must be at least 1');

  const maxPerTeam = Math.ceil(players.length / teamCount);
  const teams: TeamDraft[] = Array.from({ length: teamCount }, () => ({
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

  const ratingById = new Map(players.map((p) => [p.id, p.rating]));
  const relevantPairs = avoidPairs.filter(([a, b]) => ratingById.has(a) && ratingById.has(b));
  reduceSeatConflicts(teams, ratingById, relevantPairs);

  return teams.map((t) => t.ids);
}
