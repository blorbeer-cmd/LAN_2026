import test from 'node:test';
import assert from 'node:assert/strict';

import { dismissAktuellItem, filterDismissedAktuellItems } from './aktuellStatus.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

const items = [
  { id: 'vote:7', title: 'Vote' },
  { id: 'arcade-lobby:quiz:lobby-1', title: 'Quiz' },
];

test('a dismissed current item stays hidden for the same identity and event', () => {
  const localStorage = storage();
  const options = { playerId: 'alice', eventId: 'lan-2026', storage: localStorage };

  assert.equal(dismissAktuellItem('vote:7', options), true);
  assert.deepEqual(filterDismissedAktuellItems(items, options), [items[1]]);

  const persisted = [...localStorage.values.values()].map((value) => JSON.parse(value));
  assert.deepEqual(persisted, [['vote:7']]);
});

test('dismissals do not hide the same lifecycle id for another identity or event', () => {
  const localStorage = storage();
  dismissAktuellItem('vote:7', { playerId: 'alice', eventId: 'lan-a', storage: localStorage });

  assert.deepEqual(
    filterDismissedAktuellItems(items, { playerId: 'bob', eventId: 'lan-a', storage: localStorage }),
    items,
  );
  assert.deepEqual(
    filterDismissedAktuellItems(items, { playerId: 'alice', eventId: 'lan-b', storage: localStorage }),
    items,
  );
});

test('blocked storage falls back to a safe session-local dismissal', () => {
  const blockedStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const options = { playerId: 'carol', eventId: 'lan-2026', storage: blockedStorage };

  assert.equal(dismissAktuellItem('arcade-lobby:quiz:lobby-1', options), true);
  assert.deepEqual(filterDismissedAktuellItems(items, options), [items[0]]);
});
