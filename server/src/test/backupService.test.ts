import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';
import { createPersistentBackup, getBackupStatus, verifyBackupFile } from '../backupService';

const mutableConfig = config as unknown as {
  dbFile: string;
  backupDir: string;
  backupRetention: number;
};
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

test('in-memory databases report backups as unavailable', async () => {
  assert.equal(await createPersistentBackup('manual'), null);
  assert.equal((await getBackupStatus()).available, false);
});

test('persistent backups are verified and pruned to the configured retention', async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'respawn-backup-test-'));
  mutableConfig.dbFile = path.join(tempDir, 'lan.sqlite');
  mutableConfig.backupDir = path.join(tempDir, 'backups');
  mutableConfig.backupRetention = 2;

  await createPersistentBackup('manual');
  await createPersistentBackup('pre-event');
  const latest = await createPersistentBackup('manual');
  assert.ok(latest);
  verifyBackupFile(latest.path);

  const files = await fs.promises.readdir(mutableConfig.backupDir);
  assert.equal(files.filter((name) => name.endsWith('.sqlite')).length, 2);
  const status = await getBackupStatus();
  assert.equal(status.available, true);
  assert.equal(status.retention, 2);
  assert.equal(status.latest?.filename, latest.filename);
  assert.equal(status.latest?.kind, 'manual');
  assert.ok((status.latest?.sizeBytes ?? 0) > 0);
});
