import test from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, CHALLENGE_SYMBOLS, SEEN_BEFORE_SYMBOLS, challengeOrder, challengePayload, createTrial, difficultyFor, hidesPreviewTiming, isCurrentChallenge, isTrialChallenge, remainingUntil, safeScoreInput, scoreCps, scoreNumberSalad, scoreReaction, scoreRepeatedTrials, scoreTiming10, scoreTrialThroughput, seenBeforeSelection, validateTrialInput, winnerIdForScores, type ChallengeKey, type InternalTrial } from './challengeRushLogic';

test('same seed creates the same challenge data', () => {
  assert.deepEqual(challengePayload('number-salad', 123).data, challengePayload('number-salad', 123).data);
  assert.notDeepEqual(challengePayload('number-salad', 123).data, challengePayload('number-salad', 124).data);
});
test('all memory challenges create deterministic, bounded trials', () => {
  const memoryKeys = ['sequence-echo', 'reverse-echo', 'memory-matrix', 'number-blind', 'n-back', 'seen-before', 'missing-item', 'memory-pairs', 'path-memory', 'suitcase-memory'] as const;
  assert.equal(new Set(memoryKeys).size, 10);
  for (const key of memoryKeys) {
    const first = createTrial(key, 123, 0, 1);
    const second = createTrial(key, 123, 0, 1);
    assert.deepEqual(first.data, second.data);
    assert.equal(first.trialId, second.trialId);
    assert.ok(first.difficulty >= 1 && first.difficulty <= 5);
  }
});
test('Challenge Rush uses the repeated 30-second duration for every challenge', () => {
  assert.equal(CHALLENGES.length, 40);
  assert.equal(new Set(CHALLENGES.map((challenge) => challenge.key)).size, 40);
  assert.ok(CHALLENGES.every((challenge) => challenge.durationMs === 30_000));
});
test('all 40 challenge definitions produce stable public payloads', () => {
  for (const challenge of CHALLENGES) {
    const first = challengePayload(challenge.key, 2026);
    const second = challengePayload(challenge.key, 2026);
    assert.deepEqual(first, second, challenge.key);
    assert.equal(first.key, challenge.key);
    assert.equal(first.durationMs, 30_000);
  }
});
test('every trial-backed challenge creates bounded deterministic input data', () => {
  const trialKeys = CHALLENGES.filter((challenge) => isTrialChallenge(challenge.key)).map((challenge) => challenge.key);
  assert.equal(trialKeys.length, 36);
  for (const key of trialKeys) {
    const first = createTrial(key, 404, 3, 5);
    const second = createTrial(key, 404, 3, 5);
    assert.deepEqual(first, second, key);
    assert.ok(first.trialId.length > 0, key);
    assert.ok(first.difficulty >= 1 && first.difficulty <= 5, key);
    assert.ok(first.phaseMs >= 0 && first.phaseMs <= 30_000, key);
  }
});
test('difficulty progression stays predictable across a full round', () => {
  assert.equal(difficultyFor(-5), 1);
  assert.equal(difficultyFor(0), 1);
  assert.equal(difficultyFor(1), 1);
  assert.equal(difficultyFor(2), 2);
  assert.equal(difficultyFor(8), 5);
  assert.equal(difficultyFor(99), 5);
  const trialKeys = CHALLENGES.filter((challenge) => isTrialChallenge(challenge.key)).map((challenge) => challenge.key);
  for (const key of trialKeys) {
    const easy = createTrial(key, 77, 0, difficultyFor(0));
    const hard = createTrial(key, 77, 0, difficultyFor(8));
    assert.ok(hard.difficulty >= easy.difficulty, key);
    assert.ok(hard.phaseMs <= 30_000, key);
    assert.ok(typeof easy.inputMs === 'number' && typeof hard.inputMs === 'number', key);
    assert.ok(hard.inputMs < easy.inputMs, key);
  }
});
test('the twenty logic trials expose deterministic choices and validate the answer', () => {
  const keys = ['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform'] as const;
  for (const key of keys) {
    const trial = createTrial(key, 42, 0, 2);
    const options = trial.data.options as unknown[];
    assert.ok(options.some((option) => String(option) === String(trial.expected)), key);
    assert.equal(new Set(options.map(String)).size, options.length, key);
    assert.equal(options.filter((option) => String(option) === String(trial.expected)).length, 1, key);
    if (trial.phase === 'preview') assert.equal(validateTrialInput(key, trial, 'choice', trial.expected).accepted, false, key);
    trial.phase = 'input';
    assert.equal(validateTrialInput(key, trial, 'choice', trial.expected).correct, true, key);
    assert.equal(validateTrialInput(key, trial, 'choice', '__wrong__').correct, false, key);
  }
});
test('logic choices contain one unique correct option across varied seeds', () => {
  const keys = ['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform'] as const;
  for (const key of keys) for (let seed = 0; seed < 200; seed += 1) {
    const trial = createTrial(key, seed, seed % 8, 1 + (seed % 5));
    const options = (trial.data.options ?? []) as unknown[];
    assert.equal(new Set(options.map(String)).size, options.length, `${key}:${seed}`);
    assert.equal(options.filter((option) => String(option) === String(trial.expected)).length, 1, `${key}:${seed}`);
  }
});

test('logic-order requires interpreting shuffled constraints', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const trial = createTrial('logic-order', seed, 0, seed % 2 ? 2 : 5);
    const mentioned = String(trial.data.prompt).match(/[A-D]/g)?.join('') ?? '';
    assert.notEqual(mentioned.slice(0, String(trial.expected).length), trial.expected, String(trial.data.prompt));
  }
});

test('missing-item choices all come from the original group', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const trial = createTrial('missing-item', seed, 0, 3);
    const original = trial.data.originalItems as string[];
    const visible = trial.data.items as string[];
    const options = trial.data.options as string[];
    assert.ok(options.every((item) => original.includes(item)));
    assert.ok(!visible.includes(String(trial.expected)));
  }
});
test('the six additional challenge trials validate their intended input', () => {
  const aim = createTrial('aim-trainer', 7, 0, 1);
  assert.equal(validateTrialInput('aim-trainer', aim, 'hit', aim.expected).correct, true);
  const sequence = createTrial('memory-sequence', 7, 0, 1); sequence.phase = 'input';
  assert.equal(validateTrialInput('memory-sequence', sequence, 'sequence', sequence.expected).correct, true);
  const odd = createTrial('odd-one-out', 7, 0, 1);
  assert.equal(validateTrialInput('odd-one-out', odd, 'select', odd.expected).correct, true);
  const whack = createTrial('whack-a-mole', 7, 0, 1); whack.phase = 'input';
  const whackSequence = whack.expected as number[];
  for (const [index, value] of whackSequence.entries()) {
    const result = validateTrialInput('whack-a-mole', whack, 'hit', value);
    assert.equal(result.correct, true);
    assert.equal(result.complete, index === whackSequence.length - 1);
  }
  const traffic = createTrial('traffic-light', 7, 0, 1); traffic.phase = 'input';
  const fastTraffic = validateTrialInput('traffic-light', traffic, 'click', undefined, 120);
  const slowTraffic = validateTrialInput('traffic-light', traffic, 'click', undefined, 1_200);
  assert.equal(fastTraffic.correct, true);
  assert.ok(fastTraffic.rawScore > slowTraffic.rawScore);
  const color = createTrial('color-word', 7, 0, 1);
  assert.equal(validateTrialInput('color-word', color, 'answer', color.expected).correct, true);
});
test('sequence and matrix trials accept only the complete correct answer', () => {
  const sequence = createTrial('sequence-echo', 123, 0, 1);
  sequence.phase = 'input';
  assert.equal(validateTrialInput('sequence-echo', sequence, 'sequence', sequence.expected).correct, true);
  assert.equal(validateTrialInput('sequence-echo', sequence, 'sequence', [999]).correct, false);
  const matrix = createTrial('memory-matrix', 123, 0, 1);
  matrix.phase = 'input';
  assert.equal(validateTrialInput('memory-matrix', matrix, 'cells', matrix.expected).correct, true);
  assert.equal(validateTrialInput('memory-matrix', matrix, 'cells', []).correct, false);
});
test('memory trial validators cover choice, missing item, path and pairs', () => {
  const choice = createTrial('n-back', 99, 4, 3); choice.phase = 'input';
  assert.equal(validateTrialInput('n-back', choice, 'choice', choice.expected).correct, true);
  assert.equal(validateTrialInput('n-back', choice, 'choice', !choice.expected).correct, false);
  const seen = createTrial('seen-before', 99, 1, 1); seen.phase = 'input';
  assert.equal(validateTrialInput('seen-before', seen, 'choice', seen.expected).correct, true);

  const missing = createTrial('missing-item', 99, 0, 1); missing.phase = 'input';
  assert.equal(validateTrialInput('missing-item', missing, 'choice', missing.expected).correct, true);
  assert.equal(validateTrialInput('missing-item', missing, 'choice', 'nicht vorhanden').correct, false);
  const suitcase = createTrial('suitcase-memory', 99, 0, 1); suitcase.phase = 'input';
  assert.equal(validateTrialInput('suitcase-memory', suitcase, 'choice', suitcase.expected).correct, true);

  const blind = createTrial('number-blind', 99, 0, 1); blind.phase = 'input';
  assert.equal(validateTrialInput('number-blind', blind, 'sequence', blind.expected).correct, true);

  const path = createTrial('path-memory', 99, 0, 1); path.phase = 'input';
  assert.equal(validateTrialInput('path-memory', path, 'sequence', path.expected).correct, true);

  const pairs = createTrial('memory-pairs', 99, 0, 1);
  const board = pairs.expected as string[];
  const first = board.findIndex((value, index) => board.indexOf(value) !== index);
  const second = board.findIndex((value, index) => index !== first && value === board[first]);
  const firstPair = validateTrialInput('memory-pairs', pairs, 'pair', [first, second]);
  assert.equal(firstPair.correct, true);
  assert.equal(firstPair.rawScore, 0);
  assert.equal(validateTrialInput('memory-pairs', pairs, 'pair', [0, 0]).accepted, false);
  const mismatchPairs = createTrial('memory-pairs', 100, 0, 1);
  const mismatchBoard = mismatchPairs.expected as string[];
  const mismatch = 0;
  const mismatchOther = mismatchBoard.findIndex((value, index) => index !== mismatch && value !== mismatchBoard[mismatch]);
  const mismatchResult = validateTrialInput('memory-pairs', mismatchPairs, 'pair', [mismatch, mismatchOther]);
  assert.equal(mismatchResult.complete, false);
  assert.equal(mismatchResult.rawScore, -4);
  const pathValues = path.expected as number[];
  assert.equal(validateTrialInput('path-memory', path, 'sequence', pathValues.map(String)).correct, false);
  const matrix = createTrial('memory-matrix', 99, 0, 1); matrix.phase = 'input';
  assert.equal(validateTrialInput('memory-matrix', matrix, 'cells', [null]).correct, false);
});
test('scores stay in the normalized 0..100 range', () => {
  assert.equal(scoreReaction(120), 100); assert.equal(scoreReaction(99_999), 0);
  assert.ok(scoreCps(180) > scoreCps(60)); assert.equal(scoreCps(240), 100); assert.equal(scoreCps(-1), 0);
  assert.equal(scoreNumberSalad(8, 0), 100); assert.equal(scoreNumberSalad(0, 99), 0);
  assert.equal(scoreTiming10(10_000), 100); assert.equal(scoreTiming10(12_000), 0);
});
test('ties do not select an arbitrary winner', () => {
  assert.equal(winnerIdForScores([{ playerId: 'a', score: 10 }, { playerId: 'b', score: 10 }]), null);
  assert.equal(winnerIdForScores([{ playerId: 'a', score: 11 }, { playerId: 'b', score: 10 }]), 'a');
  assert.equal(winnerIdForScores([{ playerId: 'a', score: 150 }, { playerId: 'b', score: 120 }]), 'a');
});

test('N-back derives the expected answer from the server-side visible history', () => {
  const history = ['◆', '●', '▲'];
  const trial = createTrial('n-back', 123, 3, 1, history);
  const previous = history[history.length - 1];
  assert.equal(trial.data.n, 1);
  assert.equal(trial.expected, trial.data.symbol === previous);
});

test('seen-before keeps both answers reachable over a full round', () => {
  let seen: string[] = [];
  const answers: boolean[] = [];
  let resets = 0;
  for (let index = 0; index < 60; index += 1) {
    const selection = seenBeforeSelection('◆', index % 3 === 0, seen, index);
    assert.ok(SEEN_BEFORE_SYMBOLS.includes(selection.symbol as typeof SEEN_BEFORE_SYMBOLS[number]));
    const restarted = seen.length > 1 && selection.seenSymbols.length === 1;
    if (restarted) resets += 1;
    else assert.equal(selection.repeated, seen.includes(selection.symbol));
    seen = selection.seenSymbols;
    answers.push(selection.repeated);
  }
  assert.ok(resets <= 1, `unexpected pool restarts: ${resets}`);
  const tail = answers.slice(-25);
  assert.ok(tail.includes(true), 'no repeat stayed reachable at the end of the round');
  assert.ok(tail.includes(false), 'every late trial answered „Ja"');
});

test('an exhausted seen-before pool restarts instead of forcing „Ja"', () => {
  const exhausted = seenBeforeSelection('◆', false, [...SEEN_BEFORE_SYMBOLS], 3);
  assert.equal(exhausted.repeated, false);
  assert.deepEqual(exhausted.seenSymbols, [exhausted.symbol]);
  assert.ok(SEEN_BEFORE_SYMBOLS.length > CHALLENGE_SYMBOLS.length);
});

test('only the traffic light hides its preview timing', () => {
  assert.equal(hidesPreviewTiming('traffic-light'), true);
  for (const challenge of CHALLENGES) if (challenge.key !== 'traffic-light') assert.equal(hidesPreviewTiming(challenge.key), false, challenge.key);
});

test('matches use a deterministic shuffled subset of the 40 challenges', () => {
  const first = challengeOrder(123);
  assert.equal(first.length, 10);
  assert.equal(new Set(first).size, 10);
  assert.deepEqual(first, challengeOrder(123));
  assert.notDeepEqual(first, challengeOrder(124));
});

test('difficulty changes the generated task and throughput rewards completed trials', () => {
  assert.ok((createTrial('aim-trainer', 123, 0, 5).inputMs ?? 0) < (createTrial('aim-trainer', 123, 0, 1).inputMs ?? 0));
  assert.ok(scoreTrialThroughput(600, 12, 12, 30_000) > scoreTrialThroughput(100, 2, 2, 30_000));
  assert.ok(scoreRepeatedTrials(225, 3, 3, 24, 30_000) > scoreRepeatedTrials(75, 1, 1, 8, 30_000));
  assert.ok(scoreRepeatedTrials(75, 1, 1, 8, 30_000) > scoreRepeatedTrials(0, 1, 0, 3, 30_000));
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
    assert.equal(scoreNumberSalad(value, value), 0);
    assert.equal(scoreTiming10(value), 0);
    assert.equal(safeScoreInput(value), 0);
  }
  assert.equal(scoreCps(Number.MAX_SAFE_INTEGER), 100);
  assert.equal(scoreNumberSalad(Number.MAX_SAFE_INTEGER, 0), 100);
  assert.equal(winnerIdForScores([{ playerId: 'a', score: Number.NaN }, { playerId: 'b', score: 0 }]), null);
});

// Independently implemented solutions for the logic generators. They read only what the client
// actually sees (prompt, matrix, options) so a generator with a wrong `expected` cannot pass by
// validating against its own assumption.
const REFERENCE_DIRECTIONS = ['Norden', 'Osten', 'Süden', 'Westen'];
const REFERENCE_ARROWS = ['↑', '→', '↓', '←'];
const REFERENCE_CATEGORIES: Record<string, string> = { Apfel: 'Obst', Banane: 'Obst', Birne: 'Obst', Karotte: 'Gemüse', Paprika: 'Gemüse', Gurke: 'Gemüse' };
const numbersIn = (text: string): number[] => (text.match(/-?\d+/g) ?? []).map(Number);
const sortedLetters = (word: string): string => [...word].sort().join('');
function minimumCoins(amount: number): number {
  const best = [0, ...Array.from({ length: amount }, () => Number.POSITIVE_INFINITY)];
  for (let value = 1; value <= amount; value += 1) for (const coin of [1, 2, 5]) if (coin <= value) best[value] = Math.min(best[value], best[value - coin] + 1);
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
    assert.equal(tokens.length, 6);
    assert.equal(tokens[5], '?');
    assert.equal(tokens[3], tokens[0]);
    assert.equal(tokens[4], tokens[1]);
    return tokens[2];
  },
  'category-sort': (trial) => { const item = String(trial.data.prompt).match(/„(.+?)“/)?.[1] ?? ''; return REFERENCE_CATEGORIES[item] ?? `unbekannt:${item}`; },
  'direction-match': (trial) => {
    const match = String(trial.data.prompt).match(/Starte im ([^\s]+) und drehe dich (\d+)×/);
    assert.ok(match, String(trial.data.prompt));
    return REFERENCE_DIRECTIONS[(REFERENCE_DIRECTIONS.indexOf(match![1]) + Number(match![2])) % REFERENCE_DIRECTIONS.length];
  },
  'mental-rotation': (trial) => {
    const match = String(trial.data.prompt).match(/Drehe (.) um (\d+)°/);
    assert.ok(match, String(trial.data.prompt));
    return REFERENCE_ARROWS[(REFERENCE_ARROWS.indexOf(match![1]) + Number(match![2]) / 90) % REFERENCE_ARROWS.length];
  },
  'word-scramble': (trial) => {
    const letters = String(trial.data.prompt).match(/„(.+?)“/)?.[1] ?? '';
    const solutions = (trial.data.options as string[]).filter((option) => sortedLetters(option) === sortedLetters(letters));
    assert.equal(solutions.length, 1, String(trial.data.prompt));
    return solutions[0];
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
    assert.equal(solutions.length, 1, String(trial.data.prompt));
    return solutions[0];
  },
  'delayed-recall': (trial) => {
    const items = trial.data.items as string[];
    const shown = (trial.data.options as string[]).filter((option) => items.includes(option));
    assert.equal(shown.length, 1, String(trial.data.options));
    return shown[0];
  },
  'prime-check': (trial) => {
    const [candidate] = numbersIn(String(trial.data.prompt));
    const divisors = Array.from({ length: Math.max(0, candidate - 2) }, (_, offset) => offset + 2);
    return candidate > 1 && divisors.every((divisor) => divisor * divisor > candidate || candidate % divisor !== 0) ? 'Ja' : 'Nein';
  },
  'balance-scale': (trial) => { const [known, total] = numbersIn(String(trial.data.prompt)); return String(total - known); },
  'clock-angle': (trial) => {
    const [hour, minute] = numbersIn(String(trial.data.prompt));
    const difference = Math.abs(((hour % 12) * 30 + minute * 0.5) - minute * 6);
    return String(Math.round(Math.min(difference, 360 - difference)));
  },
  'binary-pattern': (trial) => {
    const bits = numbersIn(String(trial.data.prompt));
    assert.ok(bits.every((bit, index) => index === 0 || bit !== bits[index - 1]), String(trial.data.prompt));
    return String(1 - bits[bits.length - 1]);
  },
  'rule-switch': (trial) => {
    const prompt = String(trial.data.prompt);
    const evenIsBlue = prompt.startsWith('Gerade Zahlen = Blau');
    const number = numbersIn(prompt)[0];
    return number % 2 === 0 ? (evenIsBlue ? 'Blau' : 'Rot') : (evenIsBlue ? 'Rot' : 'Blau');
  },
  'matrix-missing': (trial) => { const [[a, b], [c]] = trial.data.matrix as number[][]; return String(c + (b - a)); },
  'coin-change': (trial) => String(minimumCoins(numbersIn(String(trial.data.prompt))[0])),
  'letter-order': (trial) => {
    const letters = (String(trial.data.prompt).match(/[A-Z](?=,|\?)/g) ?? []).sort();
    assert.equal(letters.length, 3, String(trial.data.prompt));
    return letters[0] ?? '';
  },
  'digit-sum': (trial) => String(String(numbersIn(String(trial.data.prompt))[0]).split('').reduce((sum, digit) => sum + Number(digit), 0)),
  'sequence-transform': (trial) => {
    const terms = numbersIn(String(trial.data.prompt));
    assert.ok(terms.every((term, index) => index === 0 || term === terms[index - 1] * 2 + 1), String(trial.data.prompt));
    return String(terms[terms.length - 1] * 2 + 1);
  },
};

test('every logic generator agrees with an independently computed solution', () => {
  const keys = CHALLENGES.map((challenge) => challenge.key).filter((key) => key in REFERENCE_SOLUTIONS);
  assert.equal(keys.length, 20);
  for (const key of keys) {
    const reference = REFERENCE_SOLUTIONS[key];
    for (let seed = 0; seed < 120; seed += 1) {
      for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
        const trial = createTrial(key as ChallengeKey, seed, seed % 9, difficulty);
        assert.equal(reference(trial), String(trial.expected), `${key}:${seed}:${difficulty} — ${String(trial.data.prompt ?? JSON.stringify(trial.data.matrix))}`);
      }
    }
  }
});

test('coin-change and sequence-transform ask for an answer that is not already visible', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const coins = createTrial('coin-change', seed, 0, 1 + (seed % 5));
    assert.equal(String(coins.expected), String(minimumCoins(numbersIn(String(coins.data.prompt))[0])));
    const series = createTrial('sequence-transform', seed, 0, 1 + (seed % 5));
    const shown = numbersIn(String(series.data.prompt));
    assert.equal(shown.includes(Number(series.expected)), false, String(series.data.prompt));
  }
});
