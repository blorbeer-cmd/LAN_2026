export type ChallengeKey = 'reaction-circle' | 'cps' | 'number-salad' | 'timing-10';

export interface ChallengeDefinition { key: ChallengeKey; title: string; description: string; durationMs: number }
export const CHALLENGES: ChallengeDefinition[] = [
  { key: 'reaction-circle', title: 'Klick den Kreis', description: 'Klicke den Kreis so schnell wie möglich.', durationMs: 8_000 },
  { key: 'cps', title: 'CPS-Test', description: 'Klicke fünf Sekunden lang so oft du kannst.', durationMs: 5_000 },
  { key: 'number-salad', title: 'Zahlensalat', description: 'Klicke die Zahlen in aufsteigender Reihenfolge.', durationMs: 12_000 },
  { key: 'timing-10', title: 'Stoppe bei 10 Sekunden', description: 'Stoppe den unsichtbaren Timer möglichst genau bei 10,00 Sekunden.', durationMs: 15_000 },
];

export interface ChallengePayload { key: ChallengeKey; title: string; description: string; durationMs: number; seed: number; data: Record<string, unknown> }

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1_664_525 + 1_013_904_223) >>> 0; return value / 0x1_0000_0000; };
}

export function challengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const definition = CHALLENGES.find((entry) => entry.key === key);
  if (!definition) throw new Error('Unbekannte Challenge.');
  const random = seededRandom(seed);
  if (key === 'reaction-circle') return { ...definition, seed, data: { x: 15 + random() * 70, y: 20 + random() * 60 } };
  if (key === 'number-salad') {
    const numbers = Array.from({ length: 8 }, (_, index) => index + 1);
    for (let index = numbers.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [numbers[index], numbers[swap]] = [numbers[swap], numbers[index]]; }
    return { ...definition, seed, data: { numbers } };
  }
  return { ...definition, seed, data: {} };
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

export function winnerIdForScores(scores: Array<{ playerId: string; score: number }>): string | null {
  const normalized = scores.map((entry) => ({ ...entry, score: safeScoreInput(entry.score) }));
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
