// The Broadcast screen may run on a signed-in account instead of its own
// token (a browser that is also logged into the app). The newsticker then
// has to resolve that account's active event like every other card instead
// of refusing the request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { db, DEFAULT_GROUP_ID } from '../db';
import { createEvent } from '../events';
import { generateNewstickerFeeds, getNewstickerFeed, resetNewstickerFeeds } from '../newsticker';

const app = createTestApp();

test('a signed-in account reads a full newsticker for its active event', async () => {
  resetNewstickerFeeds();
  const res = await request(app).get('/api/newsticker').set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.items.length, 10, 'a new feed starts with a full tile of lines');
  assert.ok(res.body.nextInMs >= 3 * 60_000 && res.body.nextInMs <= 10 * 60_000);
  const ids = res.body.items.map((item: { id: string }) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'every line of the start set is distinct');
  const ages = res.body.items.map((item: { createdAt: number }) => item.createdAt);
  assert.ok(ages.every((age: number, index: number) => index === 0 || age < ages[index - 1]), 'initial lines have staggered ages');
});

test('the server sweep advances a LAN feed without a Broadcast request', () => {
  resetNewstickerFeeds();
  const now = Date.now();
  const event = createEvent('Background ticker LAN', {
    groupId: DEFAULT_GROUP_ID,
    startsAt: now,
    endsAt: now + 24 * 60 * 60_000,
    eventTypeKey: 'lan',
  });
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(event.id, TEST_ADMIN_ID);

  generateNewstickerFeeds(now);
  const initial = getNewstickerFeed(DEFAULT_GROUP_ID, event.id, now);
  assert.equal(initial.items.length, 10);
  assert.ok(initial.items[0].id.endsWith(':-1'));

  const later = now + 11 * 60_000;
  generateNewstickerFeeds(later);
  const advanced = getNewstickerFeed(DEFAULT_GROUP_ID, event.id, later);
  assert.ok(advanced.items[0].id.endsWith(':1'), 'the sweep generated the next line before a screen requested it');
  assert.equal(advanced.items[0].createdAt, later);
});
