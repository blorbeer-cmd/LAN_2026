import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const reconcileScript = path.join(scriptDir, 'privacy-restore-reconcile.js');
const dbModule = path.join(scriptDir, '..', 'dist-test', 'db.js');
const privacyServiceModule = path.join(scriptDir, '..', 'dist-test', 'privacyService.js');

function run(args, env) {
  return JSON.parse(execFileSync(process.execPath, [reconcileScript, ...args], { env, encoding: 'utf8' }));
}

test('restore reconciliation previews and reapplies hash-only account deletions offline', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'respawn-privacy-restore-'));
  const database = path.join(directory, 'restore.sqlite');
  const receipts = path.join(directory, 'deletion-receipts.json');
  const playerId = 'restored-deleted-player';
  const subjectHash = createHash('sha256').update(playerId).digest('hex');
  const env = { ...process.env, DB_FILE: database, NODE_ENV: 'test' };
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const { db } = require(${JSON.stringify(dbModule)}); db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(${JSON.stringify(playerId)}, 'Restore Person', 'restore-key', Date.now()); db.close();`,
      ],
      { env },
    );
    await writeFile(
      receipts,
      JSON.stringify({
        format: 'respawn-deletion-receipts',
        version: 1,
        receipts: [{ subjectHash, deletedAt: Date.now(), action: 'player_self_deleted' }],
      }),
    );

    assert.equal(run(['--preview', receipts], env).restoredAccountsToDelete, 1);
    const applied = run(['--apply', receipts], { ...env, PRIVACY_RESTORE_CONFIRMED_OFFLINE: '1' });
    assert.deepEqual(applied.failures, []);
    assert.equal(applied.deleted, 1);
    assert.equal(run(['--preview', receipts], env).restoredAccountsToDelete, 0);
    const recordedReceiptCount = Number(execFileSync(
      process.execPath,
      [
        '-e',
        `const { db } = require(${JSON.stringify(dbModule)}); const { listDeletionReceipts } = require(${JSON.stringify(privacyServiceModule)}); console.log(listDeletionReceipts().length); db.close();`,
      ],
      { env, encoding: 'utf8' },
    ).trim());
    assert.equal(recordedReceiptCount, 1, 'restore reconciliation persists a fresh deletion receipt atomically');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
