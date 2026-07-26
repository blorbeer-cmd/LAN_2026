import test from 'node:test';
import assert from 'node:assert/strict';
import { challengePayload, scoreCps, scoreNumberSalad, scoreReaction, scoreTiming10 } from './challengeRushLogic';

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
