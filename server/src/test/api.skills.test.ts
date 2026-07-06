// Integration tests for skill-rating upsert/read/delete. Creates its own
// player and game so it doesn't depend on seed data or other test files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;
let gameId: string;

test('setup: create a player and a game to rate', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Skill Tester' });
  const game = await request(app).post('/api/games').send({ name: 'Skill Test Game' });
  playerId = player.body.id;
  gameId = game.body.id;
  assert.ok(playerId && gameId);
});

test('PUT /api/skills rejects an out-of-range rating', async () => {
  const res = await request(app).put('/api/skills').send({ playerId, gameId, rating: 11 });
  assert.equal(res.status, 400);
});

test('PUT /api/skills rejects an unknown player', async () => {
  const res = await request(app)
    .put('/api/skills')
    .send({ playerId: 'ghost', gameId, rating: 5 });
  assert.equal(res.status, 404);
});

test('PUT /api/skills creates a rating', async () => {
  const res = await request(app).put('/api/skills').send({ playerId, gameId, rating: 7 });
  assert.equal(res.status, 200);
  assert.equal(res.body.rating, 7);
});

test('PUT /api/skills upserts (updates) the same rating', async () => {
  const res = await request(app).put('/api/skills').send({ playerId, gameId, rating: 9 });
  assert.equal(res.status, 200);

  const list = await request(app).get(`/api/skills?playerId=${playerId}`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].rating, 9);
});

test('GET /api/skills filters by gameId', async () => {
  const res = await request(app).get(`/api/skills?gameId=${gameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.some((s: { player_id: string }) => s.player_id === playerId));
});

test('DELETE /api/skills/:playerId/:gameId clears the rating', async () => {
  const res = await request(app).delete(`/api/skills/${playerId}/${gameId}`);
  assert.equal(res.status, 204);

  const list = await request(app).get(`/api/skills?playerId=${playerId}`);
  assert.equal(list.body.length, 0);
});

test('DELETE /api/skills/:playerId/:gameId 404s when already gone', async () => {
  const res = await request(app).delete(`/api/skills/${playerId}/${gameId}`);
  assert.equal(res.status, 404);
});
