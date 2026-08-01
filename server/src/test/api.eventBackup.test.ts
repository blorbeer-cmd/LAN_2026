import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { config } from '../config';
import { createTestApp } from './testApp';

const app = createTestApp();
const mutableConfig = config as unknown as { dbFile: string; backupDir: string; backupRetention: number };
const original = {
  dbFile: mutableConfig.dbFile,
  backupDir: mutableConfig.backupDir,
  backupRetention: mutableConfig.backupRetention,
};
let tempDir = '';

after(async () => {
  mutableConfig.dbFile = original.dbFile;
  mutableConfig.backupDir = original.backupDir;
  mutableConfig.backupRetention = original.backupRetention;
  if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test('concurrent tracking starts create exactly one verified pre-event snapshot', async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'respawn-event-backup-'));
  mutableConfig.dbFile = path.join(tempDir, 'lan.sqlite');
  mutableConfig.backupDir = path.join(tempDir, 'backups');
  mutableConfig.backupRetention = 3;
  const event = await request(app)
    .post('/api/events')
    .send({ name: 'Backup Start', startsAt: Date.now(), endsAt: Date.now() + 60_000 });

  const starts = await Promise.all(
    Array.from({ length: 4 }, () => request(app).post(`/api/events/${event.body.id}/tracking/start`)),
  );
  assert.ok(starts.every((started) => started.status === 200), JSON.stringify(starts.map((started) => started.body)));
  const files = await fs.promises.readdir(mutableConfig.backupDir);
  assert.equal(files.filter((name) => name.startsWith('respawn-pre-event-') && name.endsWith('.sqlite')).length, 1);
  await request(app).post(`/api/events/${event.body.id}/tracking/stop`);
});

test('tracking stays off when the pre-event snapshot cannot be written', async () => {
  const blockedPath = path.join(tempDir, 'not-a-directory');
  await fs.promises.writeFile(blockedPath, 'blocked');
  mutableConfig.backupDir = blockedPath;
  const event = await request(app)
    .post('/api/events')
    .send({ name: 'Backup Failure', startsAt: Date.now(), endsAt: Date.now() + 60_000 });

  const originalConsoleError = console.error;
  console.error = () => undefined;
  const started = await (async () => {
    try {
      return await request(app).post(`/api/events/${event.body.id}/tracking/start`);
    } finally {
      console.error = originalConsoleError;
    }
  })();
  assert.equal(started.status, 503);
  assert.match(started.body.error, /abgebrochen/);
  const unchanged = await request(app).get(`/api/events/${event.body.id}`);
  assert.equal(unchanged.body.trackingEnabled, false);
});
