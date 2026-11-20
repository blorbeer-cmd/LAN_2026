import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_MODE,
  applyLayoutModeForPlayer,
  fitAutomaticDesktopRail,
  forgetAutomaticRailFit,
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

test('automatic falls back to the laptop shell while the desktop rail would scroll', () => {
  forgetAutomaticRailFit();
  const root = { dataset: { layoutPreference: 'auto', layoutMode: 'desktop' } };
  const railList = { scrollHeight: 520, clientHeight: 400, measured: 0 };
  const measuringRail = new Proxy(railList, {
    get: (target, key) => {
      if (key === 'scrollHeight') target.measured += 1;
      return target[key];
    },
  });

  fitAutomaticDesktopRail({ root, railList: measuringRail, viewportHeight: 700 });
  assert.equal(root.dataset.layoutMode, 'laptop');

  // Still too short: decided from the remembered height, without rendering the rail again.
  root.dataset.layoutMode = 'desktop';
  fitAutomaticDesktopRail({ root, railList: measuringRail, viewportHeight: 810 });
  assert.equal(root.dataset.layoutMode, 'laptop');
  assert.equal(railList.measured, 1);

  // Tall enough for the measured overflow: the rail returns and fits.
  root.dataset.layoutMode = 'desktop';
  railList.clientHeight = 520;
  fitAutomaticDesktopRail({ root, railList: measuringRail, viewportHeight: 820 });
  assert.equal(root.dataset.layoutMode, 'desktop');

  // Fewer entries reset the remembered height, so a short window may fit again.
  forgetAutomaticRailFit();
  railList.scrollHeight = 300;
  railList.clientHeight = 300;
  fitAutomaticDesktopRail({ root, railList: measuringRail, viewportHeight: 600 });
  assert.equal(root.dataset.layoutMode, 'desktop');
});

test('an explicit Desktop choice and a hidden rail keep the desktop shell', () => {
  forgetAutomaticRailFit();
  const explicit = { dataset: { layoutPreference: 'desktop', layoutMode: 'desktop' } };
  fitAutomaticDesktopRail({ root: explicit, railList: { scrollHeight: 900, clientHeight: 300 }, viewportHeight: 500 });
  assert.equal(explicit.dataset.layoutMode, 'desktop');

  const hidden = { dataset: { layoutPreference: 'auto', layoutMode: 'desktop' } };
  fitAutomaticDesktopRail({ root: hidden, railList: { scrollHeight: 0, clientHeight: 0 }, viewportHeight: 500 });
  assert.equal(hidden.dataset.layoutMode, 'desktop');
  // Sub-pixel rounding is not a scrolling list.
  fitAutomaticDesktopRail({ root: hidden, railList: { scrollHeight: 401, clientHeight: 400 }, viewportHeight: 500 });
  assert.equal(hidden.dataset.layoutMode, 'desktop');
});
