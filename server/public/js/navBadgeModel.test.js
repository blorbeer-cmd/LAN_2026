import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_WORKSPACE_ID,
  SEEN_TODO_LIMIT,
  countForBottomNav,
  countForDesktopNav,
  countForMoreCard,
  itemsSeenByOpening,
  navBadgeItems,
  navBadgeLabel,
  navBadgeText,
  rememberSeenTodoIds,
  unseenNavBadgeItems,
} from './navBadgeModel.js';

const NOW = Date.UTC(2026, 10, 22, 12);
const LAN = { eventType: 'lan' };

function feed(id, url, extra = {}) {
  return { id, url, eventId: 'lan', seen: false, resolvedAt: null, expiresAt: null, ...extra };
}

test('only unread, active notifications of the open workspace count', () => {
  const items = navBadgeItems({
    feedEntries: [
      feed('vote', '/#votes'),
      feed('read', '/#votes', { seen: true }),
      feed('resolved', '/#votes', { resolvedAt: NOW - 1 }),
      feed('expired', '/#votes', { expiresAt: NOW - 1 }),
      feed('other-event', '/#votes', { eventId: 'summer' }),
      feed('invitation', '/#profile', { eventId: BASE_WORKSPACE_ID }),
      feed('no-target', '/'),
    ],
    activeEventId: 'lan',
    now: NOW,
  });
  assert.deepEqual(items.map((item) => [item.id, item.view]), [
    ['feed:vote', 'votes'],
    ['feed:invitation', 'profile'],
  ]);
});

test('To-Dos of another workspace stay off the navigation; missing ballots count on Vote', () => {
  const items = navBadgeItems({
    todoRows: [
      { id: 'food-payment:o1', switchesEvent: false, navigate: { view: 'foodOrders' } },
      { id: 'food-payment:o2', switchesEvent: true, navigate: { view: 'foodOrders' } },
      null,
    ],
    pendingVotes: [3],
    activeEventId: 'lan',
  });
  assert.deepEqual(items.map((item) => [item.id, item.view]), [
    ['todo:food-payment:o1', 'foodOrders'],
    ['todo:vote-ballot:lan:3', 'votes'],
  ]);
});

test('an unread Vote announcement and the missing ballot of that round count once', () => {
  const announced = navBadgeItems({ feedEntries: [feed('vote', '/#votes')], pendingVotes: [3], activeEventId: 'lan', now: NOW });
  assert.deepEqual(announced.map((item) => item.id), ['feed:vote']);
  const read = navBadgeItems({ feedEntries: [feed('vote', '/#votes', { seen: true })], pendingVotes: [3], activeEventId: 'lan', now: NOW });
  assert.deepEqual(read.map((item) => item.id), ['todo:vote-ballot:lan:3']);
});

test('counters land on the entry that leads to their area', () => {
  const items = navBadgeItems({
    feedEntries: [feed('t', '/#tournaments/t1'), feed('c', '/#checklist')],
    todoRows: [
      { id: 'task:1', switchesEvent: false, navigate: { view: 'checklist' } },
      { id: 'arrival:lan', switchesEvent: false, navigate: { view: 'arrivals' } },
    ],
    activeEventId: 'lan',
    now: NOW,
  });
  // A tournament lives inside Match; Orga's pages sit behind "Mehr".
  assert.equal(countForBottomNav(items, 'matchmaking', LAN), 1);
  assert.equal(countForBottomNav(items, 'more', LAN), 3);
  assert.equal(countForBottomNav(items, 'votes', LAN), 0);
  assert.equal(countForDesktopNav(items, 'matchmaking'), 1);
  assert.equal(countForDesktopNav(items, 'checklist'), 2);
  // The Orga card on "Mehr" stands for To-Do and An & Abreise together.
  assert.equal(countForMoreCard(items, 'checklist'), 3);
});

test('opening an area settles its items; the "Mehr" hub settles none', () => {
  const items = [
    { id: 'feed:t', kind: 'feed', entryId: 't', view: 'tournaments' },
    { id: 'todo:task:1', kind: 'todo', view: 'checklist' },
  ];
  assert.deepEqual(itemsSeenByOpening(items, 'matchmaking').map((item) => item.id), ['feed:t']);
  assert.deepEqual(itemsSeenByOpening(items, 'checklist').map((item) => item.id), ['todo:task:1']);
  assert.deepEqual(itemsSeenByOpening(items, 'more'), []);
  assert.deepEqual(unseenNavBadgeItems(items, new Set(['todo:task:1'])).map((item) => item.id), ['feed:t']);
});

test('the seen list stays bounded and keeps the newest ids', () => {
  const old = Array.from({ length: SEEN_TODO_LIMIT }, (_, index) => `todo:${index}`);
  const next = rememberSeenTodoIds(old, ['todo:new', 'todo:0']);
  assert.equal(next.length, SEEN_TODO_LIMIT);
  assert.deepEqual(next.slice(-2), ['todo:new', 'todo:0']);
  assert.ok(!next.includes('todo:1'));
});

test('counter text caps at 9+ and the accessible name carries the count', () => {
  assert.equal(navBadgeText(3), '3');
  assert.equal(navBadgeText(12), '9+');
  assert.equal(navBadgeLabel('Abstimmung', 2), 'Abstimmung, 2 neu');
  assert.equal(navBadgeLabel('Abstimmung', 0), 'Abstimmung');
});
