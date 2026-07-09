// Integration tests for the combined game catalog: seeded list, CRUD,
// validation and per-player interest toggles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;
let catalogId: string;

test('GET /api/game-catalog returns the seeded 35-game catalog', async () => {
  const res = await request(app).get('/api/game-catalog');
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 35);
  assert.ok(res.body.items.some((item: { title: string; uploadDone: boolean }) => item.title === 'UT2004' && item.uploadDone));
});

test('setup: a player for catalog actions', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Catalog Alice' });
  assert.equal(player.status, 201);
  playerId = player.body.id;
});

test('POST /api/game-catalog validates title, playRate and trailerUrl', async () => {
  const noTitle = await request(app).post('/api/game-catalog').send({ platform: 'Steam' });
  assert.equal(noTitle.status, 400);
  const badRate = await request(app).post('/api/game-catalog').send({ title: 'Bad Rate', playRate: 'extrem' });
  assert.equal(badRate.status, 400);
  const badTrailer = await request(app).post('/api/game-catalog').send({ title: 'Bad Trailer', trailerUrl: 'ftp://example.test' });
  assert.equal(badTrailer.status, 400);
});

test('POST /api/game-catalog creates a proposal', async () => {
  const res = await request(app).post('/api/game-catalog').send({
    title: 'LAN Test Racer',
    platform: 'Steam',
    uploadDone: false,
    playRate: 'hoch',
    priceCents: 499,
    trailerUrl: 'https://example.test/trailer',
    playerId,
  });
  assert.equal(res.status, 201);
  const created = res.body.items.find((item: { title: string }) => item.title === 'LAN Test Racer');
  assert.ok(created);
  assert.equal(created.platform, 'Steam');
  assert.equal(created.playRate, 'hoch');
  assert.equal(created.priceCents, 499);
  assert.equal(created.createdBy, playerId);
  catalogId = created.id;
});

test('PATCH /api/game-catalog/:id updates fields', async () => {
  const res = await request(app).patch(`/api/game-catalog/${catalogId}`).send({
    title: 'LAN Test Racer Deluxe',
    uploadDone: true,
    playRate: 'mittel',
    priceCents: null,
  });
  assert.equal(res.status, 200);
  const updated = res.body.items.find((item: { id: string }) => item.id === catalogId);
  assert.equal(updated.title, 'LAN Test Racer Deluxe');
  assert.equal(updated.uploadDone, true);
  assert.equal(updated.playRate, 'mittel');
  assert.equal(updated.priceCents, null);

  const missing = await request(app).patch('/api/game-catalog/nope').send({ title: 'x' });
  assert.equal(missing.status, 404);
});

test('POST /api/game-catalog/:id/interest toggles interest', async () => {
  const join = await request(app).post(`/api/game-catalog/${catalogId}/interest`).send({ playerId });
  assert.equal(join.status, 200);
  let item = join.body.items.find((entry: { id: string }) => entry.id === catalogId);
  assert.equal(item.interestCount, 1);
  assert.deepEqual(item.interestedPlayerIds, [playerId]);

  const leave = await request(app).post(`/api/game-catalog/${catalogId}/interest`).send({ playerId });
  assert.equal(leave.status, 200);
  item = leave.body.items.find((entry: { id: string }) => entry.id === catalogId);
  assert.equal(item.interestCount, 0);
  assert.deepEqual(item.interestedPlayerIds, []);
});

test('DELETE /api/game-catalog/:id removes a proposal', async () => {
  const res = await request(app).delete(`/api/game-catalog/${catalogId}`);
  assert.equal(res.status, 204);
  const again = await request(app).delete(`/api/game-catalog/${catalogId}`);
  assert.equal(again.status, 404);
});
