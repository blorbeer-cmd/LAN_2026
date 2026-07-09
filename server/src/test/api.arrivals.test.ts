// Integration tests for An-/Abreise + Fahrgemeinschaften: self-service
// arrival rows and carpool group lifecycle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

let alice: { id: string };
let bob: { id: string };
let carpoolId: string;

test('setup: two players', async () => {
  alice = (await request(app).post('/api/players').send({ name: 'Anreise Alice' })).body;
  bob = (await request(app).post('/api/players').send({ name: 'Anreise Bob' })).body;
});

test('GET /api/arrivals starts empty', async () => {
  const res = await request(app).get('/api/arrivals');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.arrivals, []);
  assert.deepEqual(res.body.carpools.arrival, []);
  assert.deepEqual(res.body.carpools.departure, []);
});

test('PUT /api/arrivals/mine upserts a player arrival row', async () => {
  const arrivalAt = Date.now() + 60_000;
  const departureAt = arrivalAt + 3_600_000;
  const res = await request(app)
    .put('/api/arrivals/mine')
    .send({ playerId: alice.id, arrivalAt, departureAt, note: 'komme nach der Arbeit' });
  assert.equal(res.status, 200);
  const row = res.body.arrivals.find((a: { player_id: string }) => a.player_id === alice.id);
  assert.ok(row);
  assert.equal(row.arrival_at, arrivalAt);
  assert.equal(row.departure_at, departureAt);
  assert.equal(row.note, 'komme nach der Arbeit');

  const update = await request(app).put('/api/arrivals/mine').send({ playerId: alice.id, arrivalAt: null, departureAt: null, note: '' });
  assert.equal(update.status, 200);
  const updated = update.body.arrivals.find((a: { player_id: string }) => a.player_id === alice.id);
  assert.equal(updated.arrival_at, null);
  assert.equal(updated.note, null);
});

test('PUT /api/arrivals/mine validates player and timestamps', async () => {
  const ghost = await request(app).put('/api/arrivals/mine').send({ playerId: 'ghost' });
  assert.equal(ghost.status, 404);
  const badTime = await request(app).put('/api/arrivals/mine').send({ playerId: alice.id, arrivalAt: 'soon' });
  assert.equal(badTime.status, 400);
});

test('POST /api/arrivals/carpools creates a group and joins the creator', async () => {
  const badDirection = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: alice.id, direction: 'sideways', label: 'Auto' });
  assert.equal(badDirection.status, 400);

  const res = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: alice.id, direction: 'arrival', label: 'Auto Alice, ab Hamburg 16 Uhr' });
  assert.equal(res.status, 201);
  carpoolId = res.body.id;
  assert.equal(res.body.direction, 'arrival');
  assert.equal(res.body.members.length, 1);
  assert.equal(res.body.members[0].id, alice.id);
});

test('joining and leaving a carpool updates members; empty groups disappear', async () => {
  const joined = await request(app).post(`/api/arrivals/carpools/${carpoolId}/join`).send({ playerId: bob.id });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.members.length, 2);

  const leftAlice = await request(app).post(`/api/arrivals/carpools/${carpoolId}/leave`).send({ playerId: alice.id });
  assert.equal(leftAlice.status, 200);
  assert.deepEqual(leftAlice.body.members.map((m: { id: string }) => m.id), [bob.id]);

  const leftBob = await request(app).post(`/api/arrivals/carpools/${carpoolId}/leave`).send({ playerId: bob.id });
  assert.equal(leftBob.status, 204);

  const list = await request(app).get('/api/arrivals');
  assert.equal(list.body.carpools.arrival.some((c: { id: string }) => c.id === carpoolId), false);
});

test('DELETE /api/arrivals/carpools/:id is creator-only', async () => {
  const created = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: alice.id, direction: 'departure', label: 'Zurück mit Alice' });
  assert.equal(created.status, 201);

  const foreignDelete = await request(app).delete(`/api/arrivals/carpools/${created.body.id}`).send({ playerId: bob.id });
  assert.equal(foreignDelete.status, 403);

  const ownDelete = await request(app).delete(`/api/arrivals/carpools/${created.body.id}`).send({ playerId: alice.id });
  assert.equal(ownDelete.status, 204);
});
