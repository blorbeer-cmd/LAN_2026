import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aktuellItems,
  FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS,
  foodOrderAktuellItem,
  missingSkillAktuellId,
} from './aktuellStatus.js';
import { state } from './state.js';

test('a later live occurrence yields a new missing-skill lifecycle id', () => {
  const firstLiveOccurrence = [
    { games: [{ game_id: 'cs2', since: 1_000 }] },
    { games: [{ game_id: 'cs2', since: 1_200 }] },
  ];
  const laterLiveOccurrence = [{ games: [{ game_id: 'cs2', since: 5_000 }] }];

  // The id names the earliest live start so a genuinely new play session gets
  // a distinct id and reappears as its own Aktuell entry.
  assert.equal(missingSkillAktuellId('cs2', firstLiveOccurrence), 'skill:cs2:1000');
  assert.equal(missingSkillAktuellId('cs2', laterLiveOccurrence), 'skill:cs2:5000');
  assert.equal(missingSkillAktuellId('cs2', []), null);
});

test('an unpaid order reuses its existing Home item instead of creating a duplicate', () => {
  const order = {
    id: 'order-1',
    title: 'Pizza',
    open: false,
    closedAt: 1_000,
    finalizedAt: null,
    items: [
      { playerId: 'alice', paid: false, quantity: 2 },
      { playerId: 'bob', paid: false },
    ],
  };
  const item = foodOrderAktuellItem(order, 'alice', 1_000 + FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS);
  assert.equal(item.id, 'food-order:order-1:payment');
  assert.equal(item.title, 'Sammelbestellung „Pizza" bezahlen');
  assert.equal(item.sub, '2 Positionen noch offen');
  assert.equal(
    foodOrderAktuellItem({ ...order, items: [{ playerId: 'alice', paid: true }] }, 'alice', 1_000 + FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS),
    null,
  );
});

test('a closed order stays out of the payment nudge until two hours after dispatch', () => {
  const closedAt = 10_000;
  const order = {
    id: 'order-3',
    title: 'Late Pizza',
    open: false,
    closedAt,
    finalizedAt: null,
    items: [{ playerId: 'alice', paid: false }],
  };
  assert.equal(foodOrderAktuellItem(order, 'alice', closedAt + FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS - 1), null);
  assert.equal(foodOrderAktuellItem(order, 'alice', closedAt + FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS)?.id, 'food-order:order-3:payment');
});

test('a pending event invitation surfaces as a personal nudge linking into the profile', () => {
  const previousInvitations = state.eventInvitations;
  state.eventInvitations = [{ id: 'event-1', name: 'Winter LAN' }];
  try {
    const invitationItem = aktuellItems().find((item) => item.id === 'event-invitation:event-1');
    assert.ok(invitationItem, 'the invitation must produce an Aktuell entry');
    assert.equal(invitationItem.title, 'Einladung: Winter LAN');
    // The card with Annehmen/Ablehnen lives only in Profile now (see events.js
    // and profile.js) — Home's own list just links there.
    assert.equal(invitationItem.navigate, 'profile');
  } finally {
    state.eventInvitations = previousInvitations;
  }
});

test('an open order without own unpaid items keeps the normal current entry', () => {
  const item = foodOrderAktuellItem(
    { id: 'order-2', title: 'Drinks', open: true, closedAt: null, finalizedAt: null, sendAt: 123, items: [] },
    'alice',
  );
  assert.equal(item.id, 'food-order:order-2');
  assert.equal(item.title, 'Sammelbestellung „Drinks"');
  assert.match(item.sub, /Versand/);
});
