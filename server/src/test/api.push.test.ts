// Integration tests for Web Push subscription management and the
// notify-hooks that fire real push notifications alongside the existing
// socket toasts. `pushTransport.send` is stubbed so tests never make a real
// network call to a push service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { pushTransport } from '../push';

const app = createApp();
let playerId: string;

test('setup: a player', async () => {
  const p = await request(app).post('/api/players').send({ name: 'Push Tester' });
  playerId = p.body.id;
});

test('GET /api/push/vapid-public-key returns a key', async () => {
  const res = await request(app).get('/api/push/vapid-public-key');
  assert.equal(res.status, 200);
  assert.ok(res.body.publicKey && res.body.publicKey.length > 0);
});

test('POST /api/push/subscribe rejects a missing playerId', async () => {
  const res = await request(app)
    .post('/api/push/subscribe')
    .send({ subscription: { endpoint: 'https://example.com/x', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(res.status, 400);
});

test('POST /api/push/subscribe rejects an unknown player', async () => {
  const res = await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId: 'ghost',
      subscription: { endpoint: 'https://example.com/x', keys: { p256dh: 'a', auth: 'b' } },
    });
  assert.equal(res.status, 404);
});

test('POST /api/push/subscribe rejects a malformed subscription', async () => {
  const res = await request(app).post('/api/push/subscribe').send({ playerId, subscription: { endpoint: 'x' } });
  assert.equal(res.status, 400);
});

test('POST /api/push/subscribe stores a valid subscription', async () => {
  const res = await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId,
      subscription: { endpoint: 'https://push.example.com/sub-1', keys: { p256dh: 'p-key', auth: 'a-key' } },
    });
  assert.equal(res.status, 201);
});

test('starting a new vote round pushes to subscribed players', async (t) => {
  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app).post('/api/votes/start');
  await request(app).post('/api/votes/cancel'); // leave votes clean for other test files

  assert.equal(sendMock.mock.calls.length, 1);
  const [subscription, payloadJson] = sendMock.mock.calls[0]!.arguments;
  assert.equal((subscription as { endpoint: string }).endpoint, 'https://push.example.com/sub-1');
  const payload = JSON.parse(payloadJson as string);
  assert.match(payload.title, /Abstimmung/);
});

test('a subscription that comes back as gone (410) is pruned', async (t) => {
  t.mock.method(pushTransport, 'send', async () => {
    const err = new Error('gone') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  });

  await request(app).post('/api/votes/start');
  // Give the fire-and-forget rejection handler a tick to run.
  await new Promise((r) => setTimeout(r, 20));
  await request(app).post('/api/votes/cancel');

  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app).post('/api/votes/start');
  await request(app).post('/api/votes/cancel');
  assert.equal(sendMock.mock.calls.length, 0, 'expired subscription should have been removed');
});

test('POST /api/push/unsubscribe requires an endpoint', async () => {
  const res = await request(app).post('/api/push/unsubscribe');
  assert.equal(res.status, 400);
});

test('POST /api/push/unsubscribe removes a subscription', async (t) => {
  await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId,
      subscription: { endpoint: 'https://push.example.com/sub-2', keys: { p256dh: 'p', auth: 'a' } },
    });

  const res = await request(app).post('/api/push/unsubscribe').send({ endpoint: 'https://push.example.com/sub-2' });
  assert.equal(res.status, 204);

  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app).post('/api/votes/start');
  await request(app).post('/api/votes/cancel');
  assert.equal(sendMock.mock.calls.length, 0);
});
