// Integration tests for the personalized agent-download ZIP. Whether the
// success path (streamed ZIP) or the graceful "not built yet" 503 applies
// depends on whether a prebuilt server/agent-dist/lan2026-agent.exe is
// present — the repo ships one, but a stripped-down deployment might not —
// so the test asserts whichever branch matches the actual repo state
// instead of hardcoding one of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp } from '../app';
import { buildAgentConfig } from '../routes/agentDownload';

const app = createApp();
const exeExists = fs.existsSync(
  path.join(__dirname, '..', '..', 'agent-dist', 'lan2026-agent.exe')
);
let playerId: string;

test('buildAgentConfig defaults trackActivity to off', () => {
  const config = buildAgentConfig('http://192.168.1.50:3000', 'the-key', undefined);
  assert.deepEqual(config, {
    serverUrl: 'http://192.168.1.50:3000',
    apiKey: 'the-key',
    pollIntervalMs: 10000,
    trackActivity: false,
  });
});

test('buildAgentConfig only turns trackActivity on for exactly "1"', () => {
  assert.equal(buildAgentConfig('http://x', 'k', '1').trackActivity, true);
  assert.equal(buildAgentConfig('http://x', 'k', 'true').trackActivity, false);
  assert.equal(buildAgentConfig('http://x', 'k', '0').trackActivity, false);
});

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

test('GET /api/agent-download streams a ZIP (or a clear 503 while the exe is missing)', async () => {
  const res = await request(app)
    .get(`/api/agent-download?playerId=${playerId}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  if (exeExists) {
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(res.headers['content-disposition'] ?? '', /RespawnHQ-Agent-Download_Tester\.zip/);
    // ZIP local-file-header magic ("PK\x03\x04") proves a real archive got
    // streamed, not an error page with ZIP headers.
    assert.equal((res.body as Buffer).subarray(0, 4).toString('binary'), 'PK\x03\x04');
  } else {
    assert.equal(res.status, 503);
    assert.match(JSON.parse((res.body as Buffer).toString()).error, /agent-dist/);
  }
});
