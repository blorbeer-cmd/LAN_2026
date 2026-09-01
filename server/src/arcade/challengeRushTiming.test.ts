import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChallengeRushTiming } from './challengeRushTiming';

test('Challenge Rush keeps real timings unless tests explicitly opt into fast timers', () => {
  const expected = {
    countdownMs: 5_000,
    challengeDurationMs: null,
    previewMs: null,
  };
  assert.deepEqual(resolveChallengeRushTiming({}), expected);
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'production', CHALLENGE_RUSH_FAST_TIMERS: '1' }), expected);
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'production', E2E_FAST_TIMERS: '1' }), expected);
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'test', CHALLENGE_RUSH_FAST_TIMERS: 'true' }), expected);
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'test', E2E_FAST_TIMERS: 'true' }), expected);
});

test('Challenge Rush exposes bounded fast timing profiles to opted-in tests', () => {
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'test', CHALLENGE_RUSH_FAST_TIMERS: '1' }), {
    countdownMs: 50,
    challengeDurationMs: 1_200,
    previewMs: 50,
  });
  assert.deepEqual(resolveChallengeRushTiming({ NODE_ENV: 'test', E2E_FAST_TIMERS: '1' }), {
    countdownMs: 50,
    challengeDurationMs: null,
    previewMs: null,
  });
});
