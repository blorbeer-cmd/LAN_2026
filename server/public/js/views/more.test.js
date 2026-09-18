import test from 'node:test';
import assert from 'node:assert/strict';

import { moreItemsForEvent } from './more.js';

test('general events expose remaining planning destinations directly in More', () => {
  const items = moreItemsForEvent({ eventType: 'general' });
  assert.equal(items.some((item) => item.section === 'orga'), false);
  assert.deepEqual(
    items.filter((item) => ['events', 'foodOrders'].includes(item.view)).map((item) => item.title),
    ['Events & Gruppen', 'Essen'],
  );
});

// Workspace management is one level above organising work inside a workspace,
// so it leads the hub for every event type instead of hiding in Orga.
test('every event type reaches workspace management first in More', () => {
  for (const eventType of ['lan', 'general', 'group']) {
    const items = moreItemsForEvent({ eventType });
    assert.equal(items[0].view, 'events', eventType);
    assert.equal(items[0].title, 'Events & Gruppen', eventType);
  }
});

test('LAN events retain the existing Orga entry in More', () => {
  const items = moreItemsForEvent({ eventType: 'lan' });
  assert.equal(items.some((item) => item.section === 'orga' && item.title === 'Orga'), true);
  assert.equal(items.some((item) => item.view === 'foodOrders'), false);
});

// Match and Vote occupy the game-night slots in a group, so its remaining
// planning routes stay together behind the shared Orga entry.
test('groups keep their planning routes in the Orga wrapper', () => {
  const items = moreItemsForEvent({ eventType: 'group' });
  assert.equal(items.some((item) => item.section === 'orga' && item.title === 'Orga'), true);
});
