// Integration tests for the personal "missing skill rating" digest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;
let apiKey: string;
let otherPlayerId: string;
let cs2GameId: string;

test('setup: two players', async () => {
  const p = await request(app).post('/api/players').send({ name: 'Digest Tester' });
  playerId = p.body.id;
  apiKey = p.body.api_key;
  const other = await request(app).post('/api/players').send({ name: 'Digest Other' });
  otherPlayerId = other.body.id;
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
  assert.deepEqual(res.body.missingSkills, []);
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
