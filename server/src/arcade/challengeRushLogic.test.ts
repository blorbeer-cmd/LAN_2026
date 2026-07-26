import test from 'node:test';
import assert from 'node:assert/strict';
import { challengePayload, isCurrentChallenge, remainingUntil, scoreCps, scoreNumberSalad, scoreReaction, scoreTiming10, winnerIdForScores } from './challengeRushLogic';

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
test('stale challenge generations and expired deadlines are rejected safely', () => {
  assert.equal(isCurrentChallenge(2, 2), true);
  assert.equal(isCurrentChallenge(1, 2), false);
  assert.equal(remainingUntil(1_000, 1_250), 0);
  assert.equal(remainingUntil(null, 1_250), null);
});
