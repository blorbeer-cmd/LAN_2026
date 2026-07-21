import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArcadeTiming } from './timing';

test('Arcade keeps the production countdown unless E2E explicitly opts in', () => {
  assert.deepEqual(resolveArcadeTiming({}), { countdownMs: 3000 });
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'production', E2E_FAST_TIMERS: '1' }), { countdownMs: 3000 });
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'test', E2E_FAST_TIMERS: 'true' }), { countdownMs: 3000 });
  assert.deepEqual(resolveArcadeTiming({ NODE_ENV: 'test', E2E_FAST_TIMERS: '1' }), { countdownMs: 50 });
});
