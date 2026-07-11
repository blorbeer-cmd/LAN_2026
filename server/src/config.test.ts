// Unit tests for the production boot guard. Exercises the pure check
// directly (see index.ts) rather than spawning a real process to hit
// process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigError } from './config';

test('productionConfigError: passes when ACCESS_TOKEN is set', () => {
  assert.equal(
    productionConfigError({ accessToken: 'tok', adminPin: '' }),
    null
  );
});

test('productionConfigError: fails when ACCESS_TOKEN is empty', () => {
  const error = productionConfigError({ accessToken: '', adminPin: '' });
  assert.match(error ?? '', /ACCESS_TOKEN/);
});

// The admin PIN is retired for now (one-tap admin mode, see
// docs/KONZEPT-TEST-USER.md) — production must boot without it.
test('productionConfigError: does not require ADMIN_PIN', () => {
  assert.equal(
    productionConfigError({ accessToken: 'tok', adminPin: '1234' }),
    null
  );
});
