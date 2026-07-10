// Integration tests for the shared seating overview.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let a: string;
let b: string;
let c: string;
let d: string;

test('setup: four players', async () => {
  const names = ['Seat A', 'Seat B', 'Seat C', 'Seat D'];
  const ids: string[] = [];
  for (const name of names) {
    const p = await request(app).post('/api/players').send({ name });
    ids.push(p.body.id);
  }
  [a, b, c, d] = ids;
});

test('GET /api/seating starts with everyone unplaced', async () => {
  const res = await request(app).get('/api/seating');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.groups, []);
  assert.equal(res.body.unplacedPlayers.length, 4);
});

test('GET /api/seating groups a chain of declared neighbors into one cluster', async () => {
  // A says B, B says C -> A-B-C form one connected group; D stays unplaced.
  await request(app).put(`/api/players/${a}/neighbors`).send({ neighborIds: [b] });
  await request(app).put(`/api/players/${b}/neighbors`).send({ neighborIds: [c] });

  const res = await request(app).get('/api/seating');
  assert.equal(res.body.groups.length, 1);
  assert.deepEqual(
    res.body.groups[0].map((p: { id: string }) => p.id).sort(),
    [a, b, c].sort()
  );
  assert.deepEqual(res.body.unplacedPlayers.map((p: { id: string }) => p.id), [d]);
});

test('GET /api/seating dedupes a pair declared from both directions', async () => {
  // B already said C above; now C also says B — should still be one pair.
  await request(app).put(`/api/players/${c}/neighbors`).send({ neighborIds: [b] });

  const res = await request(app).get('/api/seating');
  const bcPairs = res.body.pairs.filter(
    (p: { playerAId: string; playerBId: string }) =>
      (p.playerAId === b && p.playerBId === c) || (p.playerAId === c && p.playerBId === b)
  );
  assert.equal(bcPairs.length, 1);
});

test('GET /api/seating/layout returns a four-sided default table', async () => {
  const res = await request(app).get('/api/seating/layout');
  assert.equal(res.status, 200);
  assert.deepEqual(
    [res.body.layout.topSeats, res.body.layout.rightSeats, res.body.layout.bottomSeats, res.body.layout.leftSeats],
    [2, 2, 2, 2]
  );
  assert.deepEqual(res.body.layout.assignments, []);
});

test('PUT /api/seating/layout saves side sizes and player assignments', async () => {
  const res = await request(app).put('/api/seating/layout').send({
    topSeats: 3,
    rightSeats: 1,
    bottomSeats: 0,
    leftSeats: 2,
    assignments: [
      { side: 'top', seat: 0, playerId: a },
      { side: 'left', seat: 1, playerId: b },
      { side: 'right', seat: 1, playerId: c }, // dropped: right side only has one seat
      { side: 'top', seat: 0, playerId: d }, // dropped: seat already occupied
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.layout.assignments, [
    { side: 'top', seat: 0, playerId: a },
    { side: 'left', seat: 1, playerId: b },
  ]);
  assert.equal((await request(app).get('/api/seating/layout')).body.layout.rightSeats, 1);
});

test('PUT /api/seating/layout rejects invalid side sizes', async () => {
  const res = await request(app).put('/api/seating/layout').send({ topSeats: 13, rightSeats: 2, bottomSeats: 2, leftSeats: 2, assignments: [] });
  assert.equal(res.status, 400);
});
