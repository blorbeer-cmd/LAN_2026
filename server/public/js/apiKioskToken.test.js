import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { getKioskToken, setKioskToken } from './api.js';

function installStorage(entries = []) {
  const values = new Map(entries);
  globalThis.localStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  return values;
}

afterEach(() => {
  delete globalThis.localStorage;
});

test('moves the pre-cutover kiosk token to its dedicated browser key', () => {
  const values = installStorage([['respawn_access_token', 'existing-kiosk-token']]);

  assert.equal(getKioskToken(), 'existing-kiosk-token');
  assert.equal(values.get('respawn_kiosk_token'), 'existing-kiosk-token');
  assert.equal(values.has('respawn_access_token'), false);
});

test('keeps a dedicated kiosk token instead of replacing it with legacy data', () => {
  const values = installStorage([
    ['respawn_kiosk_token', 'current-kiosk-token'],
    ['respawn_access_token', 'unrelated-old-token'],
  ]);

  assert.equal(getKioskToken(), 'current-kiosk-token');
  assert.equal(values.has('respawn_access_token'), false);
});

test('setting a kiosk token removes leftover legacy data', () => {
  const values = installStorage([['respawn_access_token', 'old-token']]);

  setKioskToken('new-token');

  assert.equal(values.get('respawn_kiosk_token'), 'new-token');
  assert.equal(values.has('respawn_access_token'), false);
});
