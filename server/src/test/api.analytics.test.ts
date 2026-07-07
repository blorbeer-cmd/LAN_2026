// Integration tests for the deeper analytics endpoints: longest sessions,
// simultaneous-game time, the raw session log, day/time filtering, and the
// per-game concurrency timeseries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let cs2GameId: string;
let rlGameId: string;
let playerA: string;
let apiKeyA: string;
let playerB: string;
let apiKeyB: string;

async function report(apiKey: string, processNames: string[]) {
  return request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames });
}

test('setup: two players and two seeded games', async () => {
  const a = await request(app).post('/api/players').send({ name: 'Analytics A' });
  const b = await request(app).post('/api/players').send({ name: 'Analytics B' });
  playerA = a.body.id;
  apiKeyA = a.body.api_key;
  playerB = b.body.id;
  apiKeyB = b.body.api_key;

  const games = await request(app).get('/api/games');
  cs2GameId = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
  rlGameId = games.body.find((g: { name: string }) => g.name === 'Rocket League').id;
});

test('GET /api/analytics/overview is empty before any sessions', async () => {
  const res = await request(app).get(`/api/analytics/overview?gameId=${cs2GameId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.longestSessionsPerPlayerGame, []);
});

test('longest session and simultaneous-game time reflect real sessions', async () => {
  // Player A opens both CS2 and Rocket League at once (multitasking).
  await report(apiKeyA, ['cs2.exe', 'rocketleague.exe']);
  await new Promise((r) => setTimeout(r, 60));
  // Player B just plays CS2 alone, briefly.
  await report(apiKeyB, ['cs2.exe']);
  await new Promise((r) => setTimeout(r, 60));
  await report(apiKeyB, []);
  await new Promise((r) => setTimeout(r, 60));
  await report(apiKeyA, []); // A closes everything

  const res = await request(app).get('/api/analytics/overview');
  assert.equal(res.status, 200);

  const cs2Record = res.body.longestSessionsPerGame.find((r: { gameId: string }) => r.gameId === cs2GameId);
  assert.ok(cs2Record);

  const aSimultaneous = res.body.simultaneousGameTime.find((r: { playerId: string }) => r.playerId === playerA);
  assert.ok(aSimultaneous, 'player A should show up in the multitasking list');
  assert.ok(aSimultaneous.maxSimultaneous >= 2);
  assert.ok(aSimultaneous.multiGameMs > 0);

  // Player B never had 2 games open, so shouldn't appear (filtered to >0).
  const bSimultaneous = res.body.simultaneousGameTime.find((r: { playerId: string }) => r.playerId === playerB);
  assert.equal(bSimultaneous, undefined);
});

test('GET /api/analytics/sessions returns a chronological log with names', async () => {
  const res = await request(app).get(`/api/analytics/sessions?playerId=${playerA}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 2); // CS2 + Rocket League sessions for player A
  assert.ok(res.body.every((s: { playerName: string }) => s.playerName === 'Analytics A'));
});

test('GET /api/analytics/sessions filters by gameId', async () => {
  const res = await request(app).get(`/api/analytics/sessions?gameId=${rlGameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.every((s: { gameId: string }) => s.gameId === rlGameId));
});

test('day/time range filtering excludes sessions outside the window', async () => {
  const farFuture = Date.now() + 24 * 60 * 60 * 1000;
  const res = await request(app).get(`/api/analytics/sessions?from=${farFuture}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('GET /api/analytics/overview rejects from > to', async () => {
  const res = await request(app).get('/api/analytics/overview?from=2000&to=1000');
  assert.equal(res.status, 400);
});

test('GET /api/analytics/concurrency requires gameId, from and to', async () => {
  const missingGame = await request(app).get('/api/analytics/concurrency?from=0&to=1000');
  assert.equal(missingGame.status, 400);

  const missingRange = await request(app).get(`/api/analytics/concurrency?gameId=${cs2GameId}`);
  assert.equal(missingRange.status, 400);
});

test('GET /api/analytics/concurrency buckets sessions for one game over a range', async () => {
  const from = Date.now() - 60_000;
  const to = Date.now() + 60_000;
  const res = await request(app).get(
    `/api/analytics/concurrency?gameId=${cs2GameId}&from=${from}&to=${to}&bucketMinutes=1`
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.gameId, cs2GameId);
  assert.ok(Array.isArray(res.body.buckets));
  assert.ok(res.body.buckets.length >= 1);
});

test('GET /api/analytics/concurrency rejects an out-of-range bucketMinutes', async () => {
  const res = await request(app).get(
    `/api/analytics/concurrency?gameId=${cs2GameId}&from=0&to=1000&bucketMinutes=0`
  );
  assert.equal(res.status, 400);
});

test('GET /api/analytics/awards includes the Marathon-Zocker award with a player name', async () => {
  const res = await request(app).get('/api/analytics/awards');
  assert.equal(res.status, 200);
  const marathon = res.body.awards.find((a: { id: string }) => a.id === 'marathon');
  assert.ok(marathon);
  assert.ok(marathon.playerName);
  assert.ok(marathon.value);
});

test('GET /api/analytics/awards rejects from > to', async () => {
  const res = await request(app).get('/api/analytics/awards?from=2000&to=1000');
  assert.equal(res.status, 400);
});
