import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArcadeTiming } from './timing';

const PRODUCTION = { countdownMs: 3000, endRevealMs: 12_000, quizRevealMs: 3500 };
const FAST = { countdownMs: 50, endRevealMs: 250, quizRevealMs: 1400 };

test('Arcade keeps the production timings unless a test run explicitly opts in', () => {
  assert.deepEqual(resolveArcadeTiming({}), PRODUCTION);
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'production', E2E_FAST_TIMERS: '1' }), PRODUCTION);
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'production', ARCADE_FAST_TIMERS: '1' }), PRODUCTION);
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'test', E2E_FAST_TIMERS: 'true' }), PRODUCTION);
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'test', ARCADE_FAST_TIMERS: 'true' }), PRODUCTION);
});

test('both test profiles shorten the intro and the end reveal but keep the quiz reveal readable', () => {
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'test', E2E_FAST_TIMERS: '1' }), FAST);
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'test', ARCADE_FAST_TIMERS: '1' }), FAST);
});
