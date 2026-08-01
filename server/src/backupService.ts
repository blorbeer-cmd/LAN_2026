import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { config } from './config';
import { db } from './db';

export type BackupKind = 'manual' | 'pre-event';

export interface BackupRecord {
  filename: string;
  path: string;
  kind: BackupKind;
  createdAt: number;
  sizeBytes: number;
}

interface BackupFailure {
  at: number;
  message: string;
}

export interface BackupStatus {
  available: boolean;
  retention: number;
  latest: Omit<BackupRecord, 'path'> | null;
  lastFailure: BackupFailure | null;
}

let lastFailure: BackupFailure | null = null;
let backupQueue: Promise<void> = Promise.resolve();

function backupKind(filename: string): BackupKind | null {
  if (filename.startsWith('respawn-manual-')) return 'manual';
  if (filename.startsWith('respawn-pre-event-')) return 'pre-event';
  return null;
}

async function listBackups(): Promise<BackupRecord[]> {
  if (config.dbFile === ':memory:' || !config.backupDir) return [];
  let names: string[];
  try {
    names = await fs.promises.readdir(config.backupDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(
    names.map(async (filename): Promise<BackupRecord | null> => {
      const kind = backupKind(filename);
      if (!kind || !filename.endsWith('.sqlite')) return null;
      const backupPath = path.join(config.backupDir, filename);
      const stat = await fs.promises.stat(backupPath);
      if (!stat.isFile()) return null;
      return { filename, path: backupPath, kind, createdAt: stat.mtimeMs, sizeBytes: stat.size };
    }),
  );
  return records.filter((record): record is BackupRecord => record !== null).sort((a, b) => b.createdAt - a.createdAt);
}

export function verifyBackupFile(backupPath: string): void {
  const snapshot = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = snapshot.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`SQLite integrity_check: ${String(integrity)}`);
    const requiredTables = snapshot
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('app_state', 'events', 'players')")
      .all() as Array<{ name: string }>;
    if (requiredTables.length !== 3) throw new Error('Datei enthält kein vollständiges Respawn-Schema.');
  } finally {
    snapshot.close();
  }
}

async function createBackup(kind: BackupKind): Promise<BackupRecord | null> {
  if (config.dbFile === ':memory:' || !config.backupDir) return null;
  await fs.promises.mkdir(config.backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `respawn-${kind}-${timestamp}-${nanoid(6)}.sqlite`;
  const finalPath = path.join(config.backupDir, filename);
  const partialPath = `${finalPath}.partial`;
  try {
    await db.backup(partialPath);
    verifyBackupFile(partialPath);
    await fs.promises.rename(partialPath, finalPath);
    const stat = await fs.promises.stat(finalPath);
    const record = { filename, path: finalPath, kind, createdAt: stat.mtimeMs, sizeBytes: stat.size };

    const backups = await listBackups();
    const pruneResults = await Promise.allSettled(
      backups.slice(config.backupRetention).map((entry) => fs.promises.rm(entry.path, { force: true })),
    );
    const pruneFailure = pruneResults.find((result) => result.status === 'rejected');
    lastFailure = pruneFailure
      ? {
          at: Date.now(),
          message: `Snapshot erstellt, aber alte Sicherungen konnten nicht bereinigt werden: ${String(pruneFailure.reason)}`,
        }
      : null;
    return record;
  } catch (error) {
    await fs.promises.rm(partialPath, { force: true }).catch(() => undefined);
    lastFailure = {
      at: Date.now(),
      message: error instanceof Error ? error.message : 'Unbekannter Backup-Fehler',
    };
    throw error;
  }
}

export function createPersistentBackup(kind: BackupKind): Promise<BackupRecord | null> {
  const pending = backupQueue.then(() => createBackup(kind), () => createBackup(kind));
  backupQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const backups = await listBackups();
  const latest = backups[0];
  return {
    available: config.dbFile !== ':memory:' && Boolean(config.backupDir),
    retention: config.backupRetention,
    latest: latest
      ? {
          filename: latest.filename,
          kind: latest.kind,
          createdAt: latest.createdAt,
          sizeBytes: latest.sizeBytes,
        }
      : null,
    lastFailure,
  };
}
