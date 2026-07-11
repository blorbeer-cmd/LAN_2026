// Integration tests for player CRUD, run against the real Express app and an
// in-memory DB. Tests run sequentially and build on each other (create ->
// read -> update -> delete), which mirrors how the flow is actually used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';

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

test('GET /api/players/:id includes the most recent agent report time', async () => {
  const lastSeen = Date.now() - 90_000;
  db.prepare('INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, NULL)').run(createdId, lastSeen);
  const res = await request(app).get(`/api/players/${createdId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.agent_last_seen, lastSeen);
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

test('POST /api/players rejects a name that is already taken (case-insensitive)', async () => {
  const dup = await request(app).post('/api/players').send({ name: 'alexandra' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /vergeben/);
});

test('PATCH /api/players/:id rejects renaming to a name already taken by someone else', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Bine' });
  const res = await request(app).patch(`/api/players/${other.body.id}`).send({ name: 'ALEXANDRA' });
  assert.equal(res.status, 409);
  await request(app).delete(`/api/players/${other.body.id}`);
});

test('PATCH /api/players/:id keeping your own name (same casing or not) is not a conflict', async () => {
  const res = await request(app).patch(`/api/players/${createdId}`).send({ name: 'Alexandra' });
  assert.equal(res.status, 200);
});

test('PATCH /api/players/:id rejects an invalid avatar value', async () => {
  const res = await request(app).patch(`/api/players/${createdId}`).send({ avatar: 'not-a-data-url' });
  assert.equal(res.status, 400);
});

test('PATCH /api/players/:id accepts and stores a valid avatar data URL', async () => {
  const avatar = 'data:image/png;base64,aGVsbG8=';
  const res = await request(app).patch(`/api/players/${createdId}`).send({ avatar });
  assert.equal(res.status, 200);
  assert.equal(res.body.avatar, avatar);

  const fetched = await request(app).get(`/api/players/${createdId}`);
  assert.equal(fetched.body.avatar, avatar);
});

test('GET /api/players/:id/stats 404s for an unknown id', async () => {
  const res = await request(app).get('/api/players/does-not-exist/stats');
  assert.equal(res.status, 404);
});

test('GET /api/players/:id/stats returns an empty-but-shaped summary before any sessions', async () => {
  const res = await request(app).get(`/api/players/${createdId}/stats`);
  assert.equal(res.status, 200);
  assert.equal(res.body.playerId, createdId);
  assert.equal(res.body.totalMs, 0);
  assert.deepEqual(res.body.games, []);
  assert.deepEqual(res.body.events, []);
  assert.deepEqual(res.body.awards, []);
  assert.equal(res.body.simultaneous.maxSimultaneous, 0);
});

test('GET /api/players/:id/neighbors starts out empty', async () => {
  const res = await request(app).get(`/api/players/${createdId}/neighbors`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.neighborIds, []);
});

test('PUT /api/players/:id/neighbors rejects a non-array neighborIds', async () => {
  const res = await request(app).put(`/api/players/${createdId}/neighbors`).send({ neighborIds: 'nope' });
  assert.equal(res.status, 400);
});

test('PUT /api/players/:id/neighbors sets and replaces the declared neighbors', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Neighbor One' });
  const third = await request(app).post('/api/players').send({ name: 'Neighbor Two' });

  const first = await request(app)
    .put(`/api/players/${createdId}/neighbors`)
    .send({ neighborIds: [other.body.id] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.neighborIds, [other.body.id]);

  // A second PUT fully replaces the set rather than appending to it.
  const second = await request(app)
    .put(`/api/players/${createdId}/neighbors`)
    .send({ neighborIds: [third.body.id] });
  assert.deepEqual(second.body.neighborIds, [third.body.id]);

  const check = await request(app).get(`/api/players/${createdId}/neighbors`);
  assert.deepEqual(check.body.neighborIds, [third.body.id]);
});

test('PUT /api/players/:id/neighbors silently drops your own id and unknown ids', async () => {
  const res = await request(app)
    .put(`/api/players/${createdId}/neighbors`)
    .send({ neighborIds: [createdId, 'ghost-id'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.neighborIds, []);
});

test('PUT /api/players/:id/neighbors 404s for an unknown player', async () => {
  const res = await request(app).put('/api/players/ghost/neighbors').send({ neighborIds: [] });
  assert.equal(res.status, 404);
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
