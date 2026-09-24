'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

const [mode, receiptPath] = process.argv.slice(2);
if (!['--preview', '--apply'].includes(mode)) {
  fail('Aufruf: npm run privacy:reconcile-restore -- --preview|--apply [loeschnachweise.json|jsonl]');
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

process.env.PRIVACY_RETENTION_ENABLED = '0';
const runtimeDir = fs.existsSync(path.join(__dirname, '..', 'dist', 'db.js')) ? '../dist' : '../dist-test';
const { config } = require(`${runtimeDir}/config`);
if (!receiptPath && (!config.deletionLedgerFile || !fs.existsSync(config.deletionLedgerFile))) {
  fail(`Ledger fehlt: ${config.deletionLedgerFile || '(kein Pfad)'}. Vollständige Löschbelege als letzten Parameter übergeben oder den Ledger-Pfad prüfen.`);
  return;
}
const { db } = require(`${runtimeDir}/db`);
const { deletionReceiptHash, deleteAccount, listDeletionReceipts, parseDeletionLedger } = require(`${runtimeDir}/privacyService`);
let receipts;
try {
  if (!receiptPath) {
    receipts = listDeletionReceipts();
  } else {
    const content = fs.readFileSync(path.resolve(receiptPath), 'utf8');
    let document;
    try { document = JSON.parse(content); } catch { /* JSONL is parsed below. */ }
    if (document?.format === 'respawn-deletion-receipts' && document.version === 1 && Array.isArray(document.receipts)) {
      receipts = document.receipts;
    } else if (document !== undefined) {
      throw new Error('Datei hat kein unterstütztes Respawn-Format.');
    } else {
      receipts = parseDeletionLedger(content);
    }
  }
} catch (error) {
  db.close();
  fail(`Löschbelege konnten nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`);
  return;
}
const receiptHashes = new Set(
  receipts
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
