import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';

const app = createApp();
let gameId: string;
let playerA: string;
let playerB: string;
let pingId: string;

test('setup ping players and game', async () => {
  gameId = (await request(app).post('/api/games').send({ name: 'Ping Test Game' })).body.id;
  playerA = (await request(app).post('/api/players').send({ name: 'Ping Alice' })).body.id;
  playerB = (await request(app).post('/api/players').send({ name: 'Ping Bob' })).body.id;
});

test('pings validate references and expiry bounds', async () => {
  assert.equal((await request(app).post('/api/pings').send({ playerId: 'ghost', gameId })).status, 404);
  assert.equal((await request(app).post('/api/pings').send({ playerId: playerA, gameId: 'ghost' })).status, 404);
  assert.equal(
    (await request(app).post('/api/pings').send({ playerId: playerA, gameId, expiresInMinutes: 999 })).status,
    400,
  );
});

test('create, toggle interest, cancel and retain ping history', async () => {
  const created = await request(app).post('/api/pings').send({ playerId: playerA, gameId, message: 'Wer ist dabei?' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.eventId, null);
  assert.equal(created.body.pings[0].playerName, 'Ping Alice');
  pingId = created.body.pings[0].id;

  const joined = await request(app).post(`/api/pings/${pingId}/interested`).send({ playerId: playerB });
  assert.deepEqual(
    joined.body.pings[0].interested.map((player: { id: string }) => player.id),
    [playerB],
  );
  const left = await request(app).post(`/api/pings/${pingId}/interested`).send({ playerId: playerB });
  assert.deepEqual(left.body.pings[0].interested, []);

  assert.equal((await request(app).delete(`/api/pings/${pingId}`)).status, 204);
  assert.deepEqual((await request(app).get('/api/pings')).body.pings, []);
  const history = await request(app).get('/api/pings/history');
  assert.equal(history.body.pings[0].id, pingId);
  assert.equal(history.body.pings[0].active, false);
  assert.ok(history.body.pings[0].cancelledAt);
});

test('expired pings leave the active list but stay in history', async () => {
  const created = await request(app).post('/api/pings').send({ playerId: playerA, gameId });
  const id = created.body.pings[0].id;
  db.prepare('UPDATE game_pings SET expires_at = ? WHERE id = ?').run(Date.now() - 1, id);
  assert.equal(
    (await request(app).get('/api/pings')).body.pings.some((ping: { id: string }) => ping.id === id),
    false,
  );
  assert.equal(
    (await request(app).get('/api/pings/history')).body.pings.some((ping: { id: string }) => ping.id === id),
    true,
  );
});

test('ping history keeps its game snapshot after catalog deletion', async () => {
  assert.equal((await request(app).delete(`/api/games/${gameId}`)).status, 204);
  const history = await request(app).get('/api/pings/history');
  assert.ok(history.body.pings.length >= 1);
  assert.ok(history.body.pings.every((ping: { gameName: string }) => ping.gameName === 'Ping Test Game'));
});
