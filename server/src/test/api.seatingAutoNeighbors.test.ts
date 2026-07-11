// Integration tests for auto-syncing seat_neighbors ("Sichtbare Monitore")
// from the seating plan: players seated next to each other along the same
// table edge should be pre-filled as visible-monitor pairs, corner
// placements should not, and manually confirmed pairs must survive later
// layout changes untouched.

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
  const names = ['Auto A', 'Auto B', 'Auto C', 'Auto D'];
  const ids: string[] = [];
  for (const name of names) {
    const p = await request(app).post('/api/players').send({ name });
    ids.push(p.body.id);
  }
  [a, b, c, d] = ids;
});

test('same-edge seats auto-fill visible-monitor pairs, corner seats do not', async () => {
  // top: a, b next to each other. right: c, d next to each other. b (last
  // top seat) and c (first right seat) sit at a corner, not a shared edge.
  await request(app).put('/api/seating/layout').send({
    topSeats: 2,
    rightSeats: 2,
    bottomSeats: 0,
    leftSeats: 0,
    assignments: [
      { side: 'top', seat: 0, playerId: a },
      { side: 'top', seat: 1, playerId: b },
      { side: 'right', seat: 0, playerId: c },
      { side: 'right', seat: 1, playerId: d },
    ],
  });

  assert.deepEqual((await request(app).get(`/api/players/${a}/neighbors`)).body.neighborIds, [b]);
  assert.deepEqual((await request(app).get(`/api/players/${b}/neighbors`)).body.neighborIds, [a]);
  assert.deepEqual((await request(app).get(`/api/players/${c}/neighbors`)).body.neighborIds, [d]);
  assert.deepEqual((await request(app).get(`/api/players/${d}/neighbors`)).body.neighborIds, [c]);
});

test('moving players updates auto-filled pairs: stale ones drop, new ones appear', async () => {
  // Swap b and c: now a-c are the top pair, b-d the right pair.
  await request(app).put('/api/seating/layout').send({
    topSeats: 2,
    rightSeats: 2,
    bottomSeats: 0,
    leftSeats: 0,
    assignments: [
      { side: 'top', seat: 0, playerId: a },
      { side: 'top', seat: 1, playerId: c },
      { side: 'right', seat: 0, playerId: b },
      { side: 'right', seat: 1, playerId: d },
    ],
  });

  assert.deepEqual((await request(app).get(`/api/players/${a}/neighbors`)).body.neighborIds, [c]);
  assert.deepEqual((await request(app).get(`/api/players/${c}/neighbors`)).body.neighborIds, [a]);
  assert.deepEqual((await request(app).get(`/api/players/${b}/neighbors`)).body.neighborIds, [d]);
  assert.deepEqual((await request(app).get(`/api/players/${d}/neighbors`)).body.neighborIds, [b]);
});

test('manually confirmed pairs survive a later layout change; unrelated auto pairs still update', async () => {
  // A manually confirms/extends their own list to b and c (b is not seated
  // next to a at all right now) — this is a full replace, so both become
  // source = 'manual' for a's own row.
  await request(app).put(`/api/players/${a}/neighbors`).send({ neighborIds: [b, c] });

  // Reshuffle again: now a-d share the top edge, b-c share the right edge.
  await request(app).put('/api/seating/layout').send({
    topSeats: 2,
    rightSeats: 2,
    bottomSeats: 0,
    leftSeats: 0,
    assignments: [
      { side: 'top', seat: 0, playerId: a },
      { side: 'top', seat: 1, playerId: d },
      { side: 'right', seat: 0, playerId: b },
      { side: 'right', seat: 1, playerId: c },
    ],
  });

  // a's manually confirmed b/c stay, plus the freshly auto-derived d.
  assert.deepEqual(
    (await request(app).get(`/api/players/${a}/neighbors`)).body.neighborIds.slice().sort(),
    [b, c, d].sort()
  );
  // d's side of the new a-d pair is auto-derived; the stale auto pair to b is gone.
  assert.deepEqual((await request(app).get(`/api/players/${d}/neighbors`)).body.neighborIds, [a]);
  // b and c now share an edge; the stale auto pairs to d/a on their own rows are gone.
  assert.deepEqual((await request(app).get(`/api/players/${b}/neighbors`)).body.neighborIds, [c]);
  assert.deepEqual((await request(app).get(`/api/players/${c}/neighbors`)).body.neighborIds, [b]);
});
