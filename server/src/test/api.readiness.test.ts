import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { config } from '../config';
import { db } from '../db';
import { createTestApp, enableTestTracking } from './testApp';

const app = createTestApp();

test('GET /api/admin/readiness reports all operational checks', async () => {
  const res = await request(app).get('/api/admin/readiness');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.generatedAt, 'number');
  assert.ok(['ready', 'warning', 'error'].includes(res.body.overall));
  assert.deepEqual(
    new Set(res.body.checks.map((check: { id: string }) => check.id)),
    new Set(['database', 'event', 'agents', 'process-mappings', 'kiosk', 'backup']),
  );
  assert.equal(res.body.checks.find((check: { id: string }) => check.id === 'backup').status, 'warning');
});

test('readiness exposes missing process mappings and agent version drift', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Readiness Agent' });
  enableTestTracking(player.body.id);
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', player.body.api_key)
    .send({ processNames: [], agentVersion: '0.9.0' });
  await request(app).post('/api/games').send({ name: 'Readiness unmapped game', status: 'catalog' });

  const res = await request(app).get('/api/admin/readiness');
  assert.equal(res.status, 200);
  const agents = res.body.checks.find((check: { id: string }) => check.id === 'agents');
  assert.equal(agents.status, 'warning');
  assert.ok(agents.details.some((detail: string) => detail.includes('Readiness Agent')));
  const mappings = res.body.checks.find((check: { id: string }) => check.id === 'process-mappings');
  assert.equal(mappings.status, 'warning');
  assert.ok(mappings.details.some((detail: string) => detail.includes('Readiness unmapped game')));

  db.prepare('UPDATE agent_diagnostics SET agent_version = ?, last_report_at = ? WHERE player_id = ?').run(
    config.expectedAgentVersion,
    Date.now() - config.offlineTimeoutMs - 1,
    player.body.id,
  );
  const offlineRes = await request(app).get('/api/admin/readiness');
  const offlineAgents = offlineRes.body.checks.find((check: { id: string }) => check.id === 'agents');
  assert.equal(offlineAgents.status, 'warning');
  assert.ok(offlineAgents.details.some((detail: string) => detail.includes('Agent offline: Readiness Agent')));
});

test('a broken backup location is isolated to the backup check', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'respawn-readiness-test-'));
  const invalidBackupDir = path.join(tempDir, 'not-a-directory');
  await fs.promises.writeFile(invalidBackupDir, 'blocked');
  const mutableConfig = config as unknown as { dbFile: string; backupDir: string };
  const original = { dbFile: mutableConfig.dbFile, backupDir: mutableConfig.backupDir };
  mutableConfig.dbFile = path.join(tempDir, 'lan.sqlite');
  mutableConfig.backupDir = invalidBackupDir;
  try {
    const res = await request(app).get('/api/admin/readiness');
    assert.equal(res.status, 200);
    assert.equal(res.body.checks.length, 6);
    const backup = res.body.checks.find((check: { id: string }) => check.id === 'backup');
    assert.equal(backup.status, 'error');
    assert.match(backup.summary, /nicht gelesen/);
  } finally {
    mutableConfig.dbFile = original.dbFile;
    mutableConfig.backupDir = original.backupDir;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});
