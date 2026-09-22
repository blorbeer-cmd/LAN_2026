// Unit tests for the production boot guard. Exercises the pure check
// directly (see index.ts) rather than spawning a real process to hit
// process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedAgentVersionFrom, productionConfigError, startupAccessConfigError } from './config';

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

test('a blank EXPECTED_AGENT_VERSION falls back to the shipped default', () => {
  // Both consumers compare this value for inequality: an empty string would
  // brand every installed agent as deviating instead of disabling the check.
  assert.equal(expectedAgentVersionFrom(undefined, '1.1.0'), '1.1.0');
  assert.equal(expectedAgentVersionFrom('   ', '1.1.0'), '1.1.0');
  assert.equal(expectedAgentVersionFrom(' 1.2.0 ', '1.1.0'), '1.2.0');
});
