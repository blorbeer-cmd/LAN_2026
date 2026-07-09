// Integration tests for "Bock"-rating upsert/read/delete (routes/preferences.ts).
// Mirrors api.skills.test.ts since the two endpoints share the same shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;
let gameId: string;

test('setup: create a player and a game to rate', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Preference Tester' });
  const game = await request(app).post('/api/games').send({ name: 'Preference Test Game' });
  playerId = player.body.id;
  gameId = game.body.id;
  assert.ok(playerId && gameId);
});

test('PUT /api/preferences rejects an out-of-range rating', async () => {
  const res = await request(app).put('/api/preferences').send({ playerId, gameId, rating: 0 });
  assert.equal(res.status, 400);
});

test('PUT /api/preferences rejects an unknown player', async () => {
  const res = await request(app).put('/api/preferences').send({ playerId: 'ghost', gameId, rating: 5 });
  assert.equal(res.status, 404);
});

test('PUT /api/preferences rejects an unknown game', async () => {
  const res = await request(app).put('/api/preferences').send({ playerId, gameId: 'ghost', rating: 5 });
  assert.equal(res.status, 404);
});

test('PUT /api/preferences creates a rating', async () => {
  const res = await request(app).put('/api/preferences').send({ playerId, gameId, rating: 8 });
  assert.equal(res.status, 200);
  assert.equal(res.body.rating, 8);
});

test('PUT /api/preferences upserts (updates) the same rating', async () => {
  const res = await request(app).put('/api/preferences').send({ playerId, gameId, rating: 3 });
  assert.equal(res.status, 200);

  const list = await request(app).get(`/api/preferences?playerId=${playerId}`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].rating, 3);
});

test('GET /api/preferences filters by gameId', async () => {
  const res = await request(app).get(`/api/preferences?gameId=${gameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.some((p: { player_id: string }) => p.player_id === playerId));
});

test('DELETE /api/preferences/:playerId/:gameId clears the rating', async () => {
  const res = await request(app).delete(`/api/preferences/${playerId}/${gameId}`);
  assert.equal(res.status, 204);

  const list = await request(app).get(`/api/preferences?playerId=${playerId}`);
  assert.equal(list.body.length, 0);
});

test('DELETE /api/preferences/:playerId/:gameId 404s when already gone', async () => {
  const res = await request(app).delete(`/api/preferences/${playerId}/${gameId}`);
  assert.equal(res.status, 404);
});
