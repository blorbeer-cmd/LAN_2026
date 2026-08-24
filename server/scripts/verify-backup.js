'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const input = process.argv[2];
if (!input) {
  console.error('Verwendung: npm run backup:verify -- <pfad-zum-backup.sqlite>');
  process.exit(2);
}

const backupPath = path.resolve(input);
let snapshot;
try {
  snapshot = new Database(backupPath, { readonly: true, fileMustExist: true });
  const integrity = snapshot.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`SQLite integrity_check: ${String(integrity)}`);
  const tables = snapshot
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('app_state', 'events', 'players')")
    .all();
  if (tables.length !== 3) throw new Error('Datei enthält kein vollständiges Respawn-Schema.');
  console.log(`Backup gültig: ${backupPath}`);
} catch (error) {
  console.error(`Backup ungültig: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  snapshot?.close();
}
