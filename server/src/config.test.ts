// Unit tests for the production boot guard. Exercises the pure check
// directly (see index.ts) rather than spawning a real process to hit
// process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigError } from './config';

test('productionConfigError: passes when both are set', () => {
  assert.equal(
    productionConfigError({ accessToken: 'tok', adminPin: '1234' }),
    null
  );
});

test('productionConfigError: fails when ACCESS_TOKEN is empty', () => {
  const error = productionConfigError({ accessToken: '', adminPin: '1234' });
  assert.match(error ?? '', /ACCESS_TOKEN/);
});

test('productionConfigError: fails when ADMIN_PIN is empty', () => {
  const error = productionConfigError({ accessToken: 'tok', adminPin: '' });
  assert.match(error ?? '', /ADMIN_PIN/);
});

test('productionConfigError: reports both when both are empty', () => {
  const error = productionConfigError({ accessToken: '', adminPin: '' });
  assert.match(error ?? '', /ACCESS_TOKEN/);
  assert.match(error ?? '', /ADMIN_PIN/);
});
