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
