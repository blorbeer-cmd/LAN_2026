import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_REVEAL_TOTAL_MS } from './challengeRushLogic';
import { resolveChallengeRushTiming } from './challengeRushTiming';

test('Challenge Rush keeps real timings unless tests explicitly opt into fast timers', () => {
  const expected = {
    countdownMs: 3_000,
    challengeDurationMs: null,
    memoryRevealMs: MEMORY_REVEAL_TOTAL_MS,
    trafficLightGreenMs: null,
  };
  assert.deepEqual(resolveChallengeRushTiming({}), expected);
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'production', CHALLENGE_RUSH_FAST_TIMERS: '1' }), expected);
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'test', CHALLENGE_RUSH_FAST_TIMERS: 'true' }), expected);
});

test('Challenge Rush exposes one consistent fast timing profile to opted-in tests', () => {
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'test', CHALLENGE_RUSH_FAST_TIMERS: '1' }), {
    countdownMs: 50,
    challengeDurationMs: 1_200,
    memoryRevealMs: 50,
    trafficLightGreenMs: 100,
  });
});
