// Integration tests for the matchmaking endpoint: input validation, rating
// lookup (with a neutral default for unrated players), and team balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let gameId: string;
let playerIds: string[];

test('setup: create a game and 4 players with skill ratings', async () => {
  const game = await request(app).post('/api/games').send({ name: 'MM Test Game' });
  gameId = game.body.id;

  const names = ['A', 'B', 'C', 'D'];
  const ratings = [10, 1, 8, 3];
  playerIds = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    playerIds.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId, rating: ratings[i] });
  }
  assert.equal(playerIds.length, 4);
});

test('POST /api/matchmaking rejects fewer than 2 players', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerIds[0]] });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking rejects duplicate playerIds', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerIds[0], playerIds[0]] });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking 404s for an unknown game', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId: 'nope', playerIds });
  assert.equal(res.status, 404);
});

test('POST /api/matchmaking 404s if a player does not exist', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [...playerIds, 'ghost'] });
  assert.equal(res.status, 404);
});

test('POST /api/matchmaking draws two balanced teams by default', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds });
  assert.equal(res.status, 200);
  assert.equal(res.body.teams.length, 2);
  const allIds = res.body.teams.flatMap((t: { players: { id: string }[] }) =>
    t.players.map((p) => p.id)
  );
  assert.deepEqual(allIds.sort(), [...playerIds].sort());
  const [sumA, sumB] = res.body.teams.map((t: { totalRating: number }) => t.totalRating);
  assert.ok(Math.abs(sumA - sumB) <= 2);
});

test('POST /api/matchmaking respects an explicit teamCount', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds, teamCount: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.teams.length, 4);
  for (const team of res.body.teams) {
    assert.equal(team.players.length, 1);
  }
});

test('POST /api/matchmaking uses a neutral default rating for unrated players', async () => {
  const unrated = await request(app).post('/api/players').send({ name: 'Unrated' });
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [...playerIds, unrated.body.id], teamCount: 2 });
  assert.equal(res.status, 200);
  const found = res.body.teams
    .flatMap((t: { players: { id: string; rating: number }[] }) => t.players)
    .find((p: { id: string }) => p.id === unrated.body.id);
  assert.equal(found.rating, 5);
});
