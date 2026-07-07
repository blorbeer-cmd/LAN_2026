// Integration tests for the optional activity-tracking extension to agent
// reports: crediting active_ms only when the reported foreground process
// matches the currently-running game and the system isn't idle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let apiKey: string;
let playerId: string;
let cs2GameId: string;

test('setup: a player and the seeded CS2 game', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Activity Tester' });
  playerId = player.body.id;
  apiKey = player.body.api_key;
  const games = await request(app).get('/api/games');
  cs2GameId = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
});

test('without foreground info, active playtime stays at 0', async () => {
  await request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames: ['cs2.exe'] });
  await new Promise((r) => setTimeout(r, 60));
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'] }); // no foregroundProcessName/idleSeconds sent

  const res = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const entry = res.body.entries.find((e: { playerId: string }) => e.playerId === playerId);
  assert.equal(entry.activeMs, 0);
  assert.ok(entry.totalMs > 0, 'total playtime should still accrue regardless');
});

test('reporting cs2.exe as focused and not idle credits active time', async () => {
  await new Promise((r) => setTimeout(r, 60));
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'], foregroundProcessName: 'CS2.EXE', idleSeconds: 0 });

  const res = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const entry = res.body.entries.find((e: { playerId: string }) => e.playerId === playerId);
  assert.ok(entry.activeMs > 0, 'active time should now be credited');
  assert.ok(entry.activeMs <= entry.totalMs);
});

test('reporting a different foreground process does not credit active time for this tick', async () => {
  const before = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const beforeMs = before.body.entries.find((e: { playerId: string }) => e.playerId === playerId).activeMs;

  await new Promise((r) => setTimeout(r, 60));
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'], foregroundProcessName: 'discord.exe', idleSeconds: 0 });

  const after = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const afterMs = after.body.entries.find((e: { playerId: string }) => e.playerId === playerId).activeMs;
  assert.equal(afterMs, beforeMs, 'active time must not grow while something else has focus');
});

test('reporting cs2.exe focused but idle past the threshold does not credit active time', async () => {
  const before = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const beforeMs = before.body.entries.find((e: { playerId: string }) => e.playerId === playerId).activeMs;

  await new Promise((r) => setTimeout(r, 60));
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'], foregroundProcessName: 'cs2.exe', idleSeconds: 999 });

  const after = await request(app).get(`/api/stats/playtime?gameId=${cs2GameId}`);
  const afterMs = after.body.entries.find((e: { playerId: string }) => e.playerId === playerId).activeMs;
  assert.equal(afterMs, beforeMs, 'idle past the threshold must not count as active');
});

test('POST /api/agent/report rejects a non-string foregroundProcessName', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'], foregroundProcessName: 123 });
  assert.equal(res.status, 400);
});

test('POST /api/agent/report rejects a non-numeric idleSeconds', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'], idleSeconds: 'a lot' });
  assert.equal(res.status, 400);
});
