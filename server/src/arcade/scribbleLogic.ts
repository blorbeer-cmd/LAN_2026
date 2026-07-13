// Pure, unit-testable rules for the Scribble (skribbl.io-style) arcade game.
// No DB/socket access here on purpose — see scribble.ts for the stateful part.

import { normalizeAnswer } from './quizLogic';

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Prefers word ids nobody in the match has seen yet, falling back to already-seen
// ones only if there aren't enough fresh words to fill the choice count.
export function pickWordChoices(
  ids: string[],
  seenIds: Set<string>,
  count: number,
  rng: () => number = Math.random
): string[] {
  if (ids.length === 0 || count <= 0) return [];
  const fresh = shuffle(ids.filter((id) => !seenIds.has(id)), rng);
  const seen = shuffle(ids.filter((id) => seenIds.has(id)), rng);
  return [...fresh, ...seen].slice(0, Math.min(count, ids.length));
}

const LETTER_PATTERN = /[a-zA-ZäöüÄÖÜßé]/;

export function isLetter(ch: string): boolean {
  return LETTER_PATTERN.test(ch);
}

// Masked display of the current word: revealed letters show through, everything
// else (still-hidden letters) becomes an underscore. Spaces/hyphens always show.
export function wordMask(word: string, revealedIndices: ReadonlySet<number>): string {
  return word
    .split('')
    .map((ch, i) => (isLetter(ch) ? (revealedIndices.has(i) ? ch : '_') : ch))
    .join(' ');
}

// How many letters get auto-revealed as hints over the course of a turn: none
// for very short words, one for medium ones, two for anything longer.
export function hintCount(letterCount: number): number {
  if (letterCount <= 3) return 0;
  if (letterCount <= 5) return 1;
  return 2;
}

export interface HintStep {
  atMs: number;
  index: number;
}

// Precomputes when (relative to turn start) which letter index gets revealed.
// Picking the indices up front (rather than live) keeps this deterministic and
// testable, and lets the server schedule plain setTimeouts from the result.
export function buildHintSchedule(word: string, turnDurationMs: number, rng: () => number = Math.random): HintStep[] {
  const letterIndices: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (isLetter(word[i])) letterIndices.push(i);
  }
  const count = hintCount(letterIndices.length);
  if (count === 0) return [];
  const chosen = shuffle(letterIndices, rng).slice(0, count);
  const timings = count === 1 ? [0.5] : [0.5, 0.75];
  return chosen.map((index, i) => ({ atMs: Math.round(turnDurationMs * timings[i]), index }));
}

// Guesser reward: the faster the correct guess, the more points, down to a
// guaranteed minimum so a last-second correct guess is never worth nothing.
export function pointsForGuess(remainingMs: number, turnDurationMs: number): number {
  if (turnDurationMs <= 0) return 1;
  const ratio = Math.max(0, Math.min(1, remainingMs / turnDurationMs));
  return Math.max(1, Math.ceil(300 * ratio));
}

// Drawer reward: proportional to how many of the eligible guessers got it.
export function pointsForDrawer(correctGuessers: number, eligibleGuessers: number): number {
  if (eligibleGuessers <= 0) return 0;
  return Math.round((100 * correctGuessers) / eligibleGuessers);
}

// Finds the next index in `order` (wrapping around) whose player id is still
// online, starting the search right after `fromIndex`. Returns null if nobody
// in `order` is online (match should end in that case).
export function nextDrawerIndex(order: string[], fromIndex: number, onlineIds: ReadonlySet<string>): number | null {
  if (order.length === 0) return null;
  for (let step = 1; step <= order.length; step++) {
    const index = (fromIndex + step) % order.length;
    if (onlineIds.has(order[index])) return index;
  }
  return null;
}

export function isMatchComplete(turnsPlayed: number, rounds: number, playerCount: number): boolean {
  if (playerCount <= 0) return true;
  return turnsPlayed >= rounds * playerCount;
}

export interface RatedDrawing {
  id: string;
  favoriteVotes: number;
  reactionCount: number;
}

// Favorites decide the round. Reactions are the transparent fallback when a
// round times out without a favorite vote; exact ties deliberately produce
// shared winners instead of inventing a hidden tiebreaker.
export function selectRoundWinnerIds(drawings: RatedDrawing[]): string[] {
  if (drawings.length === 0) return [];
  const highestFavorites = Math.max(...drawings.map((drawing) => drawing.favoriteVotes));
  const candidates = highestFavorites > 0
    ? drawings.filter((drawing) => drawing.favoriteVotes === highestFavorites)
    : drawings;
  const highestReactions = Math.max(...candidates.map((drawing) => drawing.reactionCount));
  return candidates
    .filter((drawing) => drawing.reactionCount === highestReactions)
    .map((drawing) => drawing.id);
}

// Classic edit distance (insert/delete/substitute), single-row DP to avoid
// allocating a full m*n matrix for what's only ever called on short words.
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

// "Knapp dran" feedback: a wrong guess just one typo away from the word,
// after the same case/diacritic/punctuation normalization guesses are
// matched against — shown only to the guesser themself (see scribble.ts),
// never broadcast, so it can't spoil the word for anyone else.
export function isCloseGuess(guess: string, word: string, maxDistance = 1): boolean {
  const a = normalizeAnswer(guess);
  const b = normalizeAnswer(word);
  if (!a || !b || a === b) return false;
  return levenshteinDistance(a, b) <= maxDistance;
}
