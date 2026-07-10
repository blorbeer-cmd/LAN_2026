// Integration tests for the personal "Was steht an?" digest: open votes not
// yet cast, ready tournament matches, and unrated currently-live games.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;
let apiKey: string;
let otherPlayerId: string;
let gameId: string;
let cs2GameId: string;

test('setup: two players and a game', async () => {
  const p = await request(app).post('/api/players').send({ name: 'Digest Tester' });
  playerId = p.body.id;
  apiKey = p.body.api_key;
  const other = await request(app).post('/api/players').send({ name: 'Digest Other' });
  otherPlayerId = other.body.id;
  const game = await request(app).post('/api/games').send({ name: 'Digest Test Game' });
  gameId = game.body.id;
  const games = await request(app).get('/api/games');
  cs2GameId = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
});

test('GET /api/digest requires a playerId', async () => {
  const res = await request(app).get('/api/digest');
  assert.equal(res.status, 400);
});

test('GET /api/digest 404s for an unknown player', async () => {
  const res = await request(app).get('/api/digest?playerId=ghost');
  assert.equal(res.status, 404);
});

test('digest starts with nothing to report', async () => {
  const res = await request(app).get(`/api/digest?playerId=${playerId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.openVote, null);
  assert.deepEqual(res.body.readyMatches, []);
});

test('an open vote round the player has not voted in shows up as openVote', async () => {
  await request(app).post('/api/votes/start').send({ mode: 'single' });
  const res = await request(app).get(`/api/digest?playerId=${playerId}`);
  assert.ok(res.body.openVote);
  assert.equal(res.body.openVote.round, 1);
});

test('voting clears openVote from the digest', async () => {
  await request(app).post('/api/votes').send({ playerId, gameId });
  const res = await request(app).get(`/api/digest?playerId=${playerId}`);
  assert.equal(res.body.openVote, null);
  await request(app).post('/api/votes/close');
});

test('a freshly created tournament match with both teams known shows up as ready', async () => {
  const tournament = await request(app)
    .post('/api/tournaments')
    .send({
      gameId,
      format: 'single_elimination',
      teams: [{ playerIds: [playerId] }, { playerIds: [otherPlayerId] }],
    });
  assert.equal(tournament.status, 201);

  const res = await request(app).get(`/api/digest?playerId=${playerId}`);
  assert.equal(res.body.readyMatches.length, 1);
  const match = res.body.readyMatches[0];
  assert.equal(match.tournamentId, tournament.body.id);
  assert.equal(match.myTeamName, tournament.body.teams.find((t: { players: Array<{ id: string }> }) =>
    t.players.some((p) => p.id === playerId)
  ).name);
  assert.notEqual(match.opponentTeamName, match.myTeamName);

  await request(app).delete(`/api/tournaments/${tournament.body.id}`);
});

test('a game currently being played by someone shows up as a missing skill for players who have not rated it', async () => {
  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: ['cs2.exe'] });

  const res = await request(app).get(`/api/digest?playerId=${otherPlayerId}`);
  assert.ok(res.body.missingSkills.some((g: { id: string }) => g.id === cs2GameId));

  await request(app).put('/api/skills').send({ playerId: otherPlayerId, gameId: cs2GameId, rating: 5 });
  const after = await request(app).get(`/api/digest?playerId=${otherPlayerId}`);
  assert.ok(!after.body.missingSkills.some((g: { id: string }) => g.id === cs2GameId));

  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: [] });
});
