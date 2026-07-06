// Unit tests for the pure live-state derivation logic. This is the rule that
// decides playing / paused / offline, so it deserves direct coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveState, type LiveStatusRow } from './liveStatus';
import { config } from './config';

function row(partial: Partial<LiveStatusRow>): LiveStatusRow {
  return {
    player_id: 'p1',
    name: 'Test',
    color: '#fff',
    game_id: null,
    game_name: null,
    game_icon: null,
    since: null,
    last_seen: null,
    manual_note: null,
    ...partial,
  };
}

test('recent report with a game => playing', () => {
  const now = 1_000_000;
  const r = row({ game_id: 'g1', last_seen: now - 1_000 });
  assert.equal(deriveState(r, now), 'playing');
});

test('report just inside the timeout => still playing', () => {
  const now = 1_000_000;
  const r = row({ game_id: 'g1', last_seen: now - config.offlineTimeoutMs });
  assert.equal(deriveState(r, now), 'playing');
});

test('report older than the timeout => offline', () => {
  const now = 1_000_000;
  const r = row({ game_id: 'g1', last_seen: now - config.offlineTimeoutMs - 1 });
  assert.equal(deriveState(r, now), 'offline');
});

test('no game but a manual note => paused', () => {
  const now = 1_000_000;
  const r = row({ manual_note: 'Essen', last_seen: now - 1_000 });
  assert.equal(deriveState(r, now), 'paused');
});

test('stale game but a manual note => paused (note wins over offline)', () => {
  const now = 1_000_000;
  const r = row({
    game_id: 'g1',
    last_seen: now - config.offlineTimeoutMs - 5_000,
    manual_note: 'Pause',
  });
  assert.equal(deriveState(r, now), 'paused');
});

test('nothing reported at all => offline', () => {
  assert.equal(deriveState(row({}), 1_000_000), 'offline');
});
