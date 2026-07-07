// Integration tests for the "what's next" voting flow (FR-19..21).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerA: string;
let playerB: string;
let gameCs2: string;
let gameRl: string;

test('setup: players and games for voting', async () => {
  const a = await request(app).post('/api/players').send({ name: 'Voter A' });
  const b = await request(app).post('/api/players').send({ name: 'Voter B' });
  playerA = a.body.id;
  playerB = b.body.id;

  const games = await request(app).get('/api/games');
  gameCs2 = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
  gameRl = games.body.find((g: { name: string }) => g.name === 'Rocket League').id;
});

test('GET /api/votes with no round yet: closed, no votes', async () => {
  const res = await request(app).get('/api/votes');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, false);
  assert.equal(res.body.round, 0);
  assert.equal(res.body.totalVotes, 0);
});

test('POST /api/votes rejects a vote when no round is open', async () => {
  const res = await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  assert.equal(res.status, 409);
});

test('POST /api/votes/close rejects closing when nothing is open', async () => {
  const res = await request(app).post('/api/votes/close');
  assert.equal(res.status, 409);
});

test('POST /api/votes/start opens a round', async () => {
  const res = await request(app).post('/api/votes/start');
  assert.equal(res.status, 201);
  assert.equal(res.body.open, true);
  assert.equal(res.body.round, 1);
});

test('POST /api/votes/start rejects starting a second round while one is open', async () => {
  const res = await request(app).post('/api/votes/start');
  assert.equal(res.status, 409);
});

test('POST /api/votes rejects an unknown player or game', async () => {
  const badPlayer = await request(app).post('/api/votes').send({ playerId: 'ghost', gameId: gameCs2 });
  assert.equal(badPlayer.status, 404);
  const badGame = await request(app).post('/api/votes').send({ playerId: playerA, gameId: 'ghost' });
  assert.equal(badGame.status, 404);
});

test('players vote and the tally updates live', async () => {
  await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  await request(app).post('/api/votes').send({ playerId: playerB, gameId: gameCs2 });

  const res = await request(app).get('/api/votes');
  assert.equal(res.body.totalVotes, 2);
  const cs2Result = res.body.results.find((r: { gameId: string }) => r.gameId === gameCs2);
  assert.equal(cs2Result.votes, 2);
});

test('re-voting changes the player\'s previous choice instead of adding a second vote', async () => {
  await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameRl });

  const res = await request(app).get('/api/votes');
  assert.equal(res.body.totalVotes, 2); // still 2 voters total, not 3
  const cs2Result = res.body.results.find((r: { gameId: string }) => r.gameId === gameCs2);
  const rlResult = res.body.results.find((r: { gameId: string }) => r.gameId === gameRl);
  assert.equal(cs2Result.votes, 1);
  assert.equal(rlResult.votes, 1);
});

test('POST /api/votes/close reports the winner(s)', async () => {
  // Currently tied 1-1 (CS2 vs Rocket League) after the re-vote above.
  await request(app).post('/api/votes').send({ playerId: playerB, gameId: gameRl }); // RL now leads 2-0... wait CS2 has 0 now
  const res = await request(app).post('/api/votes/close');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, false);
  assert.deepEqual(res.body.winnerGameIds, [gameRl]);
});

test('a new round starts fresh (previous votes do not carry over)', async () => {
  const started = await request(app).post('/api/votes/start');
  assert.equal(started.body.round, 2);
  assert.equal(started.body.totalVotes, 0);
});

test('POST /api/votes/cancel discards the round without a winner', async () => {
  await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  const res = await request(app).post('/api/votes/cancel');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, false);
  assert.equal(res.body.totalVotes, 0);
});

test('POST /api/votes/cancel rejects when nothing is open', async () => {
  const res = await request(app).post('/api/votes/cancel');
  assert.equal(res.status, 409);
});
