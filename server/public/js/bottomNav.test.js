import test from 'node:test';
import assert from 'node:assert/strict';

import { bottomNavItemsForEvent } from './bottomNav.js';

test('LAN events keep the established bottom navigation', () => {
  assert.deepEqual(
    bottomNavItemsForEvent({ eventType: 'lan' }).map((item) => item.view),
    ['home', 'matchmaking', 'votes', 'foodOrders', 'gameCatalog', 'more'],
  );
  assert.equal(bottomNavItemsForEvent({ eventType: 'lan' })[3].id, 'nav-food-orders');
});

test('general events promote planning and polls into the bottom navigation', () => {
  const items = bottomNavItemsForEvent({ eventType: 'general' });
  assert.deepEqual(items.map((item) => item.view), [
    'home',
    'arrivals',
    'checklistPacking',
    'checklist',
    'eventPolls',
    'more',
  ]);
  assert.deepEqual(items.map((item) => item.label), [
    'Home',
    'An & Abreise',
    'Packliste',
    'To-Do',
    'Umfragen',
    'Mehr',
  ]);
  assert.equal(items.some((item) => item.id === 'nav-food-orders'), false);
});

test('missing and older event snapshots retain LAN-compatible navigation', () => {
  assert.deepEqual(
    bottomNavItemsForEvent(null).map((item) => item.view),
    ['home', 'matchmaking', 'votes', 'foodOrders', 'gameCatalog', 'more'],
  );
});
