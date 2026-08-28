import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bottomNavItemsForEvent,
  desktopNavItemsForEvent,
  desktopNavTargetForView,
} from './bottomNav.js';

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

test('wide desktop exposes grouped direct destinations without a More duplicate', () => {
  const navigation = desktopNavItemsForEvent({ eventType: 'lan' }, { isAdmin: true });
  assert.deepEqual(navigation.groups.map((group) => group.label), ['', 'LAN', 'Orga', 'Sonstiges']);
  assert.deepEqual(
    navigation.groups.map((group) => group.entries.map((entry) => entry.view)),
    [
      ['home'],
      ['matchmaking', 'votes', 'gameCatalog'],
      ['events', 'eventPolls', 'arrivals', 'checklistPacking', 'checklist', 'foodOrders'],
      ['broadcast', 'arcade', 'music'],
    ],
  );
  assert.deepEqual(
    navigation.utilities.map((entry) => entry.action ?? entry.view),
    ['feedback', 'admin', 'profile'],
  );
  assert.deepEqual(
    navigation.groups.flatMap((group) => group.entries.map((entry) => entry.iconKey)),
    [
      'home',
      'competition',
      'votes',
      'gameCatalog',
      'events',
      'eventPolls',
      'arrivals',
      'checklistPacking',
      'checklist',
      'foodOrders',
      'broadcast',
      'arcade',
      'music',
    ],
  );
  assert.equal(navigation.groups.some((group) => group.entries.some((entry) => entry.view === 'more')), false);
});

test('desktop navigation remains feature- and role-aware', () => {
  const event = { eventType: 'general', enabledFeatures: ['tasks', 'travel'] };
  const navigation = desktopNavItemsForEvent(event);
  assert.deepEqual(navigation.groups.map((group) => group.label), ['', 'Orga', 'Sonstiges']);
  assert.deepEqual(
    navigation.groups.flatMap((group) => group.entries.map((entry) => entry.view)),
    ['home', 'events', 'eventPolls', 'arrivals', 'checklistPacking', 'checklist', 'broadcast'],
  );
  assert.deepEqual(navigation.utilities.map((entry) => entry.action ?? entry.view), ['feedback', 'profile']);
});

test('desktop child routes highlight their stable parent destination', () => {
  assert.equal(desktopNavTargetForView('tournaments'), 'matchmaking');
  assert.equal(desktopNavTargetForView('quizRoom'), 'arcade');
  assert.equal(desktopNavTargetForView('analytics'), 'admin');
  assert.equal(desktopNavTargetForView('myStats'), 'profile');
  assert.equal(desktopNavTargetForView('eventPolls'), 'eventPolls');
});
