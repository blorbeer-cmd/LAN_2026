import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prepareLocalEnvironment } from './local-start.mjs';

const deterministicRandom = () => Buffer.alloc(32, 0xab);

test('creates a temporary recovery code when local startup has no first-user path', () => {
  const result = prepareLocalEnvironment({ PORT: '3001' }, deterministicRandom);

  assert.equal(result.generatedRecoveryCode, 'ab'.repeat(32));
  assert.equal(result.env.ADMIN_RECOVERY_CODE, result.generatedRecoveryCode);
  assert.equal(result.env.LOCAL_GENERATED_RECOVERY_CODE, '1');
  assert.equal(result.env.PORT, '3001');
});

test('keeps an explicitly configured recovery code', () => {
  const result = prepareLocalEnvironment({ ADMIN_RECOVERY_CODE: 'configured-secret' }, deterministicRandom);

  assert.equal(result.generatedRecoveryCode, null);
  assert.equal(result.env.ADMIN_RECOVERY_CODE, 'configured-secret');
  assert.equal(result.env.LOCAL_GENERATED_RECOVERY_CODE, undefined);
});

test('recognizes a complete bootstrap admin configuration', () => {
  const result = prepareLocalEnvironment(
    { BOOTSTRAP_ADMIN_2_NAME: 'LAN Admin', BOOTSTRAP_ADMIN_2_PASSWORD: 'strong-password' },
    deterministicRandom,
  );

  assert.equal(result.generatedRecoveryCode, null);
  assert.equal(result.env.ADMIN_RECOVERY_CODE, undefined);
});

test('ignores incomplete bootstrap admin slots', () => {
  const result = prepareLocalEnvironment({ BOOTSTRAP_ADMIN_1_NAME: 'LAN Admin' }, deterministicRandom);

  assert.equal(result.generatedRecoveryCode, 'ab'.repeat(32));
});

test('never synthesizes production credentials', () => {
  const result = prepareLocalEnvironment({ NODE_ENV: 'production' }, deterministicRandom);

  assert.equal(result.generatedRecoveryCode, null);
  assert.equal(result.env.ADMIN_RECOVERY_CODE, undefined);
});
