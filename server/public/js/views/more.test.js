import test from 'node:test';
import assert from 'node:assert/strict';

import { moreItemsForEvent } from './more.js';

test('general events expose remaining planning destinations directly in More', () => {
  const items = moreItemsForEvent({ eventType: 'general' });
  assert.equal(items.some((item) => item.section === 'orga'), false);
  assert.deepEqual(
    items.filter((item) => ['events', 'foodOrders'].includes(item.view)).map((item) => item.title),
    ['Events', 'Essen'],
  );
});

test('LAN events retain the existing Orga entry in More', () => {
  const items = moreItemsForEvent({ eventType: 'lan' });
  assert.equal(items.some((item) => item.section === 'orga' && item.title === 'Orga'), true);
  assert.equal(items.some((item) => item.view === 'events'), false);
  assert.equal(items.some((item) => item.view === 'foodOrders'), false);
});
