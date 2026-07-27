import test from 'node:test';
import assert from 'node:assert/strict';
import { challengePayload, isCurrentChallenge, isReadyForNext, remainingUntil, safeScoreInput, scoreCps, scoreNumberSalad, scoreReaction, scoreTiming10, winnerIdForScores } from './challengeRushLogic';

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
