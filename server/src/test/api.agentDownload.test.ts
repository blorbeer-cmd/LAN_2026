// Integration tests for the personalized agent-download ZIP. The actual
// ZIP-streaming path needs a real prebuilt lan2026-agent.exe in
// server/agent-dist/ (see its README — building it needs real internet
// access this environment doesn't have), so these cover request validation
// and the graceful "not built yet" fallback, which is the real state of a
// freshly cloned repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerId: string;

test('setup: a player', async () => {
  const p = await request(app).post('/api/players').send({ name: 'Download Tester' });
  playerId = p.body.id;
});

test('GET /api/agent-download requires a playerId', async () => {
  const res = await request(app).get('/api/agent-download');
  assert.equal(res.status, 400);
});

test('GET /api/agent-download 404s for an unknown player', async () => {
  const res = await request(app).get('/api/agent-download?playerId=ghost');
  assert.equal(res.status, 404);
});

test('GET /api/agent-download responds with a clear 503 while the exe has not been built yet', async () => {
  const res = await request(app).get(`/api/agent-download?playerId=${playerId}`);
  assert.equal(res.status, 503);
  assert.match(res.body.error, /agent-dist/);
});
