// Unit tests for the pure live-state derivation logic. This is the rule that
// decides playing / paused / offline, so it deserves direct coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveState } from './liveStatus';
import { config } from './config';

test('recent report with an active game => playing', () => {
  const now = 1_000_000;
  const state = deriveState({ last_seen: now - 1_000, manual_note: null, activeGamesCount: 1 }, now);
  assert.equal(state, 'playing');
});

test('recent report with several active games => playing', () => {
  const now = 1_000_000;
  const state = deriveState({ last_seen: now - 1_000, manual_note: null, activeGamesCount: 2 }, now);
  assert.equal(state, 'playing');
});

test('report just inside the timeout => still playing', () => {
  const now = 1_000_000;
  const state = deriveState(
    { last_seen: now - config.offlineTimeoutMs, manual_note: null, activeGamesCount: 1 },
    now
  );
  assert.equal(state, 'playing');
});

test('report older than the timeout => offline', () => {
  const now = 1_000_000;
  const state = deriveState(
    { last_seen: now - config.offlineTimeoutMs - 1, manual_note: null, activeGamesCount: 1 },
    now
  );
  assert.equal(state, 'offline');
});

test('no active games but a manual note => paused', () => {
  const now = 1_000_000;
  const state = deriveState({ last_seen: now - 1_000, manual_note: 'Essen', activeGamesCount: 0 }, now);
  assert.equal(state, 'paused');
});

test('stale report but a manual note => paused (note wins over offline)', () => {
  const now = 1_000_000;
  const state = deriveState(
    { last_seen: now - config.offlineTimeoutMs - 5_000, manual_note: 'Pause', activeGamesCount: 1 },
    now
  );
  assert.equal(state, 'paused');
});

test('recent report with an active game but a manual note => paused (manual pause wins while still playing)', () => {
  const now = 1_000_000;
  const state = deriveState({ last_seen: now - 1_000, manual_note: 'Pause / Essen', activeGamesCount: 1 }, now);
  assert.equal(state, 'paused');
});

test('nothing reported at all => offline', () => {
  const state = deriveState({ last_seen: null, manual_note: null, activeGamesCount: 0 }, 1_000_000);
  assert.equal(state, 'offline');
});
