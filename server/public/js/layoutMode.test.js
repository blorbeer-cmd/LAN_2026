import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_MODE,
  applyLayoutModeForPlayer,
  layoutModeForPlayer,
  layoutModeStorageKey,
  resolvedLayoutMode,
  setLayoutModeForPlayer,
} from './layoutMode.js';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('a new account starts with the automatic layout preference', () => {
  assert.equal(layoutModeForPlayer('alice', { storage: memoryStorage() }), DEFAULT_LAYOUT_MODE);
});

test('automatic layout follows the wide-screen breakpoint', () => {
  assert.equal(resolvedLayoutMode('auto', { wide: true }), 'desktop');
  assert.equal(resolvedLayoutMode('auto', { wide: false }), 'laptop');
  assert.equal(resolvedLayoutMode('desktop', { wide: false }), 'desktop');
  assert.equal(resolvedLayoutMode('laptop', { wide: true }), 'laptop');
});

test('layout choices are isolated by verified account and survive a session boundary', () => {
  const storage = memoryStorage();
  setLayoutModeForPlayer('alice', 'laptop', { storage, root: null });
  setLayoutModeForPlayer('bob', 'desktop', { storage, root: null });

  // Logout removes the separate session-account key, not either preference.
  storage.values.delete('respawn_session_account');
  assert.equal(layoutModeForPlayer('alice', { storage }), 'laptop');
  assert.equal(layoutModeForPlayer('bob', { storage }), 'desktop');
  assert.notEqual(layoutModeStorageKey('alice'), layoutModeStorageKey('bob'));
});

test('apply and set update preference and resolved document markers', () => {
  const storage = memoryStorage();
  const root = { dataset: {} };
  storage.setItem(layoutModeStorageKey('alice'), 'auto');

  assert.equal(applyLayoutModeForPlayer('alice', { storage, root, wide: true }), 'auto');
  assert.equal(root.dataset.layoutPreference, 'auto');
  assert.equal(root.dataset.layoutMode, 'desktop');
  assert.equal(setLayoutModeForPlayer('alice', 'laptop', { storage, root, wide: true }), 'laptop');
  assert.equal(root.dataset.layoutPreference, 'laptop');
  assert.equal(root.dataset.layoutMode, 'laptop');
  assert.equal(storage.getItem(layoutModeStorageKey('alice')), 'laptop');
});

test('invalid or blocked storage falls back safely', () => {
  const blockedStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  const root = { dataset: {} };
  assert.equal(applyLayoutModeForPlayer('alice', { storage: blockedStorage, root, wide: false }), 'auto');
  assert.equal(root.dataset.layoutPreference, 'auto');
  assert.equal(root.dataset.layoutMode, 'laptop');
});
