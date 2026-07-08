// Pure tournament logic (FR-33), kept free of DB/HTTP so it's directly
// unit-testable — same split as matchmaking.ts. Covers three formats:
//   - single-elimination bracket ("Turnierbaum"), with byes for team counts
//     that aren't a power of two
//   - round-robin ("jeder gegen jeden"), single or double (Hin-/Rückspiele)
//   - group stage + knockout ("Gruppenphase + K.O."): the roster is split
//     into groups that each play round-robin, then the top N teams per
//     group feed into a single-elimination bracket (reusing generateBracket)
// A "team" here is just an opaque id — team formation itself (balancing by
// skill) is handled by matchmaking.ts and reused as-is.

export type TournamentFormat = 'single_elimination' | 'round_robin' | 'group_knockout';

// ---------- Single-elimination bracket ----------

export interface BracketMatchSlot {
  round: number; // 1-indexed; 1 = first round
  slot: number; // 0-indexed position within the round
  teamAId: string | null;
  teamBId: string | null;
  winnerTeamId: string | null;
  isBye: boolean;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard "balanced" bracket seeding: for a bracket of size n (a power of
// two), returns seed numbers (1-indexed) in bracket-slot order such that
// seed 1 and seed 2 can only meet in the final, seeds 1-4 can only meet from
// the semis on, etc. This is the same scheme sports brackets use; since our
// "seeds" are really just an arbitrary team order (no ranking data to seed
// by), the caller is expected to shuffle teamIds beforehand if randomness is
// wanted — this function only controls bracket *shape*, not team order.
function seedOrder(n: number): number[] {
  if (n === 1) return [1];
  const prev = seedOrder(n / 2);
  const result: number[] = [];
  for (const s of prev) result.push(s, n + 1 - s);
  return result;
}

function propagateWinner(matches: BracketMatchSlot[], round: number, slot: number, winnerTeamId: string): void {
  const nextMatch = matches.find((m) => m.round === round + 1 && m.slot === Math.floor(slot / 2));
  if (!nextMatch) return; // that was the final
  if (slot % 2 === 0) nextMatch.teamAId = winnerTeamId;
  else nextMatch.teamBId = winnerTeamId;
}

// Builds the full bracket shape up front (every round's match slots, later
// rounds starting empty) and resolves any byes immediately, propagating a
// bye's free winner into the next round exactly like a real result would.
export function generateBracket(teamIds: string[]): BracketMatchSlot[] {
  if (teamIds.length < 2) throw new Error('Ein Turnier braucht mindestens 2 Teams.');

  const bracketSize = nextPowerOfTwo(teamIds.length);
  const totalRounds = Math.log2(bracketSize);
  const order = seedOrder(bracketSize);
  const teamForSeed = (seed: number): string | null => (seed <= teamIds.length ? teamIds[seed - 1] : null);

  const matches: BracketMatchSlot[] = [];

  const round1Count = bracketSize / 2;
  for (let slot = 0; slot < round1Count; slot++) {
    const teamA = teamForSeed(order[slot * 2]);
    const teamB = teamForSeed(order[slot * 2 + 1]);
    const isBye = teamA === null || teamB === null;
    matches.push({
      round: 1,
      slot,
      teamAId: teamA,
      teamBId: teamB,
      winnerTeamId: isBye ? teamA ?? teamB : null,
      isBye,
    });
  }

  let matchesInRound = round1Count / 2;
  for (let round = 2; round <= totalRounds; round++) {
    for (let slot = 0; slot < matchesInRound; slot++) {
      matches.push({ round, slot, teamAId: null, teamBId: null, winnerTeamId: null, isBye: false });
    }
    matchesInRound /= 2;
  }

  for (const bye of matches.filter((m) => m.round === 1 && m.isBye)) {
    propagateWinner(matches, bye.round, bye.slot, bye.winnerTeamId!);
  }

  return matches;
}

// Records a winner for one bracket match and advances them into the next
// round's slot. Returns a new array (matches is not mutated) so callers can
// diff old vs. new to know what changed. Throws if the match can't be
// resolved yet (a previous round's winner hasn't advanced into it) or the
// given winner isn't actually one of the two teams in that match.
export function applyBracketResult(
  matches: BracketMatchSlot[],
  round: number,
  slot: number,
  winnerTeamId: string
): BracketMatchSlot[] {
  const next = matches.map((m) => ({ ...m }));
  const match = next.find((m) => m.round === round && m.slot === slot);
  if (!match) throw new Error('Match nicht gefunden.');
  if (match.isBye) throw new Error('Freilos braucht kein Ergebnis.');
  if (match.teamAId === null || match.teamBId === null) {
    throw new Error('Beide Teams müssen feststehen, bevor ein Ergebnis eingetragen werden kann.');
  }
  if (winnerTeamId !== match.teamAId && winnerTeamId !== match.teamBId) {
    throw new Error('winnerTeamId ist in diesem Match nicht vertreten.');
  }
  match.winnerTeamId = winnerTeamId;
  propagateWinner(next, round, slot, winnerTeamId);
  return next;
}

export function bracketIsComplete(matches: BracketMatchSlot[]): boolean {
  const finalRound = Math.max(...matches.map((m) => m.round));
  const final = matches.find((m) => m.round === finalRound);
  return Boolean(final && final.winnerTeamId);
}

// ---------- Round-robin ----------

export interface RoundRobinFixture {
  round: number;
  teamAId: string;
  teamBId: string;
}

// Classic "circle method": team[0] stays fixed, everyone else rotates one
// seat each round. An odd team count gets a phantom bye slot that's simply
// dropped from the output — that team has no fixture that round.
function circleMethodSingleLeg(teamIds: string[]): RoundRobinFixture[] {
  const ids: Array<string | null> = [...teamIds];
  if (ids.length % 2 !== 0) ids.push(null);
  const n = ids.length;
  const roundsCount = n - 1;

  const fixtures: RoundRobinFixture[] = [];
  const arr = [...ids];
  for (let r = 0; r < roundsCount; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== null && b !== null) fixtures.push({ round: r + 1, teamAId: a, teamBId: b });
    }
    arr.splice(1, 0, arr.pop()!);
  }
  return fixtures;
}

// twoLegged=true doubles the schedule (Hin- und Rückspiel): every pair plays
// a second time in the second half of the schedule with sides swapped,
// mirroring how a real home-and-away league works.
export function generateRoundRobin(teamIds: string[], twoLegged: boolean): RoundRobinFixture[] {
  if (teamIds.length < 2) throw new Error('Ein Turnier braucht mindestens 2 Teams.');
  const firstLeg = circleMethodSingleLeg(teamIds);
  if (!twoLegged) return firstLeg;

  const roundsInFirstLeg = Math.max(...firstLeg.map((f) => f.round));
  const secondLeg = firstLeg.map((f) => ({
    round: f.round + roundsInFirstLeg,
    teamAId: f.teamBId,
    teamBId: f.teamAId,
  }));
  return [...firstLeg, ...secondLeg];
}

export const ROUND_ROBIN_WIN_POINTS = 3;
export const ROUND_ROBIN_DRAW_POINTS = 1;

export interface TeamStanding {
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
}

export interface DecidedFixtureResult {
  teamAId: string;
  teamBId: string;
  winnerTeamId: string | null; // null = draw
}

export function computeRoundRobinStandings(
  teamIds: string[],
  results: DecidedFixtureResult[]
): TeamStanding[] {
  const byTeam = new Map<string, TeamStanding>();
  for (const id of teamIds) {
    byTeam.set(id, { teamId: id, played: 0, wins: 0, draws: 0, losses: 0, points: 0 });
  }

  for (const r of results) {
    const a = byTeam.get(r.teamAId);
    const b = byTeam.get(r.teamBId);
    if (!a || !b) continue; // ignore results for teams outside this set
    a.played += 1;
    b.played += 1;
    if (r.winnerTeamId === null) {
      a.draws += 1;
      b.draws += 1;
      a.points += ROUND_ROBIN_DRAW_POINTS;
      b.points += ROUND_ROBIN_DRAW_POINTS;
    } else if (r.winnerTeamId === r.teamAId) {
      a.wins += 1;
      b.losses += 1;
      a.points += ROUND_ROBIN_WIN_POINTS;
    } else {
      b.wins += 1;
      a.losses += 1;
      b.points += ROUND_ROBIN_WIN_POINTS;
    }
  }

  return [...byTeam.values()].sort((x, y) => y.points - x.points || y.wins - x.wins);
}

// ---------- Group stage + knockout ----------

// Deals teams into groupCount groups as evenly as possible (round-robin
// dealing, so group sizes never differ by more than one). Caller decides
// team order beforehand (e.g. shuffled) — this only controls the split.
export function assignGroups(teamIds: string[], groupCount: number): string[][] {
  if (groupCount < 2) throw new Error('Es müssen mindestens 2 Gruppen sein.');
  if (teamIds.length < groupCount * 2) {
    throw new Error('Jede Gruppe braucht mindestens 2 Teams.');
  }
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  teamIds.forEach((id, i) => groups[i % groupCount].push(id));
  return groups;
}

// Picks the top `advancersPerGroup` teams from each group's standings and
// interleaves them into a single seed order for generateBracket: all group
// winners first (strongest first), then all runners-up, and so on — so
// generateBracket's balanced seeding naturally keeps group-mates apart for
// as long as possible instead of an immediate rematch.
export function selectAdvancers(standingsByGroup: TeamStanding[][], advancersPerGroup: number): string[] {
  const seeded: string[] = [];
  for (let rank = 0; rank < advancersPerGroup; rank++) {
    const atThisRank = standingsByGroup
      .map((standings) => standings[rank])
      .filter((s): s is TeamStanding => Boolean(s))
      .sort((x, y) => y.points - x.points || y.wins - x.wins);
    seeded.push(...atThisRank.map((s) => s.teamId));
  }
  return seeded;
}
