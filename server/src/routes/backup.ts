// Downloadable persistent SQLite snapshot. The same verified service also
// creates the mandatory pre-event restore point.

import { Router } from 'express';
import { config } from '../config';
import { requireAdmin } from '../auth';
import { requireRecentReauthentication } from '../sessions';
import { createPersistentBackup } from '../backupService';

export const backupRouter = Router();

backupRouter.get('/', requireAdmin, requireRecentReauthentication, async (_req, res, next) => {
  if (config.dbFile === ':memory:') {
    return res.status(409).json({ error: 'Für die In-Memory-Datenbank ist kein Datei-Backup verfügbar.' });
  }

  try {
    const backup = await createPersistentBackup('manual');
    if (!backup) return res.status(409).json({ error: 'Für diese Datenbank ist kein Datei-Backup verfügbar.' });
    res.download(backup.path, backup.filename, (error) => {
      if (error) next(error);
    });
  } catch (err) {
    next(err);
  }
});
