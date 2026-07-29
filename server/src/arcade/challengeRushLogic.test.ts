import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGES, challengeOrder, challengePayload, createTrial, isCurrentChallenge, isReadyForNext, remainingUntil, safeScoreInput,
  seenBeforeSelection,
  scoreAimTrainer, scoreColorWord, scoreCps, scoreMemorySequence, scoreNumberSalad, scoreOddOneOut,
  scoreReaction, scoreTiming10, scoreTrafficLight, scoreWhackAMole, winnerIdForScores,
  AIM_TRAINER_TARGET_COUNT, MEMORY_SEQUENCE_LENGTH, MEMORY_SEQUENCE_TILE_COUNT, ODD_ONE_OUT_TILE_COUNT,
  WHACK_A_MOLE_HOLE_COUNT, WHACK_A_MOLE_SEQUENCE_LENGTH, COLOR_WORD_ROUND_COUNT,
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
test('scores stay in the normalized 0..100 range', () => {
  assert.equal(scoreReaction(120), 100); assert.equal(scoreReaction(99_999), 0);
  assert.equal(scoreCps(20), 100); assert.equal(scoreCps(-1), 0);
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

test('all forty 30-second challenges are registered and matches select ten deterministically', () => {
  assert.equal(CHALLENGES.length, 40);
  assert.ok(CHALLENGES.every((challenge) => challenge.durationMs === 30_000));
  assert.equal(challengeOrder(123).length, 10);
  assert.deepEqual(challengeOrder(123), challengeOrder(123));
  for (const key of ['aim-trainer', 'memory-sequence', 'odd-one-out', 'whack-a-mole', 'traffic-light', 'color-word']) {
    assert.ok(CHALLENGES.some((entry) => entry.key === key), `${key} missing from CHALLENGES`);
  }
});

test('Phase 3 challenge payloads are deterministic per seed', () => {
  for (const key of ['aim-trainer', 'memory-sequence', 'odd-one-out', 'whack-a-mole', 'traffic-light', 'color-word'] as const) {
    assert.deepEqual(challengePayload(key, 555).data, challengePayload(key, 555).data);
  }
});

test('Phase 3 challenge payloads vary across seeds', () => {
  // odd-one-out excluded here: its payload is a single index in [0,16), so a
  // same-value collision across two arbitrary seeds is expected ~6% of the
  // time and is not itself a sign of broken randomization.
  for (const key of ['aim-trainer', 'memory-sequence', 'whack-a-mole', 'traffic-light', 'color-word'] as const) {
    assert.notDeepEqual(challengePayload(key, 555).data, challengePayload(key, 556).data);
  }
});

test('aim-trainer payload has the expected target count within playfield bounds', () => {
  const { targets } = challengePayload('aim-trainer', 42).data as { targets: Array<{ x: number; y: number }> };
  assert.equal(targets.length, AIM_TRAINER_TARGET_COUNT);
  for (const target of targets) { assert.ok(target.x >= 15 && target.x <= 85); assert.ok(target.y >= 20 && target.y <= 80); }
});

test('memory-sequence payload has no immediate tile repeats', () => {
  const { sequence, tileCount } = challengePayload('memory-sequence', 7).data as { sequence: number[]; tileCount: number };
  assert.equal(sequence.length, MEMORY_SEQUENCE_LENGTH);
  assert.equal(tileCount, MEMORY_SEQUENCE_TILE_COUNT);
  for (let index = 1; index < sequence.length; index += 1) assert.notEqual(sequence[index], sequence[index - 1]);
});

test('odd-one-out payload picks a single tile within the grid', () => {
  const { oddIndex, tileCount } = challengePayload('odd-one-out', 9).data as { oddIndex: number; tileCount: number };
  assert.equal(tileCount, ODD_ONE_OUT_TILE_COUNT);
  assert.ok(oddIndex >= 0 && oddIndex < ODD_ONE_OUT_TILE_COUNT);
});

test('whack-a-mole payload has the expected hole sequence without immediate repeats', () => {
  const { sequence, holeCount } = challengePayload('whack-a-mole', 3).data as { sequence: number[]; holeCount: number };
  assert.equal(sequence.length, WHACK_A_MOLE_SEQUENCE_LENGTH);
  assert.equal(holeCount, WHACK_A_MOLE_HOLE_COUNT);
  for (let index = 1; index < sequence.length; index += 1) assert.notEqual(sequence[index], sequence[index - 1]);
});

test('traffic-light payload keeps the green delay inside a fair window', () => {
  const { greenAtMs } = challengePayload('traffic-light', 11).data as { greenAtMs: number };
  assert.ok(greenAtMs >= 2_000 && greenAtMs < 5_500);
});

test('color-word payload has the expected round count with valid options', () => {
  const { rounds } = challengePayload('color-word', 21).data as { rounds: Array<{ word: string; textColor: string; options: string[] }> };
  assert.equal(rounds.length, COLOR_WORD_ROUND_COUNT);
  for (const round of rounds) { assert.ok(round.options.includes(round.textColor)); assert.equal(round.options.length, 4); }
});

test('Phase 3 score helpers stay in the normalized 0..100 range', () => {
  assert.equal(scoreAimTrainer(AIM_TRAINER_TARGET_COUNT, 2_000), 100);
  assert.equal(scoreAimTrainer(0, 0), 0);
  assert.equal(scoreMemorySequence(MEMORY_SEQUENCE_LENGTH), 100);
  assert.equal(scoreMemorySequence(0), 0);
  assert.equal(scoreOddOneOut(0), 100);
  assert.equal(scoreOddOneOut(99_999), 0);
  assert.equal(scoreOddOneOut(0, 1), 85);
  assert.ok(scoreOddOneOut(0, 1) < scoreOddOneOut(400, 0), 'a wrong guess should not beat an honest, slightly slower hit');
  assert.equal(scoreWhackAMole(WHACK_A_MOLE_SEQUENCE_LENGTH, 0, 3_000), 100);
  assert.equal(scoreWhackAMole(0, 99, 3_000), 0);
  assert.equal(scoreTrafficLight(120, false), 100);
  assert.equal(scoreTrafficLight(0, true), 0);
  assert.equal(scoreTrafficLight(99_999, false), 0);
  assert.equal(scoreColorWord(COLOR_WORD_ROUND_COUNT, 0, 3_000), 100);
  assert.equal(scoreColorWord(0, COLOR_WORD_ROUND_COUNT, 3_000), 0);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(safeScoreInput(scoreAimTrainer(value, value)), scoreAimTrainer(value, value));
    assert.ok(scoreOddOneOut(value) >= 0 && scoreOddOneOut(value) <= 100);
    assert.ok(scoreWhackAMole(value, value, value) >= 0 && scoreWhackAMole(value, value, value) <= 100);
  }
});

// These references deliberately derive the solution only from the public
// prompt/data. A generator cannot pass by validating an answer against the
// same implementation that produced it.
const REFERENCE_DIRECTIONS = ['Norden', 'Osten', 'Süden', 'Westen'];
const REFERENCE_ARROWS = ['↑', '→', '↓', '←'];
const REFERENCE_CATEGORIES: Record<string, string> = { Apfel: 'Obst', Banane: 'Obst', Birne: 'Obst', Karotte: 'Gemüse', Paprika: 'Gemüse', Gurke: 'Gemüse' };
const numbersIn = (text: string): number[] => (text.match(/-?\d+/g) ?? []).map(Number);
const sortedLetters = (word: string): string => [...word].sort().join('');
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
  'number-sequence': (trial) => { const [first, second, third] = numbersIn(String(trial.data.prompt)); assert.equal(second - first, third - second); return String(third + (third - second)); },
  'logic-equation': (trial) => { const [a, b, c] = numbersIn(String(trial.data.prompt)); return String(a + b * c); },
  'pattern-complete': (trial) => {
    const tokens = String(trial.data.prompt).split(' ');
    assert.equal(tokens.at(-1), '?'); assert.equal(tokens[3], tokens[0]); assert.equal(tokens[4], tokens[1]);
    return tokens[2];
  },
  'category-sort': (trial) => { const item = String(trial.data.prompt).match(/„(.+?)“/)?.[1] ?? ''; return REFERENCE_CATEGORIES[item] ?? `unbekannt:${item}`; },
  'direction-match': (trial) => {
    const match = String(trial.data.prompt).match(/Starte im ([^\s]+) und drehe dich (\d+)×/);
    assert.ok(match); return REFERENCE_DIRECTIONS[(REFERENCE_DIRECTIONS.indexOf(match[1]) + Number(match[2])) % 4];
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
  'clock-angle': (trial) => {
    const [hour, minute] = numbersIn(String(trial.data.prompt));
    const difference = Math.abs((hour % 12) * 30 + minute * 0.5 - minute * 6);
    return String(Math.round(Math.min(difference, 360 - difference)));
  },
  'binary-pattern': (trial) => { const bits = numbersIn(String(trial.data.prompt)); return String(1 - bits.at(-1)!); },
  'rule-switch': (trial) => {
    const prompt = String(trial.data.prompt); const evenIsBlue = prompt.startsWith('Gerade Zahlen = Blau'); const number = numbersIn(prompt)[0];
    return number % 2 === 0 ? (evenIsBlue ? 'Blau' : 'Rot') : (evenIsBlue ? 'Rot' : 'Blau');
  },
  'matrix-missing': (trial) => { const [[a, b], [c]] = trial.data.matrix as number[][]; return String(c + (b - a)); },
  'coin-change': (trial) => String(minimumCoins(numbersIn(String(trial.data.prompt))[0])),
  'letter-order': (trial) => (String(trial.data.prompt).match(/[A-Z](?=,|\?)/g) ?? []).sort()[0] ?? '',
  'digit-sum': (trial) => String(String(numbersIn(String(trial.data.prompt))[0]).split('').reduce((sum, digit) => sum + Number(digit), 0)),
  'sequence-transform': (trial) => {
    const terms = numbersIn(String(trial.data.prompt));
    assert.ok(terms.every((term, index) => index === 0 || term === terms[index - 1] * 2 + 1));
    return String(terms.at(-1)! * 2 + 1);
  },
};

test('all twenty logic generators agree with independent reference solutions', () => {
  const keys = CHALLENGES.map((challenge) => challenge.key).filter((key) => key in REFERENCE_SOLUTIONS);
  assert.equal(keys.length, 20);
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

test('sequence-transform asks for the first unseen term and never shows its answer', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const trial = createTrial('sequence-transform', seed, 0, 1 + (seed % 5));
    assert.equal(numbersIn(String(trial.data.prompt)).includes(Number(trial.expected)), false);
    assert.equal(REFERENCE_SOLUTIONS['sequence-transform'](trial), String(trial.expected));
  }
});

test('seen-before keeps both answers reachable without redefining an old symbol as new', () => {
  let seen: string[] = []; let yes = 0; let no = 0;
  for (let index = 0; index < 1_000; index += 1) {
    const selection = seenBeforeSelection(index % 3 === 0, seen, index);
    if (selection.repeated) {
      yes += 1; assert.ok(seen.includes(selection.symbol));
    } else {
      no += 1; assert.equal(seen.includes(selection.symbol), false);
    }
    seen = selection.seenSymbols;
  }
  assert.ok(yes > 0); assert.ok(no > 0);
});
