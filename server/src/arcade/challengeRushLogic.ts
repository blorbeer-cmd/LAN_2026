import { createHash } from 'node:crypto';

export type ChallengeKey =
  | 'reaction-circle' | 'cps' | 'number-salad' | 'timing-10'
  | 'aim-trainer' | 'memory-sequence' | 'odd-one-out' | 'whack-a-mole' | 'traffic-light' | 'color-word';

export interface ChallengeDefinition { key: ChallengeKey; title: string; description: string; durationMs: number }
export const CHALLENGES: ChallengeDefinition[] = [
  { key: 'reaction-circle', title: 'Klick den Kreis', description: 'Klicke den Kreis so schnell wie möglich.', durationMs: 8_000 },
  { key: 'cps', title: 'CPS-Test', description: 'Klicke fünf Sekunden lang so oft du kannst.', durationMs: 5_000 },
  { key: 'number-salad', title: 'Zahlensalat', description: 'Klicke die Zahlen in aufsteigender Reihenfolge.', durationMs: 12_000 },
  { key: 'timing-10', title: 'Stoppe bei 10 Sekunden', description: 'Stoppe den unsichtbaren Timer möglichst genau bei 10,00 Sekunden.', durationMs: 15_000 },
  { key: 'aim-trainer', title: 'Aim Trainer', description: 'Triff alle Ziele so schnell wie möglich.', durationMs: 10_000 },
  { key: 'memory-sequence', title: 'Merk dir die Reihenfolge', description: 'Merke dir die aufleuchtenden Felder und wiederhole sie.', durationMs: 15_000 },
  { key: 'odd-one-out', title: 'Finde den Unterschied', description: 'Finde das eine abweichende Feld im Raster.', durationMs: 10_000 },
  { key: 'whack-a-mole', title: 'Whack-a-Mole', description: 'Klicke die aufleuchtenden Löcher in der richtigen Reihenfolge.', durationMs: 12_000 },
  { key: 'traffic-light', title: 'Ampel-Reaktion', description: 'Klicke erst, wenn die Ampel auf Grün springt. Zu früh zählt als Fehlstart.', durationMs: 10_000 },
  { key: 'color-word', title: 'Farbwort-Chaos', description: 'Wähle die Schriftfarbe, nicht das geschriebene Wort.', durationMs: 12_000 },
];

export interface ChallengePayload { key: ChallengeKey; title: string; description: string; durationMs: number; seed: number; data: Record<string, unknown> }

export interface BotChallengeStep {
  atMs: number;
  action: string;
  value?: number | string | { x: number; y: number };
}

export interface BotChallengePlanOptions {
  memoryRevealMs?: number;
}

// A plain linear congruential generator is invertible: revealing any single
// output (e.g. the first Aim Trainer target, which the player has to see to
// play) lets an attacker solve for the generator's internal state and
// reconstruct every later output — including, since challenge seeds are
// derived from the match seed, every remaining challenge in the match.
// Hashing (seed, counter) through SHA-256 for every call has no such
// algebraic shortcut: recovering the seed from a digest is a preimage
// attack, not solvable arithmetic, so this stays safe even once a value
// has to be revealed for gameplay.
export function seededRandom(seed: number): () => number {
  let counter = 0;
  return () => {
    counter += 1;
    const digest = createHash('sha256').update(`${seed}:${counter}`).digest();
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
}

export function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [result[index], result[swap]] = [result[swap], result[index]]; }
  return result;
}

function randomSequence(random: () => number, length: number, max: number): number[] {
  const sequence: number[] = [];
  for (let index = 0; index < length; index += 1) {
    let next = Math.floor(random() * max);
    if (sequence.length > 0 && next === sequence[sequence.length - 1]) next = (next + 1) % max;
    sequence.push(next);
  }
  return sequence;
}

export const AIM_TRAINER_TARGET_COUNT = 6;
export const MEMORY_SEQUENCE_TILE_COUNT = 9;
export const MEMORY_SEQUENCE_LENGTH = 5;
// Matches the client's reveal animation step (server/public/js/views/challengeRush.js,
// MEMORY_REVEAL_STEP_MS) — the two aren't otherwise linked since public/ has no build
// step to share a constant with src/. The full sequence is sent up front so the client
// can render the reveal, so the server must independently withhold real input
// acceptance until that reveal is actually over; without this, a scripted client could
// answer instantly and always score 100.
export const MEMORY_REVEAL_STEP_MS = 700;
export const MEMORY_REVEAL_TOTAL_MS = MEMORY_SEQUENCE_LENGTH * MEMORY_REVEAL_STEP_MS;
export const ODD_ONE_OUT_TILE_COUNT = 16;
export const WHACK_A_MOLE_HOLE_COUNT = 9;
export const WHACK_A_MOLE_SEQUENCE_LENGTH = 8;
export const COLOR_WORD_ROUND_COUNT = 6;
export const COLOR_WORD_COLORS: Array<{ key: string; word: string }> = [
  { key: 'red', word: 'Rot' }, { key: 'blue', word: 'Blau' }, { key: 'green', word: 'Grün' }, { key: 'yellow', word: 'Gelb' },
];

export function challengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const definition = CHALLENGES.find((entry) => entry.key === key);
  if (!definition) throw new Error('Unbekannte Challenge.');
  const random = seededRandom(seed);
  if (key === 'reaction-circle') return { ...definition, seed, data: { x: 15 + random() * 70, y: 20 + random() * 60 } };
  if (key === 'number-salad') {
    const numbers = shuffled(Array.from({ length: 8 }, (_, index) => index + 1), random);
    return { ...definition, seed, data: { numbers } };
  }
  if (key === 'aim-trainer') {
    const targets = Array.from({ length: AIM_TRAINER_TARGET_COUNT }, () => ({ x: 15 + random() * 70, y: 20 + random() * 60 }));
    // targetCount is a fixed, non-secret constant (not derived from the
    // targets array): the per-player wire payload later strips `targets`
    // down to just the current one, so the total needs its own field to
    // still render "X / 6 getroffen".
    return { ...definition, seed, data: { targets, targetCount: AIM_TRAINER_TARGET_COUNT } };
  }
  if (key === 'memory-sequence') {
    return { ...definition, seed, data: { tileCount: MEMORY_SEQUENCE_TILE_COUNT, sequence: randomSequence(random, MEMORY_SEQUENCE_LENGTH, MEMORY_SEQUENCE_TILE_COUNT) } };
  }
  if (key === 'odd-one-out') {
    return { ...definition, seed, data: { tileCount: ODD_ONE_OUT_TILE_COUNT, oddIndex: Math.floor(random() * ODD_ONE_OUT_TILE_COUNT) } };
  }
  if (key === 'whack-a-mole') {
    return { ...definition, seed, data: { holeCount: WHACK_A_MOLE_HOLE_COUNT, sequence: randomSequence(random, WHACK_A_MOLE_SEQUENCE_LENGTH, WHACK_A_MOLE_HOLE_COUNT), totalHits: WHACK_A_MOLE_SEQUENCE_LENGTH } };
  }
  if (key === 'traffic-light') {
    return { ...definition, seed, data: { greenAtMs: 2_000 + Math.floor(random() * 3_500) } };
  }
  if (key === 'color-word') {
    const rounds = Array.from({ length: COLOR_WORD_ROUND_COUNT }, () => {
      const word = COLOR_WORD_COLORS[Math.floor(random() * COLOR_WORD_COLORS.length)];
      const textColor = COLOR_WORD_COLORS[Math.floor(random() * COLOR_WORD_COLORS.length)];
      return { word: word.word, textColor: textColor.key, options: shuffled(COLOR_WORD_COLORS.map((entry) => entry.key), random) };
    });
    return { ...definition, seed, data: { rounds, roundCount: COLOR_WORD_ROUND_COUNT } };
  }
  return { ...definition, seed, data: {} };
}

function spacedBotSteps(
  count: number,
  startAt: number,
  endAt: number,
  step: (index: number, atMs: number) => Omit<BotChallengeStep, 'atMs'>,
): BotChallengeStep[] {
  if (count <= 0) return [];
  const safeStart = Math.max(40, Math.floor(startAt));
  const safeEnd = Math.max(safeStart, Math.floor(endAt));
  return Array.from({ length: count }, (_, index) => ({
    atMs: Math.round(safeStart + (count === 1 ? 0 : ((safeEnd - safeStart) * index) / (count - 1))),
    ...step(index, 0),
  }));
}

export function planBotChallenge(challenge: ChallengePayload, options: BotChallengePlanOptions = {}): BotChallengeStep[] {
  const random = seededRandom((challenge.seed ^ 0x51f15e) >>> 0);
  const deadline = Math.max(80, challenge.durationMs - 80);
  const clamp = (value: number) => Math.max(40, Math.min(deadline, Math.round(value)));

  if (challenge.key === 'reaction-circle') {
    const { x, y } = challenge.data as { x: number; y: number };
    return [{ atMs: clamp(420 + random() * 220), action: 'hit', value: { x, y } }];
  }
  if (challenge.key === 'cps') {
    const clicks = 12 + Math.floor(random() * 4);
    return spacedBotSteps(clicks, 120, deadline, () => ({ action: 'click' }));
  }
  if (challenge.key === 'number-salad') {
    return spacedBotSteps(8, 360, Math.min(deadline, 4_000), (index) => ({ action: 'number', value: index + 1 }));
  }
  if (challenge.key === 'timing-10') {
    return [{ atMs: clamp(9_900 + random() * 200), action: 'stop' }];
  }
  if (challenge.key === 'aim-trainer') {
    const targets = challenge.data.targets as Array<{ x: number; y: number }>;
    return spacedBotSteps(targets.length, 450, Math.min(deadline, 4_300), (index) => ({ action: 'hit', value: targets[index] }));
  }
  if (challenge.key === 'memory-sequence') {
    const sequence = challenge.data.sequence as number[];
    const revealMs = options.memoryRevealMs ?? MEMORY_REVEAL_TOTAL_MS;
    return spacedBotSteps(sequence.length, Math.min(deadline, revealMs + 180), Math.min(deadline, revealMs + 1_500), (index) => ({ action: 'tile', value: sequence[index] }));
  }
  if (challenge.key === 'odd-one-out') {
    return [{ atMs: clamp(1_200 + random() * 700), action: 'select', value: Number(challenge.data.oddIndex) }];
  }
  if (challenge.key === 'whack-a-mole') {
    const sequence = challenge.data.sequence as number[];
    return spacedBotSteps(sequence.length, 350, Math.min(deadline, 4_200), (index) => ({ action: 'hit', value: sequence[index] }));
  }
  if (challenge.key === 'traffic-light') {
    return [{ atMs: clamp(Number(challenge.data.greenAtMs) + 320 + random() * 240), action: 'click' }];
  }
  const rounds = challenge.data.rounds as Array<{ textColor: string }>;
  return spacedBotSteps(rounds.length, 420, Math.min(deadline, 4_000), (index) => ({ action: 'answer', value: rounds[index].textColor }));
}

export function safeScoreInput(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; }
function safeCount(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function safeElapsed(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
export function scoreReaction(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.max(0, safeElapsed(elapsedMs) - 120) / 35)); }
export function scoreCps(clicks: number): number { return safeScoreInput(Math.round(safeCount(clicks) * 5)); }
export function scoreNumberSalad(correct: number, errors: number, elapsedMs: number): number {
  return safeScoreInput(Math.round(safeCount(correct) * 12.5 - safeCount(errors) * 8 - Math.max(0, safeElapsed(elapsedMs) - 2_000) / 180));
}
export function scoreTiming10(elapsedMs: number): number { return safeScoreInput(Math.round(100 - Math.abs(safeElapsed(elapsedMs) - 10_000) / 20)); }
export function scoreAimTrainer(hits: number, elapsedMs: number): number {
  return safeScoreInput(Math.round((safeCount(hits) / AIM_TRAINER_TARGET_COUNT) * 100 - Math.max(0, safeElapsed(elapsedMs) - 2_000) / 250));
}
export function scoreMemorySequence(correct: number): number {
  return safeScoreInput(Math.round((safeCount(correct) / MEMORY_SEQUENCE_LENGTH) * 100));
}
// Wrong guesses carry a real penalty so rapid blind-clicking through the grid
// cannot outscore an honest look-and-click (the concept scores this challenge
// on time alone, but a free wrong click would make random guessing the
// mathematically better strategy at this tile count).
export function scoreOddOneOut(elapsedMs: number, errors = 0): number {
  return safeScoreInput(Math.round(100 - safeElapsed(elapsedMs) / 40 - safeCount(errors) * 15));
}
export function scoreWhackAMole(correct: number, errors: number, elapsedMs: number): number {
  return safeScoreInput(Math.round(safeCount(correct) * 12.5 - safeCount(errors) * 8 - Math.max(0, safeElapsed(elapsedMs) - 3_000) / 200));
}
export function scoreTrafficLight(elapsedAfterGreenMs: number, falseStart: boolean): number {
  return falseStart ? 0 : scoreReaction(elapsedAfterGreenMs);
}
export function scoreColorWord(correct: number, errors: number, elapsedMs: number): number {
  return safeScoreInput(Math.round((safeCount(correct) / COLOR_WORD_ROUND_COUNT) * 100 - safeCount(errors) * 10 - Math.max(0, safeElapsed(elapsedMs) - 3_000) / 250));
}

export function winnerIdForScores(scores: Array<{ playerId: string; score: number }>): string | null {
  const normalized = scores.map((entry) => ({ ...entry, score: Number.isFinite(entry.score) ? Math.max(0, entry.score) : 0 }));
  const highest = Math.max(0, ...normalized.map((entry) => entry.score));
  const winners = normalized.filter((entry) => entry.score === highest);
  return winners.length === 1 ? winners[0].playerId : null;
}

export function isCurrentChallenge(expectedIndex: number, actualIndex: number): boolean {
  return Number.isInteger(expectedIndex) && expectedIndex === actualIndex;
}

export function remainingUntil(deadlineAt: number | null, now: number): number | null {
  return deadlineAt === null ? null : Math.max(0, deadlineAt - now);
}

export interface ReadyGateEntry { playerId: string; connected: boolean; forfeited: boolean }

// Only still-connected, non-forfeited players are required to confirm ready —
// someone who left or dropped must not stall the rest of the group forever.
export function isReadyForNext(entries: ReadyGateEntry[], readyIds: Set<string> | string[]): boolean {
  const ready = readyIds instanceof Set ? readyIds : new Set(readyIds);
  const pending = entries.filter((entry) => entry.connected && !entry.forfeited);
  return pending.length > 0 && pending.every((entry) => ready.has(entry.playerId));
}
