// Integration tests for playtime tracking (FR-29): sessions opened/closed by
// agent reports, and the aggregated /api/stats/playtime endpoint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let apiKey: string;
let playerId: string;
let cs2GameId: string;

test('setup: a player and the seeded CS2 game', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Playtime Tester' });
  playerId = player.body.id;
  apiKey = player.body.api_key;
  const games = await request(app).get('/api/games');
  cs2GameId = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
});

test('GET /api/stats/playtime is empty before any session', async () => {
  const res = await request(app).get('/api/stats/playtime');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.entries.filter((e: { playerId: string }) => e.playerId === playerId),
    []
  );
});

test('an ongoing session (no stop report yet) already counts some playtime', async () => {
  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: ['cs2.exe'] });
  await new Promise((r) => setTimeout(r, 50));

  const res = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const entry = res.body.entries.find((e: { playerId: string }) => e.playerId === playerId);
  assert.ok(entry, 'expected an in-progress session to already show up');
  assert.ok(entry.totalMs > 0);
});

test('stopping the game closes the session and playtime stops growing', async () => {
  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: [] });

  const first = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const firstMs = first.body.entries.find((e: { playerId: string }) => e.playerId === playerId).totalMs;

  await new Promise((r) => setTimeout(r, 60));

  const second = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const secondMs = second.body.entries.find((e: { playerId: string }) => e.playerId === playerId).totalMs;

  assert.equal(firstMs, secondMs, 'closed session must not keep accumulating time');
});

test('a second session on the same game adds to the total instead of replacing it', async () => {
  const before = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const beforeMs = before.body.entries.find((e: { playerId: string }) => e.playerId === playerId).totalMs;

  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: ['cs2.exe'] });
  await new Promise((r) => setTimeout(r, 50));
  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: [] });

  const after = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const afterMs = after.body.entries.find((e: { playerId: string }) => e.playerId === playerId).totalMs;

  assert.ok(afterMs > beforeMs, 'second session should add on top of the first');
});

test('GET /api/stats/playtime totals aggregate across games for the same player', async () => {
  const res = await request(app).get('/api/stats/playtime');
  const total = res.body.totals.find((t: { playerId: string }) => t.playerId === playerId);
  assert.ok(total);
  assert.ok(total.formatted); // e.g. "1m" or "45m"
});

test('GET /api/stats/playtime totalsByGame aggregates across all players for CS2', async () => {
  // A second player also plays a CS2 session, so the per-game total should
  // exceed what any single player racked up alone.
  const other = await request(app).post('/api/players').send({ name: 'Playtime Tester 2' });
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', other.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  await new Promise((r) => setTimeout(r, 50));
  await request(app).post('/api/agent/report').set('x-api-key', other.body.api_key).send({ processNames: [] });

  const res = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const gameTotal = res.body.totalsByGame.find((g: { gameId: string }) => g.gameId === cs2GameId);
  const player1Ms = res.body.entries.find((e: { playerId: string }) => e.playerId === playerId).totalMs;
  const player2Ms = res.body.entries.find((e: { playerId: string }) => e.playerId === other.body.id).totalMs;

  assert.ok(gameTotal);
  assert.equal(gameTotal.totalMs, player1Ms + player2Ms);
  assert.equal(gameTotal.gameName, 'Counter-Strike 2');
});
