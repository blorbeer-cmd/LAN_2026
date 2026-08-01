// Unit tests for the production boot guard. Exercises the pure check
// directly (see index.ts) rather than spawning a real process to hit
// process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigError, startupAccessConfigError } from './config';

test('productionConfigError accepts a configured recovery code', () => {
  assert.equal(productionConfigError({ adminRecoveryCode: 'recovery-secret' }), null);
});

test('productionConfigError requires ADMIN_RECOVERY_CODE', () => {
  assert.match(productionConfigError({ adminRecoveryCode: '' }) ?? '', /ADMIN_RECOVERY_CODE/);
});

test('startupAccessConfigError accepts an existing claimed admin account', () => {
  assert.equal(startupAccessConfigError(true, { adminRecoveryCode: '' }), null);
});

test('startupAccessConfigError accepts a recovery path for a fresh database', () => {
  assert.equal(startupAccessConfigError(false, { adminRecoveryCode: 'first-user-secret' }), null);
});

test('startupAccessConfigError rejects an installation without a claimed admin or first-user path', () => {
  assert.match(startupAccessConfigError(false, { adminRecoveryCode: '' }) ?? '', /ADMIN_RECOVERY_CODE/);
});
