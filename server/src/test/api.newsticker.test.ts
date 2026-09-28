// The Broadcast screen may run on a signed-in account instead of its own
// token (a browser that is also logged into the app). The newsticker then
// has to resolve that account's active event like every other card instead
// of refusing the request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { resetNewstickerFeeds } from '../newsticker';

const app = createTestApp();

test('a signed-in account reads a full newsticker for its active event', async () => {
  resetNewstickerFeeds();
  const res = await request(app).get('/api/newsticker').set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.items.length, 10, 'a new feed starts with a full tile of lines');
  assert.ok(res.body.nextInMs >= 3 * 60_000 && res.body.nextInMs <= 10 * 60_000);
  const ids = res.body.items.map((item: { id: string }) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'every line of the start set is distinct');
});
