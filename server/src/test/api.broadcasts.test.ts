// Integration tests for Durchsagen: validation, sender attribution, and the
// recent-history listing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;

test('setup: a player', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Ansager' });
  playerId = res.body.id;
});

test('POST /api/broadcasts validates player and message', async () => {
  const noPlayer = await request(app).post('/api/broadcasts').send({ message: 'Hallo' });
  assert.equal(noPlayer.status, 400);

  const ghost = await request(app).post('/api/broadcasts').send({ playerId: 'ghost', message: 'Hallo' });
  assert.equal(ghost.status, 404);

  const empty = await request(app).post('/api/broadcasts').send({ playerId, message: '   ' });
  assert.equal(empty.status, 400);

  const tooLong = await request(app).post('/api/broadcasts').send({ playerId, message: 'x'.repeat(201) });
  assert.equal(tooLong.status, 400);
});

test('POST /api/broadcasts stores and attributes the message; GET lists newest first', async () => {
  const first = await request(app).post('/api/broadcasts').send({ playerId, message: 'Essen ist da!' });
  assert.equal(first.status, 201);
  assert.equal(first.body.playerName, 'Ansager');
  assert.equal(first.body.message, 'Essen ist da!');

  await request(app).post('/api/broadcasts').send({ playerId, message: 'Turnier startet gleich' });

  const list = await request(app).get('/api/broadcasts');
  assert.equal(list.status, 200);
  assert.ok(list.body.broadcasts.length >= 2);
  assert.equal(list.body.broadcasts[0].message, 'Turnier startet gleich');
  assert.equal(list.body.broadcasts[1].message, 'Essen ist da!');
  assert.equal(list.body.broadcasts[0].playerName, 'Ansager');
});
