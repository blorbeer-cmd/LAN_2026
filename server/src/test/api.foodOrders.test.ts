// Integration tests for Sammelbestellungen: open → everyone adds items →
// close lifecycle, per-player item ownership, price handling/summing, and
// the closed-order guards. The close-vs-add race itself is covered in
// api.concurrency.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

let alice: { id: string };
let bob: { id: string };
let orderId: string;
let aliceItemId: string;

test('setup: two players', async () => {
  alice = (await request(app).post('/api/players').send({ name: 'Hungrige Alice' })).body;
  bob = (await request(app).post('/api/players').send({ name: 'Hungriger Bob' })).body;
});

test('POST /api/food-orders validates title, player, and sendAt', async () => {
  const noTitle = await request(app).post('/api/food-orders').send({ playerId: alice.id });
  assert.equal(noTitle.status, 400);
  const ghost = await request(app).post('/api/food-orders').send({ playerId: 'ghost', title: 'Pizza' });
  assert.equal(ghost.status, 404);
  const badSendAt = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', sendAt: 'not-a-timestamp' });
  assert.equal(badSendAt.status, 400);
});

test('POST /api/food-orders opens an order, optionally with a send time', async () => {
  const res = await request(app).post('/api/food-orders').send({ playerId: alice.id, title: "Pizza bei Luigi's" });
  assert.equal(res.status, 201);
  assert.equal(res.body.open, true);
  assert.equal(res.body.createdByName, 'Hungrige Alice');
  assert.equal(res.body.sendAt, null);
  orderId = res.body.id;

  const sendAt = Date.now() + 3600_000;
  const withTime = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Drinks-Run', sendAt });
  assert.equal(withTime.status, 201);
  assert.equal(withTime.body.sendAt, sendAt);
});

test('PATCH /api/food-orders/:id sets, updates and clears the send time', async () => {
  const sendAt = Date.now() + 1800_000;
  const set = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt });
  assert.equal(set.status, 200);
  assert.equal(set.body.sendAt, sendAt);

  const laterSendAt = sendAt + 900_000;
  const changed = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt: laterSendAt });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.sendAt, laterSendAt);

  const cleared = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.sendAt, null);

  const invalid = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt: 'garbage' });
  assert.equal(invalid.status, 400);

  const missing = await request(app).patch('/api/food-orders/nope').send({ sendAt });
  assert.equal(missing.status, 404);
});

test('items: everyone adds their own, prices sum up, price is optional', async () => {
  const a = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: alice.id, description: '1x Margherita groß', priceCents: 950 });
  assert.equal(a.status, 201);
  aliceItemId = a.body.items[0].id;

  const badPrice = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: '1x Salami', priceCents: -5 });
  assert.equal(badPrice.status, 400);

  const b = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: '1x Salami' }); // no price
  assert.equal(b.status, 201);
  assert.equal(b.body.items.length, 2);
  assert.equal(b.body.totalCents, 950);
});

test('players can only remove their own items, and only while open', async () => {
  const notYours = await request(app)
    .delete(`/api/food-orders/${orderId}/items/${aliceItemId}`)
    .send({ playerId: bob.id });
  assert.equal(notYours.status, 403);

  const removed = await request(app)
    .delete(`/api/food-orders/${orderId}/items/${aliceItemId}`)
    .send({ playerId: alice.id });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.items.length, 1);

  // Re-add so the close test below has content.
  await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: alice.id, description: '1x Margherita groß', priceCents: 950 });
});

test('closing freezes the order: no more items, no second close', async () => {
  const close = await request(app).post(`/api/food-orders/${orderId}/close`);
  assert.equal(close.status, 200);
  assert.equal(close.body.open, false);
  assert.equal(close.body.totalCents, 950);

  const lateItem = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: 'noch was!' });
  assert.equal(lateItem.status, 409);

  const lateRemove = await request(app)
    .delete(`/api/food-orders/${orderId}/items/whatever`)
    .send({ playerId: alice.id });
  assert.equal(lateRemove.status, 409);

  const secondClose = await request(app).post(`/api/food-orders/${orderId}/close`);
  assert.equal(secondClose.status, 409);
});

test('the send time stays editable after the order is closed (only items are frozen)', async () => {
  const sendAt = Date.now() + 600_000;
  const res = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt });
  assert.equal(res.status, 200);
  assert.equal(res.body.sendAt, sendAt);
  assert.equal(res.body.open, false);
});

test('GET /api/food-orders lists orders with items grouped data', async () => {
  const res = await request(app).get('/api/food-orders');
  assert.equal(res.status, 200);
  const order = res.body.orders.find((o: { id: string }) => o.id === orderId);
  assert.ok(order);
  assert.equal(order.open, false);
  assert.equal(order.items.length, 2);
});
