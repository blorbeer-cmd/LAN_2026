// Unit tests for the production boot guard. Exercises the pure check
// directly (see index.ts) rather than spawning a real process to hit
// process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigError } from './config';

test('productionConfigError accepts a configured recovery code', () => {
  assert.equal(productionConfigError({ adminRecoveryCode: 'recovery-secret' }), null);
});

test('productionConfigError requires ADMIN_RECOVERY_CODE', () => {
  assert.match(productionConfigError({ adminRecoveryCode: '' }) ?? '', /ADMIN_RECOVERY_CODE/);
});
