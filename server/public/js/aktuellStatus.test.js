import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dismissAktuellItem,
  foodOrderAktuellItem,
  filterDismissedAktuellItems,
  missingSkillAktuellId,
} from './aktuellStatus.js';

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

test('a later live occurrence restores a dismissed missing-skill nudge', () => {
  const firstLiveOccurrence = [
    { games: [{ game_id: 'cs2', since: 1_000 }] },
    { games: [{ game_id: 'cs2', since: 1_200 }] },
  ];
  const laterLiveOccurrence = [{ games: [{ game_id: 'cs2', since: 5_000 }] }];
  const firstId = missingSkillAktuellId('cs2', firstLiveOccurrence);
  const laterId = missingSkillAktuellId('cs2', laterLiveOccurrence);
  const options = { playerId: 'dora', eventId: 'lan-2026', storage: storage() };

  assert.equal(firstId, 'skill:cs2:1000');
  assert.equal(laterId, 'skill:cs2:5000');
  assert.equal(missingSkillAktuellId('cs2', []), null);
  assert.equal(dismissAktuellItem(firstId, options), true);
  assert.deepEqual(filterDismissedAktuellItems([{ id: firstId }], options), []);
  assert.deepEqual(filterDismissedAktuellItems([{ id: laterId }], options), [{ id: laterId }]);
});

test('an unpaid order reuses its existing Home item instead of creating a duplicate', () => {
  const order = {
    id: 'order-1',
    title: 'Pizza',
    open: false,
    finalizedAt: null,
    items: [
      { playerId: 'alice', paid: false },
      { playerId: 'bob', paid: false },
    ],
  };
  const item = foodOrderAktuellItem(order, 'alice');
  assert.equal(item.id, 'food-order:order-1');
  assert.equal(item.title, 'Sammelbestellung „Pizza" bezahlen');
  assert.equal(item.sub, '1 Position noch offen');
  assert.equal(foodOrderAktuellItem({ ...order, items: [{ playerId: 'alice', paid: true }] }, 'alice'), null);
});

test('an open order without own unpaid items keeps the normal current entry', () => {
  const item = foodOrderAktuellItem(
    { id: 'order-2', title: 'Drinks', open: true, finalizedAt: null, sendAt: 123, items: [] },
    'alice',
  );
  assert.equal(item.id, 'food-order:order-2');
  assert.equal(item.title, 'Sammelbestellung „Drinks"');
  assert.match(item.sub, /Versand/);
});
