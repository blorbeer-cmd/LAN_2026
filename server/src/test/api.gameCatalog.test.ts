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
  const cs2 = res.body.items.find((item: { title: string }) => item.title === 'CS GO');
  assert.equal(cs2.isSuggestion, false);
  assert.match(cs2.platformUrl, /store\.steampowered\.com/);
  assert.match(cs2.trailerUrl, /youtube\.com/);
});

test('setup: a player for catalog actions', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Catalog Alice' });
  assert.equal(player.status, 201);
  playerId = player.body.id;
});

test('POST /api/game-catalog validates title and links', async () => {
  const noTitle = await request(app).post('/api/game-catalog').send({ platform: 'Steam' });
  assert.equal(noTitle.status, 400);
  const badTrailer = await request(app).post('/api/game-catalog').send({ title: 'Bad Trailer', trailerUrl: 'ftp://example.test' });
  assert.equal(badTrailer.status, 400);
  const badPlatform = await request(app).post('/api/game-catalog').send({ title: 'Bad Platform', platformUrl: 'mailto:test@example.test' });
  assert.equal(badPlatform.status, 400);
});

test('POST /api/game-catalog creates a proposal', async () => {
  const res = await request(app).post('/api/game-catalog').send({
    title: 'LAN Test Racer',
    platform: 'Steam',
    platformUrl: 'https://store.steampowered.com/search/?term=LAN%20Test%20Racer',
    trailerUrl: 'https://example.test/trailer',
    playerId,
  });
  assert.equal(res.status, 201);
  const created = res.body.items.find((item: { title: string }) => item.title === 'LAN Test Racer');
  assert.ok(created);
  assert.equal(created.platform, 'Steam');
  assert.equal(created.platformUrl, 'https://store.steampowered.com/search/?term=LAN%20Test%20Racer');
  assert.equal(created.isSuggestion, true);
  assert.equal(created.createdBy, playerId);
  catalogId = created.id;
});

test('PATCH /api/game-catalog/:id updates fields', async () => {
  const res = await request(app).patch(`/api/game-catalog/${catalogId}`).send({
    title: 'LAN Test Racer Deluxe',
    platformUrl: 'https://example.test/platform',
  });
  assert.equal(res.status, 200);
  const updated = res.body.items.find((item: { id: string }) => item.id === catalogId);
  assert.equal(updated.title, 'LAN Test Racer Deluxe');
  assert.equal(updated.platformUrl, 'https://example.test/platform');

  const missing = await request(app).patch('/api/game-catalog/nope').send({ title: 'x' });
  assert.equal(missing.status, 404);
});

test('PUT /api/game-catalog/:id/rating rates a catalog entry from 1 to 5', async () => {
  const rated = await request(app).put(`/api/game-catalog/${catalogId}/rating`).send({ playerId, rating: 4 });
  assert.equal(rated.status, 200);
  let item = rated.body.items.find((entry: { id: string }) => entry.id === catalogId);
  assert.equal(item.ratingCount, 1);
  assert.equal(item.ratingAverage, 4);

  const updated = await request(app).put(`/api/game-catalog/${catalogId}/rating`).send({ playerId, rating: 5 });
  assert.equal(updated.status, 200);
  item = updated.body.items.find((entry: { id: string }) => entry.id === catalogId);
  assert.equal(item.ratingCount, 1);
  assert.equal(item.ratingAverage, 5);

  const invalid = await request(app).put(`/api/game-catalog/${catalogId}/rating`).send({ playerId, rating: 6 });
  assert.equal(invalid.status, 400);
});

test('PUT /api/game-catalog/:id/rating also works for seeded games', async () => {
  const list = await request(app).get('/api/game-catalog');
  const seeded = list.body.items.find((entry: { isSuggestion: boolean }) => !entry.isSuggestion);

  const rated = await request(app).put(`/api/game-catalog/${seeded.id}/rating`).send({ playerId, rating: 3 });
  assert.equal(rated.status, 200);
  const item = rated.body.items.find((entry: { id: string }) => entry.id === seeded.id);
  assert.equal(item.ratingCount, 1);
  assert.equal(item.ratingAverage, 3);
});

test('POST /api/game-catalog/:id/interest still toggles legacy interest on catalog games only', async () => {
  const list = await request(app).get('/api/game-catalog');
  const seeded = list.body.items.find((entry: { isSuggestion: boolean }) => !entry.isSuggestion);

  const join = await request(app).post(`/api/game-catalog/${seeded.id}/interest`).send({ playerId });
  assert.equal(join.status, 200);
  const item = join.body.items.find((entry: { id: string }) => entry.id === seeded.id);
  assert.equal(item.interestCount, 1);
  assert.deepEqual(item.interestedPlayerIds, [playerId]);

  const blocked = await request(app).post(`/api/game-catalog/${catalogId}/interest`).send({ playerId });
  assert.equal(blocked.status, 400);
});

test('POST /api/game-catalog/:id/promote moves a suggestion into the catalog', async () => {
  const res = await request(app).post(`/api/game-catalog/${catalogId}/promote`).send();
  assert.equal(res.status, 200);
  const promoted = res.body.items.find((entry: { id: string }) => entry.id === catalogId);
  assert.equal(promoted.isSuggestion, false);

  const again = await request(app).post(`/api/game-catalog/${catalogId}/promote`).send();
  assert.equal(again.status, 400);
});

test('DELETE /api/game-catalog/:id removes an entry', async () => {
  const res = await request(app).delete(`/api/game-catalog/${catalogId}`);
  assert.equal(res.status, 204);
  const again = await request(app).delete(`/api/game-catalog/${catalogId}`);
  assert.equal(again.status, 404);
});
