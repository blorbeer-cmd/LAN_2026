// Integration tests for player CRUD, run against the real Express app and an
// in-memory DB. Tests run sequentially and build on each other (create ->
// read -> update -> delete), which mirrors how the flow is actually used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let createdId: string;

test('POST /api/players rejects an empty name', async () => {
  const res = await request(app).post('/api/players').send({ name: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Name/);
});

test('POST /api/players rejects an invalid color', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Alex', color: 'blau' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Farbe/);
});

test('POST /api/players creates a player with a generated API key', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Alex' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Alex');
  assert.equal(res.body.color, '#4f9dff');
  assert.ok(res.body.api_key && res.body.api_key.length > 10);
  createdId = res.body.id;
});

test('GET /api/players lists players WITHOUT exposing api_key', async () => {
  const res = await request(app).get('/api/players');
  assert.equal(res.status, 200);
  const found = res.body.find((p: { id: string }) => p.id === createdId);
  assert.ok(found, 'created player should be in the list');
  assert.equal('api_key' in found, false);
});

test('GET /api/players/:id returns the single player WITH api_key', async () => {
  const res = await request(app).get(`/api/players/${createdId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.api_key);
});

test('GET /api/players/:id 404s for an unknown id', async () => {
  const res = await request(app).get('/api/players/does-not-exist');
  assert.equal(res.status, 404);
});

test('PATCH /api/players/:id renames and recolors', async () => {
  const res = await request(app)
    .patch(`/api/players/${createdId}`)
    .send({ name: 'Alexandra', color: '#ff0000' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Alexandra');
  assert.equal(res.body.color, '#ff0000');
});

test('PATCH /api/players/:id rejects an invalid color', async () => {
  const res = await request(app).patch(`/api/players/${createdId}`).send({ color: 'nope' });
  assert.equal(res.status, 400);
});

test('DELETE /api/players/:id removes the player', async () => {
  const res = await request(app).delete(`/api/players/${createdId}`);
  assert.equal(res.status, 204);

  const after = await request(app).get(`/api/players/${createdId}`);
  assert.equal(after.status, 404);
});

test('DELETE /api/players/:id 404s when already gone', async () => {
  const res = await request(app).delete(`/api/players/${createdId}`);
  assert.equal(res.status, 404);
});
