import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAUSED_RECONNECT_GRACE_MS, RECONNECT_GRACE_MS, graceMsFor } from './reconnectGrace';

test('the reconnect grace is one minute, and ten minutes only while a pause keeps nobody waiting', () => {
  assert.equal(RECONNECT_GRACE_MS, 60_000);
  assert.equal(PAUSED_RECONNECT_GRACE_MS, 10 * 60_000);
  assert.equal(graceMsFor({ paused: false, otherHumanConnected: false }, RECONNECT_GRACE_MS), RECONNECT_GRACE_MS);
  assert.equal(graceMsFor({ paused: false, otherHumanConnected: true }, RECONNECT_GRACE_MS), RECONNECT_GRACE_MS);
  assert.equal(graceMsFor({ paused: true, otherHumanConnected: true }, RECONNECT_GRACE_MS), RECONNECT_GRACE_MS);
  assert.equal(graceMsFor({ paused: true, otherHumanConnected: false }, RECONNECT_GRACE_MS), PAUSED_RECONNECT_GRACE_MS);
});
