// Pure tournament logic (FR-33), kept free of DB/HTTP so it's directly
// unit-testable — same split as matchmaking.ts. Covers three formats:
//   - single-elimination bracket ("Turnierbaum"), with byes for team counts
//     that aren't a power of two and optional placement brackets that play
//     out every place (third-place match and so on)
//   - round-robin ("jeder gegen jeden"), single or double (Hin-/Rückspiele)
//   - group stage + knockout ("Gruppenphase + K.O."): the roster is split
//     into groups that each play round-robin, then the top N teams per
//     group feed into a single-elimination bracket (reusing generateBracket)
// A "team" here is just an opaque id — team formation itself (balancing by
// skill) is handled by matchmaking.ts and reused as-is.

export type TournamentFormat = 'single_elimination' | 'round_robin' | 'group_knockout';

export interface TournamentLobbyMatchPosition {
  round: number;
  slot: number;
  stage: 'group' | 'knockout' | null;
  groupIndex: number | null;
  placeFrom?: number | null;
}

// A tournament stores one short base name, while every playable pairing
// needs its own actual in-game lobby when several matches run in parallel.
// The phase/round/slot suffix is deterministic, so clients and push messages
// always agree without another mutable assignment table.
export function deriveTournamentLobbyName(
  baseName: string | null,
  format: TournamentFormat,
  match: TournamentLobbyMatchPosition
): string | null {
  const trimmedBase = baseName?.trim();
  if (!trimmedBase) return null;

  const phase =
    format === 'round_robin'
      ? 'L'
      : format === 'group_knockout' && match.stage === 'group'
        ? `G${(match.groupIndex ?? 0) + 1}`
        : (match.placeFrom ?? 1) > 1
          ? `P${match.placeFrom}`
          : 'KO';
  const suffix = `${phase}-R${match.round}-M${match.slot + 1}`;
  const maxBaseLength = Math.max(1, 60 - suffix.length - 1);
  const boundedBase = trimmedBase.slice(0, maxBaseLength).replace(/-+$/, '') || 'Lobby';
  return `${boundedBase}-${suffix}`;
}

// ---------- Single-elimination bracket ----------

export interface BracketMatchSlot {
  round: number; // 1-indexed; 1 = first round
  slot: number; // 0-indexed position within the round of its (sub-)bracket
  teamAId: string | null;
  teamBId: string | null;
  winnerTeamId: string | null;
  isBye: boolean;
  // Best place the (sub-)bracket of this match plays for, counted over the
  // padded bracket size: 1 (or absent) is the main bracket. Higher values
  // only exist when all places are played out — the losers of every round
  // then continue in their own placement bracket (3 = the third-place match
  // of a four-team bracket, 5 = places 5-8 of an eight-team bracket, ...).
  placeFrom?: number;
}

export const bracketPlaceFrom = (match: { placeFrom?: number | null }): number => match.placeFrom ?? 1;

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
// by), tournament creation shuffles teamIds beforehand; the group-stage
// knockout instead passes a deliberate order (see selectAdvancers). This
// function only controls bracket *shape*, not team order.
function seedOrder(n: number): number[] {
  if (n === 1) return [1];
  const prev = seedOrder(n / 2);
  const result: number[] = [];
  for (const s of prev) result.push(s, n + 1 - s);
  return result;
}

interface BracketTarget {
  round: number;
  slot: number;
  placeFrom: number;
  side: 'A' | 'B';
}

// Where a match's winner and — when all places are played out — its loser
// move next. Both keep their half of the slot: the winner stays in the same
// (sub-)bracket, the loser drops into the placement bracket directly below,
// which starts at the first place the winners' half can no longer reach.
function bracketTargets(
  match: BracketMatchSlot,
  totalRounds: number,
  allPlaces: boolean
): { winner: BracketTarget | null; loser: BracketTarget | null } {
  if (match.round >= totalRounds) return { winner: null, loser: null };
  const next = { round: match.round + 1, slot: Math.floor(match.slot / 2), side: match.slot % 2 === 0 ? 'A' : 'B' } as const;
  const teamsGoingOn = 2 ** (totalRounds - match.round);
  return {
    winner: { ...next, placeFrom: bracketPlaceFrom(match) },
    loser: allPlaces ? { ...next, placeFrom: bracketPlaceFrom(match) + teamsGoingOn } : null,
  };
}

const bracketKey = (round: number, placeFrom: number, slot: number): string => `${round}:${placeFrom}:${slot}`;

function findBracketMatch(matches: BracketMatchSlot[], target: { round: number; slot: number; placeFrom: number }) {
  return matches.find(
    (m) => m.round === target.round && m.slot === target.slot && bracketPlaceFrom(m) === target.placeFrom
  );
}

function placeTeam(matches: BracketMatchSlot[], target: BracketTarget | null, teamId: string | null): void {
  if (!target) return;
  const match = findBracketMatch(matches, target);
  if (!match) return;
  if (target.side === 'A') match.teamAId = teamId;
  else match.teamBId = teamId;
}

// A bye knows its only real team once it arrives; that team advances at once,
// exactly as if it had won. Targets always lie in a later round, so a single
// pass in round order resolves chains of byes, too.
function settleByes(matches: BracketMatchSlot[], totalRounds: number, allPlaces: boolean): void {
  for (const match of [...matches].sort((a, b) => a.round - b.round)) {
    if (!match.isBye || match.winnerTeamId !== null) continue;
    const teamId = match.teamAId ?? match.teamBId;
    if (!teamId) continue;
    match.winnerTeamId = teamId;
    placeTeam(matches, bracketTargets(match, totalRounds, allPlaces).winner, teamId);
  }
}

function bracketShape(matches: BracketMatchSlot[]): { totalRounds: number; allPlaces: boolean } {
  return {
    totalRounds: Math.max(...matches.map((m) => m.round)),
    allPlaces: matches.some((m) => bracketPlaceFrom(m) > 1),
  };
}

// The full bracket shape before any team is known, plus how many sides of
// every match are empty. A missing team (padding up to the power of two)
// loses against any real team, so where it goes never depends on a result:
// it is walked through the tree once, and every match it reaches is a bye.
function bracketLayout(teamCount: number, allPlaces: boolean) {
  const bracketSize = nextPowerOfTwo(teamCount);
  const totalRounds = Math.log2(bracketSize);
  const matches: BracketMatchSlot[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const groupSize = 2 ** (totalRounds - round + 1);
    const groupCount = allPlaces ? bracketSize / groupSize : 1;
    for (let group = 0; group < groupCount; group++) {
      for (let slot = 0; slot < groupSize / 2; slot++) {
        matches.push({ round, slot, placeFrom: 1 + group * groupSize, teamAId: null, teamBId: null, winnerTeamId: null, isBye: false });
      }
    }
  }

  const order = seedOrder(bracketSize);
  const emptySides = new Map<string, number>();
  matches
    .filter((m) => m.round === 1)
    .forEach((m) => emptySides.set(bracketKey(1, 1, m.slot), Number(order[m.slot * 2] > teamCount) + Number(order[m.slot * 2 + 1] > teamCount)));
  const addEmptySide = (target: BracketTarget | null) => {
    if (!target) return;
    const key = bracketKey(target.round, target.placeFrom, target.slot);
    emptySides.set(key, (emptySides.get(key) ?? 0) + 1);
  };
  for (const match of matches) {
    const empty = emptySides.get(bracketKey(match.round, bracketPlaceFrom(match), match.slot)) ?? 0;
    if (empty === 0) continue;
    match.isBye = true;
    const { winner, loser } = bracketTargets(match, totalRounds, allPlaces);
    addEmptySide(loser);
    if (empty === 2) addEmptySide(winner);
  }

  // Bracket places (over the padded size) that end up with a missing team:
  // the loser side of a final-round bye, or both sides of an empty one.
  const emptyPlaces: number[] = [];
  for (const match of matches.filter((m) => m.round === totalRounds)) {
    const empty = emptySides.get(bracketKey(match.round, bracketPlaceFrom(match), match.slot)) ?? 0;
    if (empty === 2) emptyPlaces.push(bracketPlaceFrom(match));
    if (empty >= 1) emptyPlaces.push(bracketPlaceFrom(match) + 1);
  }
  return { matches, order, totalRounds, emptyPlaces };
}

// Builds the full bracket shape up front (every round's match slots, later
// rounds starting empty) and resolves any byes immediately, propagating a
// bye's free winner into the next round exactly like a real result would.
// allPlaces adds a placement bracket below every round for its losers, so
// every team ends with a distinct place (third-place match and so on).
export function generateBracket(teamIds: string[], allPlaces = false): BracketMatchSlot[] {
  if (teamIds.length < 2) throw new Error('Ein Turnier braucht mindestens 2 Teams.');

  const { matches, order, totalRounds } = bracketLayout(teamIds.length, allPlaces);
  const teamForSeed = (seed: number): string | null => (seed <= teamIds.length ? teamIds[seed - 1] : null);
  for (const match of matches.filter((m) => m.round === 1)) {
    match.teamAId = teamForSeed(order[match.slot * 2]);
    match.teamBId = teamForSeed(order[match.slot * 2 + 1]);
  }
  settleByes(matches, totalRounds, allPlaces);
  return matches;
}

// Records a winner for one bracket match and moves the winner — and, with
// all places played out, the loser — on. Returns a new array (matches is not
// mutated) so callers can diff old vs. new to know what changed. Throws if
// the match can't be resolved yet (a previous round's winner hasn't advanced
// into it) or the given winner isn't actually one of the two teams in it.
export function applyBracketResult(
  matches: BracketMatchSlot[],
  round: number,
  slot: number,
  winnerTeamId: string,
  placeFrom = 1
): BracketMatchSlot[] {
  const next = matches.map((m) => ({ ...m }));
  const match = findBracketMatch(next, { round, slot, placeFrom });
  if (!match) throw new Error('Match nicht gefunden.');
  if (match.isBye) throw new Error('Freilos braucht kein Ergebnis.');
  if (match.teamAId === null || match.teamBId === null) {
    throw new Error('Beide Teams müssen feststehen, bevor ein Ergebnis eingetragen werden kann.');
  }
  if (winnerTeamId !== match.teamAId && winnerTeamId !== match.teamBId) {
    throw new Error('winnerTeamId ist in diesem Match nicht vertreten.');
  }
  const { totalRounds, allPlaces } = bracketShape(next);
  match.winnerTeamId = winnerTeamId;
  const loserTeamId = winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
  const targets = bracketTargets(match, totalRounds, allPlaces);
  placeTeam(next, targets.winner, winnerTeamId);
  placeTeam(next, targets.loser, loserTeamId);
  settleByes(next, totalRounds, allPlaces);
  return next;
}

// Every match that is played for real has a winner. Byes resolve themselves,
// and an empty bye only ever sits below teams that are all decided already.
export function bracketIsComplete(matches: BracketMatchSlot[]): boolean {
  return matches.every((m) => m.isBye || m.winnerTeamId !== null);
}

// The positions a bracket match's winner and loser move to, for callers that
// clear a changed result's consequences in stored rows.
export function bracketMatchTargets(matches: BracketMatchSlot[], match: BracketMatchSlot) {
  const { totalRounds, allPlaces } = bracketShape(matches);
  return bracketTargets(match, totalRounds, allPlaces);
}

// Places are counted over real teams only: a place a missing team would
// hold is skipped, so byes never leave a gap in the final ranking.
function realPlaceCounter(matches: BracketMatchSlot[]) {
  const { allPlaces } = bracketShape(matches);
  const teamCount = matches
    .filter((m) => m.round === 1 && bracketPlaceFrom(m) === 1)
    .reduce((count, m) => count + Number(m.teamAId !== null) + Number(m.teamBId !== null), 0);
  const emptyPlaces = allPlaces && teamCount >= 2 ? bracketLayout(teamCount, true).emptyPlaces : [];
  return {
    // Real place of the first team at this bracket place.
    firstAt: (place: number) => place - emptyPlaces.filter((p) => p < place).length,
    // Real place of the last team at or above this bracket place.
    lastAt: (place: number) => place - emptyPlaces.filter((p) => p <= place).length,
  };
}

// The real places a match's (sub-)bracket decides, e.g. { from: 3, to: 4 }
// for a third-place match or { from: 5, to: 8 } for the first round of
// places 5-8. from > to never happens for a match with two real teams.
export function bracketPlaceRange(matches: BracketMatchSlot[], match: BracketMatchSlot): { from: number; to: number } {
  const { totalRounds } = bracketShape(matches);
  const counter = realPlaceCounter(matches);
  const top = bracketPlaceFrom(match);
  const groupSize = 2 ** (totalRounds - match.round + 1);
  return { from: counter.firstAt(top), to: counter.lastAt(top + groupSize - 1) };
}

export interface BracketPlacement {
  teamId: string;
  place: number;
}

// Final places a bracket has decided so far. With all places played out,
// every team ends in one final-round match: its winner takes that
// sub-bracket's top place, its loser the next one. Otherwise only the final
// decides distinct places (1 and 2); earlier knockout exits share theirs.
export function computeBracketPlacements(matches: BracketMatchSlot[]): BracketPlacement[] {
  const { totalRounds, allPlaces } = bracketShape(matches);
  const counter = realPlaceCounter(matches);
  const placements: BracketPlacement[] = [];
  for (const match of matches) {
    if (match.round !== totalRounds || match.winnerTeamId === null) continue;
    if (!allPlaces && bracketPlaceFrom(match) !== 1) continue;
    const top = bracketPlaceFrom(match);
    placements.push({ teamId: match.winnerTeamId, place: counter.firstAt(top) });
    const loserTeamId = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
    if (loserTeamId) placements.push({ teamId: loserTeamId, place: counter.firstAt(top + 1) });
  }
  return placements.sort((a, b) => a.place - b.place);
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
// dealing, so group sizes never differ by more than one). Tournament creation
// shuffles the team order beforehand — this only controls the split.
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
