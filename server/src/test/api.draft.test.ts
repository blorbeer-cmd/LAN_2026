// Integration tests for the captain draft: start/pick/cancel lifecycle,
// snake pick order, turn enforcement, auto-assignment of the last pool
// player, and the Team-Historie logging of completed drafts. The parallel
// races (double start, simultaneous picks) live in api.concurrency.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { snakeCaptainIndex } from '../routes/draft';

const app = createApp();

let gameId: string;
let players: Array<{ id: string; name: string }>;

test('snakeCaptainIndex alternates direction every round', () => {
  // 2 captains: A B | B A | A B ...
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((n) => snakeCaptainIndex(n, 2)),
    [0, 1, 1, 0, 0, 1]
  );
  // 3 captains: A B C | C B A | A B C ...
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((n) => snakeCaptainIndex(n, 3)),
    [0, 1, 2, 2, 1, 0, 0]
  );
});

test('setup: a game and 6 players', async () => {
  const games = await request(app).get('/api/games');
  gameId = games.body[0].id;
  players = [];
  for (const name of ['Cap A', 'Cap B', 'Pool 1', 'Pool 2', 'Pool 3', 'Pool 4']) {
    const res = await request(app).post('/api/players').send({ name });
    players.push(res.body);
  }
});

test('GET /api/draft is empty before any draft', async () => {
  const res = await request(app).get('/api/draft');
  assert.equal(res.status, 200);
  assert.equal(res.body.draft, null);
});

test('POST /api/draft/start validates captains and pool', async () => {
  const one = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [players[0].id], poolPlayerIds: [players[2].id] });
  assert.equal(one.status, 400);

  const emptyPool = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [players[0].id, players[1].id], poolPlayerIds: [] });
  assert.equal(emptyPool.status, 400);

  const duplicate = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [players[0].id, players[1].id], poolPlayerIds: [players[0].id] });
  assert.equal(duplicate.status, 400);

  const ghost = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [players[0].id, players[1].id], poolPlayerIds: ['ghost'] });
  assert.equal(ghost.status, 404);
});

test('a full 2-captain draft: snake order, turn enforcement, auto-assigned last pick', async () => {
  const [capA, capB, p1, p2, p3, p4] = players;
  const start = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [capA.id, capB.id], poolPlayerIds: [p1.id, p2.id, p3.id, p4.id] });
  assert.equal(start.status, 201);
  assert.equal(start.body.draft.status, 'active');
  assert.equal(start.body.draft.turnCaptainId, capA.id);

  // Starting a second draft while one runs must fail.
  const second = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [capA.id, capB.id], poolPlayerIds: [p1.id] });
  assert.equal(second.status, 409);

  // Captain B tries to pick out of turn.
  const outOfTurn = await request(app).post('/api/draft/pick').send({ playerId: capB.id, pickPlayerId: p1.id });
  assert.equal(outOfTurn.status, 409);

  // A picks p1 (snake: next is B, twice).
  const pick1 = await request(app).post('/api/draft/pick').send({ playerId: capA.id, pickPlayerId: p1.id });
  assert.equal(pick1.status, 200);
  assert.equal(pick1.body.draft.turnCaptainId, capB.id);

  // Picking someone no longer in the pool fails cleanly.
  const gone = await request(app).post('/api/draft/pick').send({ playerId: capB.id, pickPlayerId: p1.id });
  assert.equal(gone.status, 409);

  const pick2 = await request(app).post('/api/draft/pick').send({ playerId: capB.id, pickPlayerId: p2.id });
  assert.equal(pick2.status, 200);
  // Snake: B picks again.
  assert.equal(pick2.body.draft.turnCaptainId, capB.id);

  // B picks p3 — one player remains, so p4 is auto-assigned to A (whose turn
  // it would be) and the draft completes without a fourth request.
  const pick3 = await request(app).post('/api/draft/pick').send({ playerId: capB.id, pickPlayerId: p3.id });
  assert.equal(pick3.status, 200);
  assert.equal(pick3.body.draft.status, 'completed');
  assert.equal(pick3.body.draft.pool.length, 0);

  const teamA = pick3.body.draft.teams[0];
  const teamB = pick3.body.draft.teams[1];
  assert.deepEqual(
    teamA.players.map((p: { id: string }) => p.id),
    [capA.id, p1.id, p4.id]
  );
  assert.deepEqual(
    teamB.players.map((p: { id: string }) => p.id),
    [capB.id, p2.id, p3.id]
  );

  // Picking after completion fails (no active draft anymore).
  const late = await request(app).post('/api/draft/pick').send({ playerId: capA.id, pickPlayerId: p2.id });
  assert.equal(late.status, 409);

  // The completed draft shows up in the shared Team-Historie.
  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  assert.equal(history.status, 200);
  assert.ok(history.body.history.length >= 1);
  const latest = history.body.history[0];
  assert.equal(latest.teams.length, 2);
  assert.equal(latest.teams[0].players.length, 3);
});

test('POST /api/draft/cancel abandons a running draft', async () => {
  const [capA, capB, p1] = players;
  const start = await request(app)
    .post('/api/draft/start')
    .send({ gameId, captainIds: [capA.id, capB.id], poolPlayerIds: [p1.id] });
  assert.equal(start.status, 201);

  const cancel = await request(app).post('/api/draft/cancel');
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.draft.status, 'cancelled');

  const again = await request(app).post('/api/draft/cancel');
  assert.equal(again.status, 409);
});
