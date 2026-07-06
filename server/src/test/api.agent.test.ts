// Integration tests for the agent report endpoint and the live-status board it
// feeds. Covers FR-09..14: auth via player API key, process-name matching,
// "since" preserved across repeated reports, and clearing on empty reports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let apiKey: string;
let playerId: string;
let cs2GameId: string;

test('setup: create a player and locate the seeded CS2 game', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Agent Tester' });
  playerId = player.body.id;
  apiKey = player.body.api_key;

  const games = await request(app).get('/api/games');
  const cs2 = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2');
  cs2GameId = cs2.id;
  assert.ok(apiKey && cs2GameId);
});

test('POST /api/agent/report without x-api-key is rejected', async () => {
  const res = await request(app).post('/api/agent/report').send({ processNames: [] });
  assert.equal(res.status, 401);
});

test('POST /api/agent/report with a wrong api key is rejected', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', 'not-a-real-key')
    .send({ processNames: [] });
  assert.equal(res.status, 401);
});

test('POST /api/agent/report rejects a non-array processNames', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: 'cs2.exe' });
  assert.equal(res.status, 400);
});

test('POST /api/agent/report matches a known process to its game', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['explorer.exe', 'CS2.EXE'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.gameId, cs2GameId);
});

test('GET /api/live shows the player as playing CS2', async () => {
  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.ok(entry);
  assert.equal(entry.state, 'playing');
  assert.equal(entry.game_id, cs2GameId);
  assert.ok(entry.since);
});

test('reporting the same game again keeps the original "since" timestamp', async () => {
  const before = await request(app).get('/api/live');
  const sinceBefore = before.body.find((r: { player_id: string }) => r.player_id === playerId).since;

  await new Promise((r) => setTimeout(r, 10));
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'] });

  const after = await request(app).get('/api/live');
  const sinceAfter = after.body.find((r: { player_id: string }) => r.player_id === playerId).since;
  assert.equal(sinceAfter, sinceBefore);
});

test('reporting no matching process clears the game and flips state to offline', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['notepad.exe'] });

  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.game_id, null);
  assert.equal(entry.state, 'offline');
});

test('a player with no report at all appears as offline on the board', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Never Reported' });
  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === other.body.id);
  assert.ok(entry);
  assert.equal(entry.state, 'offline');
});
