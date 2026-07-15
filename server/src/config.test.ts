// Unit tests for the production boot guard. Exercises the pure check
// directly (see index.ts) rather than spawning a real process to hit
// process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigError } from './config';

test('productionConfigError: legacy mode passes when ACCESS_TOKEN is set', () => {
  assert.equal(
    productionConfigError({ accessToken: 'tok', authMode: 'legacy', adminRecoveryCode: '' }),
    null
  );
});

test('productionConfigError: legacy mode fails when ACCESS_TOKEN is empty', () => {
  const error = productionConfigError({ accessToken: '', authMode: 'legacy', adminRecoveryCode: '' });
  assert.match(error ?? '', /ACCESS_TOKEN/);
});

test('productionConfigError: required mode replaces ACCESS_TOKEN with ADMIN_RECOVERY_CODE', () => {
  assert.equal(
    productionConfigError({ accessToken: '', authMode: 'required', adminRecoveryCode: 'recovery-secret' }),
    null
  );
  assert.match(
    productionConfigError({ accessToken: 'obsolete-token', authMode: 'required', adminRecoveryCode: '' }) ?? '',
    /ADMIN_RECOVERY_CODE/
  );
});
