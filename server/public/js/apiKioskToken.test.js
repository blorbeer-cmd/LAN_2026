import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { clearKioskToken, getKioskToken, setKioskToken } from './api.js';

function installStorage(entries = []) {
  const local = new Map(entries);
  const session = new Map();
  function storage(values) {
    return {
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
  }
  globalThis.localStorage = storage(local);
  globalThis.sessionStorage = storage(session);
  globalThis.location = { search: '' };
  return { local, session };
}

afterEach(() => {
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.location;
});

test('moves the pre-cutover kiosk token to its dedicated browser key', () => {
  const { local, session } = installStorage([['respawn_access_token', 'existing-kiosk-token']]);

  assert.equal(getKioskToken(), 'existing-kiosk-token');
  assert.equal(session.get('respawn_kiosk_token'), 'existing-kiosk-token');
  assert.equal(local.has('respawn_access_token'), false);
});

test('keeps a dedicated kiosk token instead of replacing it with legacy data', () => {
  const { local, session } = installStorage([
    ['respawn_kiosk_token', 'current-kiosk-token'],
    ['respawn_access_token', 'unrelated-old-token'],
  ]);

  assert.equal(getKioskToken(), 'current-kiosk-token');
  assert.equal(session.get('respawn_kiosk_token'), 'current-kiosk-token');
  assert.equal(local.has('respawn_access_token'), false);
});

test('setting a kiosk token keeps legacy data for already open displays', () => {
  const { local, session } = installStorage([['respawn_access_token', 'old-token']]);

  setKioskToken('new-token');

  assert.equal(session.get('respawn_kiosk_token'), 'new-token');
  assert.equal(local.get('respawn_access_token'), 'old-token');
});

test('an event link ignores a token for another event', () => {
  const { session } = installStorage([['respawn_kiosk_token', 'old-shared-token']]);
  globalThis.location.search = '?account=kiosk-event-b';
  assert.equal(getKioskToken(), '');
  setKioskToken('event-a-token', 'event-a');
  assert.equal(getKioskToken(), '');
  setKioskToken('event-b-token', 'event-b');
  assert.equal(getKioskToken(), 'event-b-token');
  assert.equal(session.get('respawn_kiosk_event'), 'event-b');
});

test('a revoked token cannot return from legacy browser storage', () => {
  const { local, session } = installStorage([['respawn_kiosk_token', 'revoked-token']]);
  assert.equal(getKioskToken(), 'revoked-token');
  clearKioskToken();
  assert.equal(getKioskToken(), '');
  assert.equal(local.has('respawn_kiosk_token'), false);
  assert.equal(session.has('respawn_kiosk_token'), false);
});
