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
  pruneSeenTodoIds,
  rememberSeenTodoIds,
  settleOpenedArea,
  todoIdsSettledBy,
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
      // The base workspace's own Vote belongs to that workspace, not to this one.
      feed('base-vote', '/#votes', { eventId: BASE_WORKSPACE_ID, targetId: 'vote:20' }),
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

test('an unread Vote announcement stands only for the missing ballot of its own round', () => {
  const announced = navBadgeItems({
    feedEntries: [feed('vote', '/#votes', { targetId: 'vote:1' })],
    pendingVotes: [1, 2],
    activeEventId: 'lan',
    now: NOW,
  });
  assert.deepEqual(announced.map((item) => item.id), ['feed:vote', 'todo:vote-ballot:lan:2']);
  const read = navBadgeItems({
    feedEntries: [feed('vote', '/#votes', { targetId: 'vote:1', seen: true })],
    pendingVotes: [1],
    activeEventId: 'lan',
    now: NOW,
  });
  assert.deepEqual(read.map((item) => item.id), ['todo:vote-ballot:lan:1']);
});

test('a pending invitation and its notification count once and settle together', () => {
  const invitation = feed('inv', '/#events/e1', { eventId: BASE_WORKSPACE_ID, targetId: 'event-invitation:e1:me' });
  const row = { id: 'event-invitation:e1', switchesEvent: false, navigate: { view: 'events' } };
  const items = navBadgeItems({ feedEntries: [invitation], todoRows: [row], activeEventId: 'lan', now: NOW });
  assert.deepEqual(items.map((item) => item.id), ['feed:inv']);
  assert.equal(countForMoreCard(items, 'events'), 1);
  // Opening the area reads the notification and also settles the To-Do it
  // stood for, so the count does not reappear once the notification is read.
  assert.deepEqual(todoIdsSettledBy(itemsSeenByOpening(items, 'events')), ['todo:event-invitation:e1']);
});

test('a betting round counts on Match and is settled by Match or by its own link only', () => {
  const items = navBadgeItems({
    feedEntries: [feed('bet1', '/?eventId=lan#points/round/r1'), feed('bet2', '/?eventId=lan#points/round/r2')],
    activeEventId: 'lan',
    now: NOW,
  });
  assert.equal(countForBottomNav(items, 'matchmaking', LAN), 2);
  assert.equal(countForBottomNav(items, 'more', LAN), 0);
  assert.equal(countForDesktopNav(items, 'matchmaking'), 2);
  assert.equal(countForDesktopNav(items, 'points'), 0);
  assert.deepEqual(itemsSeenByOpening(items, 'matchmaking').map((item) => item.id), ['feed:bet1', 'feed:bet2']);
  assert.deepEqual(itemsSeenByOpening(items, 'points', { kind: 'round', id: 'r1' }).map((item) => item.id), ['feed:bet1']);
  assert.deepEqual(itemsSeenByOpening(items, 'points'), [], 'the points overview opens no particular round');
});

test('a To-Do that closes and opens again counts again', () => {
  // Seen while open, then the task is done: the next full list drops it.
  const seen = ['todo:task:1', 'todo:vote-ballot:summer:4', 'todo:vote-ballot:lan:2'];
  const afterClose = pruneSeenTodoIds(seen, [], 'lan');
  assert.deepEqual(afterClose, ['todo:vote-ballot:summer:4'], 'another workspace\'s ballots stay remembered');
  // Reopened with the same id, it is unseen again.
  const items = navBadgeItems({ todoRows: [{ id: 'task:1', switchesEvent: false, navigate: { view: 'checklist' } }], activeEventId: 'lan' });
  assert.deepEqual(unseenNavBadgeItems(items, new Set(afterClose)).map((item) => item.id), ['todo:task:1']);
  // Still open: the mark is kept.
  assert.deepEqual(pruneSeenTodoIds(['todo:task:1'], ['todo:task:1'], 'lan'), ['todo:task:1']);
});

test('opening an area waits for the feed and the workspace before reading notifications', () => {
  const items = [{ id: 'feed:v', kind: 'feed', entryId: 'v', view: 'votes' }];
  assert.deepEqual(
    settleOpenedArea({ pendingView: 'votes', openView: 'votes', feedReady: false, items: [] }),
    { feedEntryIds: [], pendingView: 'votes' },
    'not ready yet: the visit stays pending instead of being used up',
  );
  assert.deepEqual(
    settleOpenedArea({ pendingView: 'votes', openView: 'votes', feedReady: true, items }),
    { feedEntryIds: ['v'], pendingView: null },
  );
  assert.deepEqual(
    settleOpenedArea({ pendingView: 'votes', openView: 'home', feedReady: true, items }),
    { feedEntryIds: [], pendingView: null },
    'a visit the reader has already left settles nothing',
  );
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
