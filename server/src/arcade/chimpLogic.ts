import { seededRandom, shuffled } from './challengeRushLogic';

// Pure rules of the Chimp Test (docs/CHIMP-TEST-ARCADE-KONZEPT.md). The socket
// module owns time and connections; everything here is deterministic so the
// scoring, the frozen ranking values and the reveal can be tested directly.

export const CHIMP_GRID_CELLS = 40;
export const CHIMP_START_LEVEL = 4;
export const CHIMP_MAX_LEVEL = CHIMP_GRID_CELLS;
export const CHIMP_MAX_STRIKES = 3;
// The original Kyoto study used the numerals 1–9, so 9 numbers is "100 % Ayumu".
export const CHIMP_AYUMU_LEVEL = 9;

export type ChimpPhase = 'memorize' | 'input' | 'reveal' | 'interstitial' | 'out';
export type ChimpOutcome = 'success' | 'strike';

export interface ChimpReveal {
  // layout[i] is the cell of the number i + 1.
  layout: number[];
  wrongCell: number | null;
  expectedNumber: number;
}

export interface ChimpRun {
  level: number;
  attempt: number;
  layout: number[];
  clicked: number;
  phase: ChimpPhase;
  strikes: number;
  bestLevel: number;
  // Frozen when bestLevel was completed; later failed attempts never touch them.
  strikesAtLevel: number;
  activeMsAtLevel: number;
  totalActiveMs: number;
  lastOutcome: ChimpOutcome | null;
  reveal: ChimpReveal | null;
}

export type ChimpClickResult = 'invalid' | 'ignored' | 'correct' | 'level-complete' | 'strike';

export function chimpAttemptSeed(matchSeed: number, playerId: string, level: number, attempt: number): number {
  let hash = (matchSeed ^ Math.imul(level + 1, 0x45d9f3b) ^ Math.imul(attempt + 1, 0x27d4eb2d)) >>> 0;
  for (let index = 0; index < playerId.length; index += 1) hash = Math.imul(hash ^ playerId.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

export function createChimpLayout(seed: number, count: number): number[] {
  const cells = Array.from({ length: CHIMP_GRID_CELLS }, (_, index) => index);
  return shuffled(cells, seededRandom(seed)).slice(0, Math.max(0, Math.min(CHIMP_GRID_CELLS, count)));
}

function layoutFor(matchSeed: number, playerId: string, level: number, attempt: number): number[] {
  return createChimpLayout(chimpAttemptSeed(matchSeed, playerId, level, attempt), level);
}

export function startChimpRun(matchSeed: number, playerId: string): ChimpRun {
  return {
    level: CHIMP_START_LEVEL,
    attempt: 0,
    layout: layoutFor(matchSeed, playerId, CHIMP_START_LEVEL, 0),
    clicked: 0,
    phase: 'memorize',
    strikes: 0,
    bestLevel: 0,
    strikesAtLevel: 0,
    activeMsAtLevel: 0,
    totalActiveMs: 0,
    lastOutcome: null,
    reveal: null,
  };
}

function strike(run: ChimpRun, wrongCell: number | null, attemptMs: number): void {
  run.strikes += 1;
  run.totalActiveMs += Math.max(0, attemptMs);
  run.lastOutcome = 'strike';
  run.reveal = { layout: [...run.layout], wrongCell, expectedNumber: run.clicked + 1 };
  run.phase = 'reveal';
}

// attemptMs is the active time of the current attempt up to this click; it is
// only booked when the attempt ends.
export function applyChimpClick(run: ChimpRun, cell: unknown, attemptMs: number): ChimpClickResult {
  if (!Number.isInteger(cell) || (cell as number) < 0 || (cell as number) >= CHIMP_GRID_CELLS) return 'invalid';
  if (run.phase !== 'memorize' && run.phase !== 'input') return 'ignored';
  const index = run.layout.indexOf(cell as number);
  // Empty cells and already cleared numbers are not mistakes: a near-miss tap
  // next to a tile on a phone must not cost a strike.
  if (index < 0 || index < run.clicked) return 'ignored';
  if (index !== run.clicked) {
    strike(run, cell as number, attemptMs);
    return 'strike';
  }
  run.clicked += 1;
  run.phase = 'input';
  if (run.clicked < run.level) return 'correct';
  run.totalActiveMs += Math.max(0, attemptMs);
  run.bestLevel = run.level;
  run.strikesAtLevel = run.strikes;
  run.activeMsAtLevel = run.totalActiveMs;
  run.lastOutcome = 'success';
  run.reveal = null;
  run.phase = run.level >= CHIMP_MAX_LEVEL ? 'out' : 'interstitial';
  return 'level-complete';
}

// Inactivity only applies to the input phase; the memorize phase has no limit
// besides the match time limit.
export function applyChimpInactivity(run: ChimpRun, attemptMs: number): boolean {
  if (run.phase !== 'input') return false;
  strike(run, null, attemptMs);
  return true;
}

export function finishChimpReveal(run: ChimpRun): void {
  if (run.phase !== 'reveal') return;
  run.reveal = null;
  run.phase = run.strikes >= CHIMP_MAX_STRIKES ? 'out' : 'interstitial';
}

export function continueChimpRun(run: ChimpRun, matchSeed: number, playerId: string): boolean {
  if (run.phase !== 'interstitial') return false;
  if (run.lastOutcome === 'success') {
    run.level += 1;
    run.attempt = 0;
  } else {
    run.attempt += 1;
  }
  run.layout = layoutFor(matchSeed, playerId, run.level, run.attempt);
  run.clicked = 0;
  run.phase = 'memorize';
  return true;
}

// Clearing a level of `level` numbers faster than this from the first to the
// last click is not human; such a run is stored as invalid and never ranked.
const MIN_HUMAN_MS_PER_CLICK = 40;
const PLAUSIBILITY_MIN_LEVEL = 8;

export function isImplausibleChimpInput(level: number, firstToLastClickMs: number): boolean {
  return level >= PLAUSIBILITY_MIN_LEVEL && firstToLastClickMs < (level - 1) * MIN_HUMAN_MS_PER_CLICK;
}

export interface ChimpRating {
  // Share of Ayumu's 9 numbers, capped at 100; null once Ayumu is surpassed.
  percent: number | null;
  beyond: number;
  tier: string;
}

export function chimpRating(level: number): ChimpRating {
  const safe = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
  const beyond = Math.max(0, safe - CHIMP_AYUMU_LEVEL);
  const tier = safe >= 15 ? 'Affenkönig'
    : safe >= 10 ? 'Silberrücken'
      : safe === 9 ? 'Ayumu-Niveau'
        : safe === 8 ? 'Fast Ayumu'
          : safe >= 6 ? 'Kletteraffe'
            : safe >= 4 ? 'Zoobesucher'
              : 'Bananenschale';
  return { percent: beyond > 0 ? null : Math.min(100, Math.round((safe / CHIMP_AYUMU_LEVEL) * 100)), beyond, tier };
}

export interface ChimpRankable {
  level: number;
  strikesAtLevel: number;
  activeMsAtLevel: number;
  achievedAt?: number;
}

export function compareChimpResults(a: ChimpRankable, b: ChimpRankable): number {
  return b.level - a.level || a.strikesAtLevel - b.strikesAtLevel || a.activeMsAtLevel - b.activeMsAtLevel;
}

// Round ranking: equal level, strikes and active time share a place. The
// leaderboard additionally breaks such ties by who reached the value first.
export function rankChimpResults<T extends ChimpRankable>(entries: T[], { byAchievedAt = false } = {}): Array<T & { place: number }> {
  const compare = (a: T, b: T) => compareChimpResults(a, b) || (byAchievedAt ? (a.achievedAt ?? 0) - (b.achievedAt ?? 0) : 0);
  const sorted = [...entries].sort(compare);
  const ranked: Array<T & { place: number }> = [];
  sorted.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const place = previous && compare(sorted[index - 1], entry) === 0 ? previous.place : index + 1;
    ranked.push({ ...entry, place });
  });
  return ranked;
}
