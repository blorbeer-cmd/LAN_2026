import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGES, challengePayload, isCurrentChallenge, isReadyForNext, remainingUntil, safeScoreInput,
  scoreAimTrainer, scoreColorWord, scoreCps, scoreMemorySequence, scoreNumberSalad, scoreOddOneOut,
  scoreReaction, scoreTiming10, scoreTrafficLight, scoreWhackAMole, winnerIdForScores,
  AIM_TRAINER_TARGET_COUNT, MEMORY_SEQUENCE_LENGTH, MEMORY_SEQUENCE_TILE_COUNT, ODD_ONE_OUT_TILE_COUNT,
  WHACK_A_MOLE_HOLE_COUNT, WHACK_A_MOLE_SEQUENCE_LENGTH, COLOR_WORD_ROUND_COUNT,
} from './challengeRushLogic';

test('same seed creates the same challenge data', () => {
  assert.deepEqual(challengePayload('number-salad', 123).data, challengePayload('number-salad', 123).data);
  assert.notDeepEqual(challengePayload('number-salad', 123).data, challengePayload('number-salad', 124).data);
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

test('the Phase 3 challenges are registered alongside the original four', () => {
  assert.equal(CHALLENGES.length, 10);
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
