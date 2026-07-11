// Downloadable SQLite snapshot. Intended as a quick safety net immediately
// before starting an event, without granting anyone filesystem access.

import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { config } from '../config';

export const backupRouter = Router();

backupRouter.get('/', async (_req, res, next) => {
  if (config.dbFile === ':memory:') {
    return res.status(409).json({ error: 'Für die In-Memory-Datenbank ist kein Datei-Backup verfügbar.' });
  }

  const filename = `respawnhq-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const backupPath = path.join(os.tmpdir(), `respawnhq-backup-${nanoid()}.sqlite`);
  try {
    await db.backup(backupPath);
    res.download(backupPath, filename, () => {
      fs.rm(backupPath, { force: true }, () => undefined);
    });
  } catch (err) {
    fs.rm(backupPath, { force: true }, () => undefined);
    next(err);
  }
});
