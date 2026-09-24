import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

// OPERATIONS.md runs this script inside the production container before a
// restored backup may go live. The runtime stage copies operator scripts one
// by one, so a missing COPY would only surface during a real restore.
test('the runtime image ships the restore reconciliation script', async () => {
  const dockerfile = await readFile(path.join(scriptDir, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY[^\n]*scripts\/privacy-restore-reconcile\.js \.\/scripts\/privacy-restore-reconcile\.js/);
});

test('restore reconciliation previews and reapplies hash-only account deletions offline', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'respawn-privacy-restore-'));
  const database = path.join(directory, 'restore.sqlite');
  const receipts = path.join(directory, 'deletion-receipts.json');
  const ledger = path.join(directory, 'durable', 'deletion-receipts.jsonl');
  const playerId = 'restored-deleted-player';
  const subjectHash = createHash('sha256').update(playerId).digest('hex');
  const env = {
    ...process.env,
    DB_FILE: database,
    NODE_ENV: 'test',
    PRIVACY_DELETION_LEDGER_FILE: ledger,
  };
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
    assert.equal(run(['--preview'], env).restoredAccountsToDelete, 0, 'the durable ledger works without a manual export');
    const recordedReceiptCount = Number(execFileSync(
      process.execPath,
      [
        '-e',
        `const { db } = require(${JSON.stringify(dbModule)}); const { listDeletionReceipts } = require(${JSON.stringify(privacyServiceModule)}); console.log(listDeletionReceipts().length); db.close();`,
      ],
      { env, encoding: 'utf8' },
    ).trim());
    assert.equal(recordedReceiptCount, 1, 'restore reconciliation persists a fresh deletion receipt durably');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restore preview uses the default ledger and refuses a missing ledger', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'respawn-privacy-default-ledger-'));
  const database = path.join(directory, 'restore.sqlite');
  const playerId = 'restored-default-ledger-player';
  const subjectHash = createHash('sha256').update(playerId).digest('hex');
  const { PRIVACY_DELETION_LEDGER_FILE: _unused, ...withoutOverride } = process.env;
  const env = { ...withoutOverride, DB_FILE: database, NODE_ENV: 'test' };
  try {
    execFileSync(process.execPath, ['-e',
      `const { db } = require(${JSON.stringify(dbModule)}); db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(${JSON.stringify(playerId)}, 'Restore Person', 'restore-default-key', Date.now()); db.close();`,
    ], { env });
    assert.throws(() => run(['--preview'], env), /Command failed/);
    const ledger = path.join(directory, 'deletion-receipts.jsonl');
    await writeFile(ledger,
      `${JSON.stringify({ subjectHash, deletedAt: Date.now(), action: 'player_self_deleted', attemptId: 'failed-attempt' })}\n`);
    assert.equal(run(['--preview'], env).restoredAccountsToDelete, 1);
    await appendFile(ledger, `${JSON.stringify({ cancelledAttemptId: 'failed-attempt' })}\n`);
    assert.equal(run(['--preview'], env).restoredAccountsToDelete, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
