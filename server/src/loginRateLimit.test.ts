// Unit tests for the in-memory login rate limiter. No DB/Express needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeGlobalAuthRequest,
  isLoginLocked,
  loginRetryAfterMs,
  recordLoginFailure,
  recordLoginSuccess,
} from './loginRateLimit';

test('an account is not locked before reaching the failure threshold', () => {
  const name = `Rate Test A ${Date.now()}`;
  for (let i = 0; i < 9; i++) recordLoginFailure(name);
  assert.equal(isLoginLocked(name), false);
});

test('an account locks out at the failure threshold', () => {
  const name = `Rate Test B ${Date.now()}`;
  for (let i = 0; i < 10; i++) recordLoginFailure(name);
  assert.equal(isLoginLocked(name), true);
  assert.ok(loginRetryAfterMs(name) > 0);
});

test('a successful login clears the lockout', () => {
  const name = `Rate Test C ${Date.now()}`;
  for (let i = 0; i < 10; i++) recordLoginFailure(name);
  assert.equal(isLoginLocked(name), true);
  recordLoginSuccess(name);
  assert.equal(isLoginLocked(name), false);
  assert.equal(loginRetryAfterMs(name), 0);
});

test('lockout is per-account, not global, and case-insensitive', () => {
  const nameLower = `rate test d ${Date.now()}`;
  for (let i = 0; i < 10; i++) recordLoginFailure(nameLower);
  assert.equal(isLoginLocked(nameLower.toUpperCase()), true, 'lock should follow the name case-insensitively');
  assert.equal(isLoginLocked(`unrelated name ${Date.now()}`), false);
});

test('lockout duration grows with repeated failures beyond the threshold', () => {
  const name = `Rate Test E ${Date.now()}`;
  for (let i = 0; i < 10; i++) recordLoginFailure(name);
  const firstRetry = loginRetryAfterMs(name);
  for (let i = 0; i < 5; i++) recordLoginFailure(name);
  const laterRetry = loginRetryAfterMs(name);
  assert.ok(laterRetry > firstRetry, `expected growing lockout, got ${firstRetry} then ${laterRetry}`);
});

test('global auth limiting is bounded to a window and recovers afterwards', () => {
  const start = Date.now() + 100_000;
  for (let index = 0; index < 300; index++) {
    assert.equal(consumeGlobalAuthRequest(start + index).allowed, true);
  }
  const limited = consumeGlobalAuthRequest(start + 300);
  assert.equal(limited.allowed, false);
  assert.ok(limited.retryAfterMs > 0);
  assert.equal(consumeGlobalAuthRequest(start + 60_001).allowed, true);
});
