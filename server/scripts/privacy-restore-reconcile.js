'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

const [mode, receiptPath] = process.argv.slice(2);
if (!['--preview', '--apply'].includes(mode) || !receiptPath) {
  fail('Aufruf: npm run privacy:reconcile-restore -- --preview|--apply <loeschnachweise.json>');
  return;
}
if (!process.env.DB_FILE || process.env.DB_FILE === ':memory:') {
  fail('DB_FILE muss ausdrücklich auf die offline wiederhergestellte SQLite-Datei zeigen.');
  return;
}
if (mode === '--apply' && process.env.PRIVACY_RESTORE_CONFIRMED_OFFLINE !== '1') {
  fail('Für --apply muss PRIVACY_RESTORE_CONFIRMED_OFFLINE=1 bestätigen, dass die App gestoppt ist.');
  return;
}

let document;
try {
  document = JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
} catch (error) {
  fail(`Löschbelege konnten nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`);
  return;
}
if (document?.format !== 'respawn-deletion-receipts' || document?.version !== 1 || !Array.isArray(document.receipts)) {
  fail('Löschbeleg-Datei hat kein unterstütztes Respawn-Format.');
  return;
}

process.env.PRIVACY_RETENTION_ENABLED = '0';
const runtimeDir = fs.existsSync(path.join(__dirname, '..', 'dist', 'db.js')) ? '../dist' : '../dist-test';
const { db } = require(`${runtimeDir}/db`);
const { deletionReceiptHash, deleteAccount } = require(`${runtimeDir}/privacyService`);
const receiptHashes = new Set(
  document.receipts
    .map((receipt) => receipt?.subjectHash)
    .filter((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)),
);
const restoredIds = db.prepare('SELECT id FROM players').all()
  .map((row) => row.id)
  .filter((id) => receiptHashes.has(deletionReceiptHash(id)));

if (mode === '--preview') {
  console.log(JSON.stringify({ receiptCount: receiptHashes.size, restoredAccountsToDelete: restoredIds.length }, null, 2));
  db.close();
  return;
}

const failures = [];
for (const playerId of restoredIds) {
  const result = deleteAccount(playerId);
  if (!result.ok) failures.push({ subjectHash: deletionReceiptHash(playerId), code: result.code, remedy: result.message });
}
console.log(JSON.stringify({ matched: restoredIds.length, deleted: restoredIds.length - failures.length, failures }, null, 2));
db.close();
if (failures.length > 0) process.exitCode = 2;
