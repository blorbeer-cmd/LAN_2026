// Integration tests for the skill-suggestion endpoint: exercises it through
// real recorded matches rather than re-testing the Elo math itself (that's
// covered in skillSuggestion.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let winnerId: string;
let loserId: string;
let gameId: string;

test('setup: two players and a game', async () => {
  const winner = await request(app).post('/api/players').send({ name: 'Suggestion Winner' });
  const loser = await request(app).post('/api/players').send({ name: 'Suggestion Loser' });
  const game = await request(app).post('/api/games').send({ name: 'Suggestion Test Game' });
  winnerId = winner.body.id;
  loserId = loser.body.id;
  gameId = game.body.id;
});

test('GET /api/skills/suggestions omits a game with fewer than 3 decided results', async () => {
  for (let i = 0; i < 2; i++) {
    const res = await request(app)
      .post('/api/matches')
      .send({ gameId, teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }], winnerTeamIndex: 0 });
    assert.equal(res.status, 201);
  }
  const res = await request(app).get('/api/skills/suggestions');
  assert.equal(res.status, 200);
  assert.ok(!res.body.suggestions.some((s: { gameId: string }) => s.gameId === gameId));
});

test('GET /api/skills/suggestions rates the consistent winner above the consistent loser once there are 3+ results', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }], winnerTeamIndex: 0 });
  assert.equal(res.status, 201);

  const list = await request(app).get('/api/skills/suggestions');
  assert.equal(list.status, 200);
  const forGame = list.body.suggestions.filter((s: { gameId: string }) => s.gameId === gameId);
  assert.equal(forGame.length, 2);

  const winnerSuggestion = forGame.find((s: { playerId: string }) => s.playerId === winnerId);
  const loserSuggestion = forGame.find((s: { playerId: string }) => s.playerId === loserId);
  assert.ok(winnerSuggestion.rating > loserSuggestion.rating);
  assert.equal(winnerSuggestion.matchCount, 3);
  assert.equal(winnerSuggestion.wins, 3);
  assert.equal(loserSuggestion.wins, 0);
});

test('GET /api/skills/suggestions ignores an undecided match toward the threshold', async () => {
  const otherGame = await request(app).post('/api/games').send({ name: 'Undecided Only Game' });
  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/api/matches')
      .send({ gameId: otherGame.body.id, teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }] });
  }
  const res = await request(app).get('/api/skills/suggestions');
  assert.ok(!res.body.suggestions.some((s: { gameId: string }) => s.gameId === otherGame.body.id));
});
