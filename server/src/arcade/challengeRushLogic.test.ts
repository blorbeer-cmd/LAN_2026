import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGES, challengeOrder, challengePayload, createTrial, difficultyFor, isCurrentChallenge, isReadyForNext, isTrialChallenge, planBotChallenge, previewTrialData, remainingUntil, safeScoreInput,
  validateTrialInput,
  scoreColorWord, scoreCps, scoreNumberSalad, scoreOddOneOut,
  scoreReaction, scoreTiming10, winnerIdForScores,
  ODD_ONE_OUT_TILE_COUNT, COLOR_WORD_ROUND_COUNT,
  type ChallengeKey, type InternalTrial,
} from './challengeRushLogic';

test('same seed creates the same challenge data', () => {
  assert.deepEqual(challengePayload('number-salad', 123).data, challengePayload('number-salad', 123).data);
  assert.notDeepEqual(challengePayload('number-salad', 123).data, challengePayload('number-salad', 124).data);
});
test('trial IDs are opaque and independent from deterministic generator inputs', () => {
  const first = createTrial('coin-change', 123_456_789, 0, 1);
  const second = createTrial('coin-change', 123_456_789, 0, 1);
  assert.notEqual(first.trialId, second.trialId);
  assert.doesNotMatch(first.trialId, /123456789|^0-/);
  assert.equal(first.expected, second.expected);
  assert.deepEqual(first.data, second.data);
});

// planBotChallenge only ever plans the original ten single-payload
// challenges; the thirty trial-based ones (see isTrialChallenge) generate a
// fresh per-player trial on demand instead of one fixed payload, so a bot
// simply sits those out (see challengeRush.ts's beginChallenge/runMatchTick).
test('Challenge Rush bot plans valid inputs for every single-payload challenge type', () => {
  const originalChallenges = CHALLENGES.filter((challenge) => !isTrialChallenge(challenge.key));
  assert.equal(originalChallenges.length, 6);
  const plans = new Map(originalChallenges.map((challenge, index) => {
    const payload = challengePayload(challenge.key, 1_000 + index);
    const plan = planBotChallenge(payload);
    assert.ok(plan.length > 0, `${challenge.key} needs at least one bot action`);
    assert.ok(plan.every((step) => step.atMs >= 40 && step.atMs < payload.durationMs));
    assert.deepEqual([...plan].sort((left, right) => left.atMs - right.atMs), plan);
    return [challenge.key, { payload, plan }] as const;
  }));

  assert.deepEqual(plans.get('number-salad')?.plan.map((step) => step.value), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(
    plans.get('color-word')?.plan.map((step) => step.value),
    (plans.get('color-word')?.payload.data.rounds as Array<{ textColor: string }>).map((round) => round.textColor),
  );
});
test('Challenge Rush bot plans nothing for the trial-based challenges instead of crashing', () => {
  const trialChallenges = CHALLENGES.filter((challenge) => isTrialChallenge(challenge.key));
  assert.equal(trialChallenges.length, 25);
  for (const challenge of trialChallenges) {
    assert.deepEqual(planBotChallenge(challengePayload(challenge.key, 42)), []);
  }
});
test('scores stay in the normalized 0..100 range', () => {
  assert.equal(scoreReaction(120), 100); assert.equal(scoreReaction(99_999), 0);
  assert.equal(scoreCps(20), 8); assert.equal(scoreCps(60), 25); assert.equal(scoreCps(240), 100); assert.equal(scoreCps(-1), 0);
  assert.ok(scoreCps(90) > scoreCps(60), 'a faster sustained rate must keep scoring higher below the saturation point');
  assert.equal(scoreNumberSalad(8, 0, 2_000), 100); assert.equal(scoreNumberSalad(0, 99, 2_000), 0);
  assert.equal(scoreTiming10(10_000), 100); assert.equal(scoreTiming10(12_000), 0);
});
test('ties do not select an arbitrary winner', () => {
  assert.equal(winnerIdForScores([{ playerId: 'a', score: 10 }, { playerId: 'b', score: 10 }]), null);
  assert.equal(winnerIdForScores([{ playerId: 'a', score: 11 }, { playerId: 'b', score: 10 }]), 'a');
});
test('cumulative match totals above the single-challenge 0..100 range are not falsely tied', () => {
  assert.equal(winnerIdForScores([{ playerId: 'a', score: 236 }, { playerId: 'b', score: 151 }]), 'a');
});
test('stale challenge generations and expired deadlines are rejected safely', () => {
  assert.equal(isCurrentChallenge(2, 2), true);
  assert.equal(isCurrentChallenge(1, 2), false);
  assert.equal(remainingUntil(1_000, 1_250), 0);
  assert.equal(remainingUntil(null, 1_250), null);
});
test('score helpers normalize non-finite and extreme inputs', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(scoreReaction(value), 100);
    assert.equal(scoreCps(value), 0);
    assert.equal(scoreNumberSalad(value, value, value), 0);
    assert.equal(scoreTiming10(value), 0);
    assert.equal(safeScoreInput(value), 0);
  }
  assert.equal(scoreCps(Number.MAX_SAFE_INTEGER), 100);
  assert.equal(scoreNumberSalad(Number.MAX_SAFE_INTEGER, 0, 0), 100);
  assert.equal(winnerIdForScores([{ playerId: 'a', score: Number.NaN }, { playerId: 'b', score: 0 }]), null);
});
test('preview payloads contain only information intended for memorization', () => {
  const delayedTrial = createTrial('delayed-recall', 1, 0, 2);
  const pathTrial = createTrial('path-memory', 4, 0, 2);
  const delayed = previewTrialData(delayedTrial);
  const missing = previewTrialData(createTrial('missing-item', 2, 0, 2));
  const suitcase = previewTrialData(createTrial('suitcase-memory', 3, 0, 2));
  assert.deepEqual(Object.keys(delayed).sort(), ['items', 'prompt', 'type']);
  assert.deepEqual(Object.keys(missing).sort(), ['originalItems', 'type']);
  assert.deepEqual(Object.keys(suitcase).sort(), ['items', 'type']);
  assert.equal('options' in delayed, false);
  assert.equal('options' in missing, false);
  assert.equal('options' in suitcase, false);
  assert.ok(delayedTrial.phaseMs >= 2_500);
  assert.ok(pathTrial.phaseMs >= 2_500);
});
test('difficulty rises with continued play even when a streak breaks', () => {
  assert.equal(difficultyFor(0, 0), 1);
  assert.equal(difficultyFor(0, 3), 2);
  assert.equal(difficultyFor(0, 12), 5);
  assert.ok(difficultyFor(6, 3) > difficultyFor(0, 3));
});
test('isReadyForNext requires every still-connected, non-forfeited player to confirm', () => {
  const entries = [
    { playerId: 'a', connected: true, forfeited: false },
    { playerId: 'b', connected: true, forfeited: false },
  ];
  assert.equal(isReadyForNext(entries, new Set(['a'])), false);
  assert.equal(isReadyForNext(entries, new Set(['a', 'b'])), true);
  assert.equal(isReadyForNext(entries, ['a', 'b']), true);
});
test('isReadyForNext ignores disconnected or forfeited players and never fires with no pending players', () => {
  const entries = [
    { playerId: 'a', connected: true, forfeited: false },
    { playerId: 'b', connected: false, forfeited: false },
    { playerId: 'c', connected: true, forfeited: true },
  ];
  assert.equal(isReadyForNext(entries, new Set(['a'])), true);
  assert.equal(isReadyForNext([{ playerId: 'a', connected: false, forfeited: false }], new Set()), false);
});

test('all thirty-one 30-second challenges are registered and matches select ten deterministically', () => {
  assert.equal(CHALLENGES.length, 31);
  assert.ok(CHALLENGES.every((challenge) => challenge.durationMs === 30_000));
  assert.equal(challengeOrder(123).length, 10);
  assert.deepEqual(challengeOrder(123), challengeOrder(123));
  for (const key of ['reaction-circle', 'cps', 'number-salad', 'timing-10', 'odd-one-out', 'color-word']) {
    assert.ok(CHALLENGES.some((entry) => entry.key === key), `${key} missing from CHALLENGES`);
  }
});

// The nine challenges dropped for being the most failure-prone (per-player
// step deadlines, cross-trial state, a client-side reveal/hide state machine)
// or degenerate in content must not reappear by accident.
test('retired challenges stay out of the catalog', () => {
  for (const key of ['aim-trainer', 'whack-a-mole', 'traffic-light', 'memory-sequence', 'memory-pairs', 'n-back', 'seen-before', 'sequence-transform', 'clock-angle']) {
    assert.equal(CHALLENGES.some((entry) => entry.key === key), false, `${key} should no longer be registered`);
  }
});

test('Phase 3 challenge payloads are deterministic per seed', () => {
  for (const key of ['reaction-circle', 'number-salad', 'odd-one-out', 'color-word'] as const) {
    assert.deepEqual(challengePayload(key, 555).data, challengePayload(key, 555).data);
  }
});

test('Phase 3 challenge payloads vary across seeds', () => {
  // odd-one-out excluded here: its payload is a single index in [0,16), so a
  // same-value collision across two arbitrary seeds is expected ~6% of the
  // time and is not itself a sign of broken randomization.
  for (const key of ['reaction-circle', 'number-salad', 'color-word'] as const) {
    assert.notDeepEqual(challengePayload(key, 555).data, challengePayload(key, 556).data);
  }
});



test('odd-one-out payload picks a single tile within the grid', () => {
  const { oddIndex, tileCount } = challengePayload('odd-one-out', 9).data as { oddIndex: number; tileCount: number };
  assert.equal(tileCount, ODD_ONE_OUT_TILE_COUNT);
  assert.ok(oddIndex >= 0 && oddIndex < ODD_ONE_OUT_TILE_COUNT);
});



test('color-word payload has the expected round count with valid options', () => {
  const { rounds } = challengePayload('color-word', 21).data as { rounds: Array<{ word: string; textColor: string; options: string[] }> };
  assert.equal(rounds.length, COLOR_WORD_ROUND_COUNT);
  for (const round of rounds) { assert.ok(round.options.includes(round.textColor)); assert.equal(round.options.length, 4); }
});

test('Phase 3 score helpers stay in the normalized 0..100 range', () => {
  assert.equal(scoreOddOneOut(0), 100);
  assert.equal(scoreOddOneOut(99_999), 0);
  assert.equal(scoreOddOneOut(0, 1), 85);
  assert.ok(scoreOddOneOut(0, 1) < scoreOddOneOut(400, 0), 'a wrong guess should not beat an honest, slightly slower hit');
  assert.equal(scoreColorWord(COLOR_WORD_ROUND_COUNT, 0, 3_000), 100);
  assert.equal(scoreColorWord(0, COLOR_WORD_ROUND_COUNT, 3_000), 0);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(safeScoreInput(scoreColorWord(value, value, value)), scoreColorWord(value, value, value));
    assert.ok(scoreOddOneOut(value) >= 0 && scoreOddOneOut(value) <= 100);
  }
});

// These references deliberately derive the solution only from the public
// prompt/data. A generator cannot pass by validating an answer against the
// same implementation that produced it.
const REFERENCE_DIRECTIONS = ['Norden', 'Osten', 'Süden', 'Westen'];
const REFERENCE_ARROWS = ['↑', '→', '↓', '←'];
const REFERENCE_CATEGORIES: Record<string, string> = {
  Apfel: 'Obst', Banane: 'Obst', Birne: 'Obst', Pflaume: 'Obst',
  Karotte: 'Gemüse', Paprika: 'Gemüse', Gurke: 'Gemüse', Brokkoli: 'Gemüse',
  Adler: 'Tier', Otter: 'Tier', Pinguin: 'Tier', Delfin: 'Tier',
  Hammer: 'Werkzeug', Zange: 'Werkzeug', Säge: 'Werkzeug', Bohrer: 'Werkzeug',
  Geige: 'Instrument', Trommel: 'Instrument', Flöte: 'Instrument', Klavier: 'Instrument',
};
const numbersIn = (text: string): number[] => (text.match(/-?\d+/g) ?? []).map(Number);
const sortedLetters = (word: string): string => [...word].sort().join('');
function nextPeriodicValue<T>(values: T[]): T {
  for (let period = 1; period < values.length; period += 1) {
    if (values.slice(period).every((value, index) => value === values[index])) return values[values.length % period];
  }
  throw new Error(`Keine periodische Regel in ${values.join(',')}`);
}
function nextNumberSequence(values: number[]): number {
  const differences = values.slice(1).map((value, index) => value - values[index]);
  if (differences.every((difference) => difference === differences[0])) return values.at(-1)! + differences[0];
  if (values.length === 4 && values.slice(1).every((value, index) => value / values[index] === values[1] / values[0])) return values.at(-1)! * (values[1] / values[0]);
  if (differences.length === 4 && differences[0] === differences[2] && differences[1] === differences[3]) return values.at(-1)! + differences[0];
  if (differences.every((difference, index) => index === 0 || difference === differences[index - 1] + 1)) return values.at(-1)! + differences.at(-1)! + 1;
  if (values.length === 5) return values[3] + (values[3] - values[1]);
  throw new Error(`Unbekannte Zahlenregel in ${values.join(',')}`);
}
function minimumCoins(amount: number): number {
  const best = [0, ...Array.from({ length: amount }, () => Number.POSITIVE_INFINITY)];
  for (let value = 1; value <= amount; value += 1) {
    for (const coin of [1, 2, 5]) if (coin <= value) best[value] = Math.min(best[value], best[value - coin] + 1);
  }
  return best[amount];
}
function referencePermutations(values: string[]): string[] {
  if (values.length <= 1) return values;
  return values.flatMap((entry, index) => referencePermutations(values.filter((_, other) => other !== index)).map((suffix) => entry + suffix));
}
const REFERENCE_SOLUTIONS: Record<string, (trial: InternalTrial) => string> = {
  'number-sequence': (trial) => String(nextNumberSequence(numbersIn(String(trial.data.prompt)))),
  'logic-equation': (trial) => { const [a, b, c] = numbersIn(String(trial.data.prompt)); return String(a + b * c); },
  'pattern-complete': (trial) => {
    const tokens = String(trial.data.prompt).split(' '); assert.equal(tokens.pop(), '?');
    return nextPeriodicValue(tokens);
  },
  'category-sort': (trial) => { const item = String(trial.data.prompt).match(/„(.+?)“/)?.[1] ?? ''; return REFERENCE_CATEGORIES[item] ?? `unbekannt:${item}`; },
  'direction-match': (trial) => {
    const prompt = String(trial.data.prompt); const start = prompt.match(/Du schaust nach ([^.]+)\./)?.[1];
    assert.ok(start); let direction = REFERENCE_DIRECTIONS.indexOf(start);
    for (const command of prompt.matchAll(/(90|180)° nach (rechts|links)/g)) {
      const turns = Number(command[1]) / 90; direction = (direction + (command[2] === 'rechts' ? turns : -turns) + 4) % 4;
    }
    return REFERENCE_DIRECTIONS[direction];
  },
  'mental-rotation': (trial) => {
    const match = String(trial.data.prompt).match(/Drehe (.) um (\d+)°/);
    assert.ok(match); return REFERENCE_ARROWS[(REFERENCE_ARROWS.indexOf(match[1]) + Number(match[2]) / 90) % 4];
  },
  'word-scramble': (trial) => {
    const letters = String(trial.data.prompt).match(/„(.+?)“/)?.[1] ?? '';
    const solutions = (trial.data.options as string[]).filter((option) => sortedLetters(option) === sortedLetters(letters));
    assert.equal(solutions.length, 1); return solutions[0];
  },
  'count-shapes': (trial) => {
    const [question, sequence] = String(trial.data.prompt).split('vor?');
    const target = question.replace('Wie oft kommt', '').trim();
    return String(sequence.trim().split(' ').filter((shape) => shape === target).length);
  },
  'logic-order': (trial) => {
    const elements = [...new Set([...(trial.data.options as string[])[0]])];
    const constraints = [...String(trial.data.prompt).matchAll(/([A-D]) kommt (nach|vor) ([A-D])/g)]
      .map((clue) => clue[2] === 'nach' ? [clue[3], clue[1]] : [clue[1], clue[3]]);
    const solutions = referencePermutations(elements).filter((candidate) => constraints.every(([before, after]) => candidate.indexOf(before) < candidate.indexOf(after)));
    assert.equal(solutions.length, 1); return solutions[0];
  },
  'delayed-recall': (trial) => {
    const items = trial.data.items as string[];
    const shown = (trial.data.options as string[]).filter((option) => items.includes(option));
    assert.equal(shown.length, 1); return shown[0];
  },
  'prime-check': (trial) => {
    const [candidate] = numbersIn(String(trial.data.prompt));
    const prime = candidate > 1 && Array.from({ length: Math.max(0, candidate - 2) }, (_, offset) => offset + 2)
      .every((divisor) => divisor * divisor > candidate || candidate % divisor !== 0);
    return prime ? 'Ja' : 'Nein';
  },
  'balance-scale': (trial) => { const [known, total] = numbersIn(String(trial.data.prompt)); return String(total - known); },
  'binary-pattern': (trial) => String(nextPeriodicValue(numbersIn(String(trial.data.prompt)))),
  'rule-switch': (trial) => {
    const prompt = String(trial.data.prompt); const evenIsBlue = prompt.startsWith('Gerade Zahlen = Blau'); const number = numbersIn(prompt)[0];
    return number % 2 === 0 ? (evenIsBlue ? 'Blau' : 'Rot') : (evenIsBlue ? 'Rot' : 'Blau');
  },
  'matrix-missing': (trial) => { const [[a, b], [c]] = trial.data.matrix as number[][]; return String(c + (b - a)); },
  'coin-change': (trial) => String(minimumCoins(numbersIn(String(trial.data.prompt))[0])),
  'letter-order': (trial) => [...(trial.data.letters as string[])].sort()[0],
  'digit-sum': (trial) => String(String(numbersIn(String(trial.data.prompt))[0]).split('').reduce((sum, digit) => sum + Number(digit), 0)),
};

test('all eighteen logic generators agree with independent reference solutions', () => {
  const keys = CHALLENGES.map((challenge) => challenge.key).filter((key) => key in REFERENCE_SOLUTIONS);
  assert.equal(keys.length, 18);
  const coinAmounts = new Set<number>();
  for (const key of keys) {
    for (let seed = 0; seed < 120; seed += 1) for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
      const trial = createTrial(key as ChallengeKey, seed, seed % 9, difficulty);
      assert.equal(REFERENCE_SOLUTIONS[key](trial), String(trial.expected), `${key}:${seed}:${difficulty}`);
      if (key === 'coin-change') coinAmounts.add(numbersIn(String(trial.data.prompt))[0]);
    }
  }
  assert.deepEqual([...coinAmounts].sort((a, b) => a - b), Array.from({ length: 18 }, (_, index) => index + 8));
});

test('formerly repetitive challenges generate a broad task pool at high difficulty', () => {
  const uniquePrompts = (key: ChallengeKey) => new Set(Array.from({ length: 120 }, (_, seed) => {
    const data = createTrial(key, seed, seed, 5).data;
    return key === 'letter-order' ? JSON.stringify(data.letters) : String(data.prompt);
  })).size;
  assert.ok(uniquePrompts('number-sequence') >= 70);
  assert.ok(uniquePrompts('binary-pattern') >= 12);
  assert.ok(uniquePrompts('letter-order') >= 100);
  assert.ok(uniquePrompts('digit-sum') >= 100);
});



test('word-scramble never presents the source word verbatim as its own scramble', () => {
  for (let seed = 0; seed < 500; seed += 1) {
    const trial = createTrial('word-scramble', seed, 0, 1 + (seed % 5));
    const prompt = String(trial.data.prompt);
    const letters = prompt.match(/„(.+?)“/)?.[1] ?? '';
    assert.notEqual(letters, trial.expected, `seed ${seed} exposed the answer verbatim`);
    assert.deepEqual([...letters].sort(), [...String(trial.expected)].sort());
  }
});

test('number-blind never asks for more unique positions than the grid holds', () => {
  for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
    for (let index = 0; index < 60; index += 4) {
      const trial = createTrial('number-blind', 7, index, difficulty);
      const size = Number(trial.data.size);
      const numbers = trial.data.numbers as Array<{ position: number }>;
      assert.ok(numbers.length <= size * size, `difficulty ${difficulty} index ${index} requested ${numbers.length} positions for a ${size}x${size} grid`);
      assert.ok(numbers.every((entry) => Number.isInteger(entry.position)), `difficulty ${difficulty} index ${index} produced an undefined position`);
      assert.equal(new Set(numbers.map((entry) => entry.position)).size, numbers.length);
    }
  }
});

test('array-based trial inputs reject a mismatched length before sorting/hashing the payload', () => {
  const huge = Array.from({ length: 50_000 }, (_, index) => index);

  const matrixTrial = createTrial('memory-matrix', 1, 0, 1);
  matrixTrial.phase = 'input';
  const rejected = validateTrialInput('memory-matrix', matrixTrial, 'cells', huge);
  assert.equal(rejected.correct, false);
  assert.equal(rejected.complete, true);

  const sequenceTrial = createTrial('sequence-echo', 1, 0, 1);
  sequenceTrial.phase = 'input';
  const rejectedSequence = validateTrialInput('sequence-echo', sequenceTrial, 'sequence', huge);
  assert.equal(rejectedSequence.correct, false);

  const numberBlindTrial = createTrial('number-blind', 1, 0, 1);
  numberBlindTrial.phase = 'input';
  const rejectedNumberBlind = validateTrialInput('number-blind', numberBlindTrial, 'sequence', huge);
  assert.equal(rejectedNumberBlind.correct, false);
});
