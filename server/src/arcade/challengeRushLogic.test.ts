import test from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, challengePayload, createTrial, difficultyFor, isCurrentChallenge, isTrialChallenge, remainingUntil, safeScoreInput, scoreCps, scoreNumberSalad, scoreReaction, scoreTiming10, scoreTrialThroughput, validateTrialInput, winnerIdForScores } from './challengeRushLogic';

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
    const hard = createTrial(key, 77, 8, difficultyFor(8));
    assert.ok(hard.difficulty >= easy.difficulty, key);
    assert.ok(hard.phaseMs <= 30_000, key);
  }
});
test('the twenty logic trials expose deterministic choices and validate the answer', () => {
  const keys = ['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform'] as const;
  for (const key of keys) {
    const trial = createTrial(key, 42, 0, 2);
    const options = trial.data.options as unknown[];
    assert.ok(options.some((option) => String(option) === String(trial.expected)), key);
    if (trial.phase === 'preview') assert.equal(validateTrialInput(key, trial, 'choice', trial.expected).accepted, false, key);
    trial.phase = 'input';
    assert.equal(validateTrialInput(key, trial, 'choice', trial.expected).correct, true, key);
    assert.equal(validateTrialInput(key, trial, 'choice', '__wrong__').correct, false, key);
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
  assert.equal(validateTrialInput('traffic-light', traffic, 'click', undefined).correct, true);
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
  assert.equal(validateTrialInput('memory-pairs', pairs, 'pair', [first, second]).correct, true);
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
  assert.equal(scoreCps(20), 100); assert.equal(scoreCps(-1), 0);
  assert.equal(scoreNumberSalad(8, 0, 2_000), 100); assert.equal(scoreNumberSalad(0, 99, 2_000), 0);
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

test('difficulty changes the generated task and throughput rewards completed trials', () => {
  assert.notDeepEqual(createTrial('aim-trainer', 123, 0, 1).data, createTrial('aim-trainer', 123, 0, 5).data);
  assert.ok(scoreTrialThroughput(600, 12, 12, 30_000) > scoreTrialThroughput(100, 2, 2, 30_000));
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
