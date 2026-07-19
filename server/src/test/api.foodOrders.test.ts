// Integration tests for Sammelbestellungen: open → everyone adds items →
// close → reopen/finalize lifecycle, per-player item ownership, price
// handling/summing, paypalLink, and the closed/finalized-order guards. The
// close-vs-add race itself is covered in api.concurrency.test.ts.

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

test('POST /api/food-orders validates title, player, sendAt, notes, link, paypalLink, and tipPercent', async () => {
  const noTitle = await request(app).post('/api/food-orders').send({ playerId: alice.id });
  assert.equal(noTitle.status, 400);
  const ghost = await request(app).post('/api/food-orders').send({ playerId: 'ghost', title: 'Pizza' });
  assert.equal(ghost.status, 404);
  const badSendAt = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', sendAt: 'not-a-timestamp' });
  assert.equal(badSendAt.status, 400);
  const badLink = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', link: 'javascript:alert(1)' });
  assert.equal(badLink.status, 400);
  const badPaypalLink = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', paypalLink: 'javascript:alert(1)' });
  assert.equal(badPaypalLink.status, 400);
  const tipTooHigh = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', tipPercent: 101 });
  assert.equal(tipTooHigh.status, 400);
  const tipNegative = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', tipPercent: -5 });
  assert.equal(tipNegative.status, 400);
  const tipNotInteger = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', tipPercent: 5.5 });
  assert.equal(tipNotInteger.status, 400);
  const tooLongNotes = await request(app)
    .post('/api/food-orders')
    .send({ playerId: alice.id, title: 'Pizza', notes: 'x'.repeat(501) });
  assert.equal(tooLongNotes.status, 400);
});

test('POST /api/food-orders opens an order, optionally with a send time, notes, link, paypalLink, and tipPercent', async () => {
  const res = await request(app).post('/api/food-orders').send({ playerId: alice.id, title: "Pizza bei Luigi's" });
  assert.equal(res.status, 201);
  assert.equal(res.body.open, true);
  assert.equal(res.body.createdByName, 'Hungrige Alice');
  assert.equal(res.body.sendAt, null);
  assert.equal(res.body.notes, null);
  assert.equal(res.body.link, null);
  assert.equal(res.body.paypalLink, null);
  assert.equal(res.body.tipPercent, null);
  assert.equal(res.body.finalizedAt, null);
  orderId = res.body.id;

  const sendAt = Date.now() + 3600_000;
  const withTime = await request(app)
    .post('/api/food-orders')
    .send({
      playerId: alice.id,
      title: 'Drinks-Run',
      sendAt,
      notes: 'Mindestbestellwert 15€, bar zahlen',
      link: 'https://luigis-pizza.example/karte',
      paypalLink: 'https://paypal.me/luigi',
      tipPercent: 10,
    });
  assert.equal(withTime.status, 201);
  assert.equal(withTime.body.sendAt, sendAt);
  assert.equal(withTime.body.notes, 'Mindestbestellwert 15€, bar zahlen');
  assert.equal(withTime.body.link, 'https://luigis-pizza.example/karte');
  assert.equal(withTime.body.paypalLink, 'https://paypal.me/luigi');
  assert.equal(withTime.body.tipPercent, 10);
});

test('PATCH /api/food-orders/:id sets, updates and clears send time, notes, link, paypalLink, and tipPercent independently', async () => {
  const sendAt = Date.now() + 1800_000;
  const set = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt });
  assert.equal(set.status, 200);
  assert.equal(set.body.sendAt, sendAt);

  const laterSendAt = sendAt + 900_000;
  const changed = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt: laterSendAt });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.sendAt, laterSendAt);

  const withNotesAndLink = await request(app)
    .patch(`/api/food-orders/${orderId}`)
    .send({
      notes: 'Bitte bar mitbringen',
      link: 'https://luigis-pizza.example',
      paypalLink: 'https://paypal.me/alice',
      tipPercent: 15,
    });
  assert.equal(withNotesAndLink.status, 200);
  assert.equal(withNotesAndLink.body.notes, 'Bitte bar mitbringen');
  assert.equal(withNotesAndLink.body.link, 'https://luigis-pizza.example');
  assert.equal(withNotesAndLink.body.paypalLink, 'https://paypal.me/alice');
  assert.equal(withNotesAndLink.body.tipPercent, 15);
  // sendAt untouched by a request that only mentions notes/link/paypalLink/tipPercent.
  assert.equal(withNotesAndLink.body.sendAt, laterSendAt);

  const cleared = await request(app)
    .patch(`/api/food-orders/${orderId}`)
    .send({ sendAt: null, notes: null, link: null, paypalLink: null, tipPercent: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.sendAt, null);
  assert.equal(cleared.body.notes, null);
  assert.equal(cleared.body.link, null);
  assert.equal(cleared.body.paypalLink, null);
  assert.equal(cleared.body.tipPercent, null);

  const invalidSendAt = await request(app).patch(`/api/food-orders/${orderId}`).send({ sendAt: 'garbage' });
  assert.equal(invalidSendAt.status, 400);

  const invalidLink = await request(app).patch(`/api/food-orders/${orderId}`).send({ link: 'not-a-url' });
  assert.equal(invalidLink.status, 400);

  const invalidPaypalLink = await request(app).patch(`/api/food-orders/${orderId}`).send({ paypalLink: 'not-a-url' });
  assert.equal(invalidPaypalLink.status, 400);

  const invalidTipPercent = await request(app).patch(`/api/food-orders/${orderId}`).send({ tipPercent: 200 });
  assert.equal(invalidTipPercent.status, 400);

  const missing = await request(app).patch('/api/food-orders/nope').send({ sendAt });
  assert.equal(missing.status, 404);
});

test('items: quantities multiply unit prices, totals sum up, and price is optional', async () => {
  const a = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: alice.id, description: 'Margherita groß', quantity: 2, priceCents: 950 });
  assert.equal(a.status, 201);
  assert.equal(a.body.items[0].quantity, 2);
  assert.equal(a.body.totalCents, 1900);
  aliceItemId = a.body.items[0].id;

  const badPrice = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: '1x Salami', priceCents: -5 });
  assert.equal(badPrice.status, 400);

  const badQuantity = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: 'Salami', quantity: 0, priceCents: 1050 });
  assert.equal(badQuantity.status, 400);

  const b = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: '1x Salami' }); // no price
  assert.equal(b.status, 201);
  assert.equal(b.body.items.length, 2);
  assert.equal(b.body.totalCents, 1900);
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
  const readded = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: alice.id, description: 'Margherita groß', quantity: 2, priceCents: 950 });
  aliceItemId = readded.body.items.find((i: { playerId: string }) => i.playerId === alice.id).id;
});

test('PATCH /api/food-orders/:id/items/:itemId marks and unmarks an item as paid', async () => {
  const bad = await request(app).patch(`/api/food-orders/${orderId}/items/${aliceItemId}`).send({ paid: 'yes' });
  assert.equal(bad.status, 400);

  const missingOrder = await request(app).patch(`/api/food-orders/nope/items/${aliceItemId}`).send({ paid: true });
  assert.equal(missingOrder.status, 404);

  const missingItem = await request(app).patch(`/api/food-orders/${orderId}/items/nope`).send({ paid: true });
  assert.equal(missingItem.status, 404);

  const marked = await request(app).patch(`/api/food-orders/${orderId}/items/${aliceItemId}`).send({ paid: true });
  assert.equal(marked.status, 200);
  const markedItem = marked.body.items.find((i: { id: string }) => i.id === aliceItemId);
  assert.equal(markedItem.paid, true);

  const unmarked = await request(app).patch(`/api/food-orders/${orderId}/items/${aliceItemId}`).send({ paid: false });
  assert.equal(unmarked.status, 200);
  const unmarkedItem = unmarked.body.items.find((i: { id: string }) => i.id === aliceItemId);
  assert.equal(unmarkedItem.paid, false);
});

test('closing freezes the order: no more items, no second close', async () => {
  const close = await request(app).post(`/api/food-orders/${orderId}/close`);
  assert.equal(close.status, 200);
  assert.equal(close.body.open, false);
  assert.equal(close.body.totalCents, 1900);

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

test('items can still be marked paid after the order is closed (settling up happens afterwards)', async () => {
  const res = await request(app).patch(`/api/food-orders/${orderId}/items/${aliceItemId}`).send({ paid: true });
  assert.equal(res.status, 200);
  const item = res.body.items.find((i: { id: string }) => i.id === aliceItemId);
  assert.equal(item.paid, true);
});

test('reopening a closed order allows items to be added/removed again, then it can be closed again', async () => {
  const reopenMissing = await request(app).post('/api/food-orders/nope/reopen');
  assert.equal(reopenMissing.status, 404);

  const reopened = await request(app).post(`/api/food-orders/${orderId}/reopen`);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.open, true);

  const alreadyOpen = await request(app).post(`/api/food-orders/${orderId}/reopen`);
  assert.equal(alreadyOpen.status, 409);

  const added = await request(app)
    .post(`/api/food-orders/${orderId}/items`)
    .send({ playerId: bob.id, description: 'Vergessene Cola' });
  assert.equal(added.status, 201);
  assert.equal(added.body.items.length, 3);
  const newItemId = added.body.items.find((i: { description: string }) => i.description === 'Vergessene Cola').id;

  const removed = await request(app)
    .delete(`/api/food-orders/${orderId}/items/${newItemId}`)
    .send({ playerId: bob.id });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.items.length, 2);

  const closedAgain = await request(app).post(`/api/food-orders/${orderId}/close`);
  assert.equal(closedAgain.status, 200);
  assert.equal(closedAgain.body.open, false);
  assert.equal(closedAgain.body.totalCents, 1900);
});

test('the send time, notes, and link stay editable after the order is closed (only items are frozen)', async () => {
  const sendAt = Date.now() + 600_000;
  const res = await request(app)
    .patch(`/api/food-orders/${orderId}`)
    .send({ sendAt, notes: 'Doch erst um 22 Uhr', link: 'https://luigis-pizza.example/neu' });
  assert.equal(res.status, 200);
  assert.equal(res.body.sendAt, sendAt);
  assert.equal(res.body.notes, 'Doch erst um 22 Uhr');
  assert.equal(res.body.link, 'https://luigis-pizza.example/neu');
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

test('finalize requires the order to be closed first, and rejects an unknown order', async () => {
  const missing = await request(app).post('/api/food-orders/nope/finalize');
  assert.equal(missing.status, 404);

  const fresh = await request(app).post('/api/food-orders').send({ playerId: alice.id, title: 'Noch offen' });
  const notYetClosed = await request(app).post(`/api/food-orders/${fresh.body.id}/finalize`);
  assert.equal(notYetClosed.status, 409);
});

test('finalizing permanently locks the order: no reopen, items, paid or metadata changes, and no re-finalizing', async () => {
  const created = await request(app).post('/api/food-orders').send({ playerId: alice.id, title: 'Getränke-Runde' });
  const finalizeOrderId = created.body.id;
  const item = await request(app)
    .post(`/api/food-orders/${finalizeOrderId}/items`)
    .send({ playerId: bob.id, description: 'Cola', priceCents: 200 });
  const itemId = item.body.items[0].id;

  await request(app).post(`/api/food-orders/${finalizeOrderId}/close`);

  const finalized = await request(app).post(`/api/food-orders/${finalizeOrderId}/finalize`);
  assert.equal(finalized.status, 200);
  assert.ok(finalized.body.finalizedAt);

  const reopenAfterFinalize = await request(app).post(`/api/food-orders/${finalizeOrderId}/reopen`);
  assert.equal(reopenAfterFinalize.status, 409);

  const addAfterFinalize = await request(app)
    .post(`/api/food-orders/${finalizeOrderId}/items`)
    .send({ playerId: bob.id, description: 'Zu spät' });
  assert.equal(addAfterFinalize.status, 409);

  const paidAfterFinalize = await request(app)
    .patch(`/api/food-orders/${finalizeOrderId}/items/${itemId}`)
    .send({ paid: true });
  assert.equal(paidAfterFinalize.status, 409);

  const metadataAfterFinalize = await request(app)
    .patch(`/api/food-orders/${finalizeOrderId}`)
    .send({ notes: 'zu spät', tipPercent: 20 });
  assert.equal(metadataAfterFinalize.status, 409);

  const secondFinalize = await request(app).post(`/api/food-orders/${finalizeOrderId}/finalize`);
  assert.equal(secondFinalize.status, 409);
});
