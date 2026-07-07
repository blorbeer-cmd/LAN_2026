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

test('POST /api/matchmaking ignores seat neighbors unless this draw asks for it', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Seating Test Game A' });

  const names = ['E', 'F', 'G', 'H'];
  const ratings = [8, 7, 6, 1];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }
  await request(app).put(`/api/players/${ids[0]}/neighbors`).send({ neighborIds: [ids[1]] });

  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 }); // avoidAdjacentOpponents omitted
  assert.equal(res.status, 200);
  assert.equal(res.body.seatConflicts, 0); // not evaluated either way
  assert.equal(res.body.seatPairsConsidered, 0);
});

test('POST /api/matchmaking rejects a non-boolean avoidAdjacentOpponents', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds, avoidAdjacentOpponents: 'yes' });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking keeps seat neighbors together when this draw asks for it', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Seating Test Game B' });

  // Same ratings as the deterministic matchmaking.test.ts unit test: the
  // plain skill-balanced draft splits the two highest-rated players (I, J)
  // across teams, and reuniting them only costs a small, affordable amount
  // of balance.
  const names = ['I', 'J', 'K', 'L'];
  const ratings = [8, 7, 6, 1];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }
  await request(app).put(`/api/players/${ids[0]}/neighbors`).send({ neighborIds: [ids[1]] });

  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2, avoidAdjacentOpponents: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.seatPairsConsidered, 1);
  assert.equal(res.body.seatConflicts, 0);
  const teamOf = (id: string) =>
    res.body.teams.findIndex((t: { players: { id: string }[] }) => t.players.some((p) => p.id === id));
  assert.equal(teamOf(ids[0]), teamOf(ids[1]));
});

test('GET /api/matchmaking/history lists past draws for this game, newest first, with team scores', async () => {
  const game = await request(app).post('/api/games').send({ name: 'History Test Game' });
  const names = ['M', 'N'];
  const ratings = [9, 4];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }

  // Two separate draws (e.g. a re-roll) — both should show up.
  await request(app).post('/api/matchmaking').send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });
  const second = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });

  const history = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}`);
  assert.equal(history.status, 200);
  assert.equal(history.body.history.length, 2);

  const [newest] = history.body.history;
  assert.equal(newest.gameId, game.body.id);
  assert.equal(newest.gameName, 'History Test Game');
  assert.equal(newest.generatedAt, second.body.generatedAt);
  // Each historical team keeps its score (totalRating), same as a fresh draw.
  for (const team of newest.teams) {
    assert.equal(
      team.totalRating,
      team.players.reduce((sum: number, p: { rating: number }) => sum + p.rating, 0)
    );
  }
});

test('GET /api/matchmaking/history does not leak draws from other games', async () => {
  const res = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.history.every((h: { gameId: string }) => h.gameId === gameId));
});
