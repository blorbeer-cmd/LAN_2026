// Integration tests for "Jetzt zocken" pings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let gameId: string;
let playerA: string;
let playerB: string;

test('setup: a game and two players', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Ping Test Game' });
  gameId = game.body.id;
  const a = await request(app).post('/api/players').send({ name: 'Ping Alice' });
  const b = await request(app).post('/api/players').send({ name: 'Ping Bob' });
  playerA = a.body.id;
  playerB = b.body.id;
});

test('GET /api/pings starts empty', async () => {
  const res = await request(app).get('/api/pings');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.pings, []);
});

test('POST /api/pings rejects an unknown player or game', async () => {
  const badPlayer = await request(app).post('/api/pings').send({ playerId: 'ghost', gameId });
  assert.equal(badPlayer.status, 404);
  const badGame = await request(app).post('/api/pings').send({ playerId: playerA, gameId: 'ghost' });
  assert.equal(badGame.status, 404);
});

test('POST /api/pings rejects an out-of-range expiresInMinutes', async () => {
  const res = await request(app).post('/api/pings').send({ playerId: playerA, gameId, expiresInMinutes: 999 });
  assert.equal(res.status, 400);
});

let pingId: string;

test('POST /api/pings creates a ping visible to everyone', async () => {
  const res = await request(app).post('/api/pings').send({ playerId: playerA, gameId, message: 'Wer ist dabei?' });
  assert.equal(res.status, 201);
  assert.equal(res.body.pings.length, 1);
  const ping = res.body.pings[0];
  assert.equal(ping.playerId, playerA);
  assert.equal(ping.playerName, 'Ping Alice');
  assert.equal(ping.gameId, gameId);
  assert.equal(ping.message, 'Wer ist dabei?');
  assert.deepEqual(ping.interested, []);
  pingId = ping.id;
});

test('POST /api/pings/:id/interested toggles a player joining and leaving', async () => {
  const join = await request(app).post(`/api/pings/${pingId}/interested`).send({ playerId: playerB });
  assert.equal(join.status, 200);
  assert.equal(join.body.pings[0].interested.length, 1);
  assert.equal(join.body.pings[0].interested[0].id, playerB);

  const leave = await request(app).post(`/api/pings/${pingId}/interested`).send({ playerId: playerB });
  assert.equal(leave.status, 200);
  assert.deepEqual(leave.body.pings[0].interested, []);
});

test('POST /api/pings/:id/interested 404s for an unknown ping', async () => {
  const res = await request(app).post('/api/pings/ghost/interested').send({ playerId: playerB });
  assert.equal(res.status, 404);
});

test('DELETE /api/pings/:id cancels it early', async () => {
  const res = await request(app).delete(`/api/pings/${pingId}`);
  assert.equal(res.status, 204);

  const list = await request(app).get('/api/pings');
  assert.deepEqual(list.body.pings, []);
});

test('a ping with a very short lifetime no longer shows up once expired', async () => {
  const created = await request(app)
    .post('/api/pings')
    .send({ playerId: playerA, gameId, expiresInMinutes: 5 });
  const id = created.body.pings[0].id;

  // Simulate time passing by expiring it directly (no clock mocking in this
  // test setup) — same effect as the 5-minute window running out.
  const { db } = await import('../db');
  db.prepare('UPDATE game_pings SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, id);

  const list = await request(app).get('/api/pings');
  assert.ok(!list.body.pings.some((p: { id: string }) => p.id === id));
});
