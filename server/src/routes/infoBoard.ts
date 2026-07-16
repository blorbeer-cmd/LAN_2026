// Info-Board: the pinned answers to the questions everyone asks five times
// per evening — WLAN password, Discord/TeamSpeak link, game-server IPs,
// house rules. Plain title+content entries with full CRUD, editable by
// anyone (LAN trust model), pushed to every device on change.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString } from '../validation';
import { requireAdmin } from '../auth';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';

export const infoBoardRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_CONTENT_LENGTH = 1000;

interface InfoRow {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

function buildList() {
  const rows = db
    .prepare('SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt FROM info_entries ORDER BY created_at')
    .all();
  return { entries: rows };
}

// GET /api/info - all entries, oldest first (stable reading order).
infoBoardRouter.get('/', (_req, res) => {
  res.json(buildList());
});

// POST /api/info - body: { title, content }
infoBoardRouter.post('/', (req, res) => {
  const { title, content } = req.body ?? {};
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen).` });
  }
  if (!isNonEmptyString(content, MAX_CONTENT_LENGTH)) {
    return res.status(400).json({ error: `Inhalt ist erforderlich (1-${MAX_CONTENT_LENGTH} Zeichen).` });
  }
  const now = Date.now();
  const row: InfoRow = { id: nanoid(), title: title.trim(), content: content.trim(), created_at: now, updated_at: now };
  db.prepare('INSERT INTO info_entries (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    row.id,
    row.title,
    row.content,
    row.created_at,
    row.updated_at
  );
  broadcast(Events.infoChanged, null);
  res.status(201).json(row);
});

// PATCH /api/info/:id - body: { title?, content? }
infoBoardRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM info_entries WHERE id = ?').get(req.params.id) as
    | InfoRow
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });

  const { title, content } = req.body ?? {};
  if (title !== undefined && !isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel muss 1-${MAX_TITLE_LENGTH} Zeichen lang sein.` });
  }
  if (content !== undefined && !isNonEmptyString(content, MAX_CONTENT_LENGTH)) {
    return res.status(400).json({ error: `Inhalt muss 1-${MAX_CONTENT_LENGTH} Zeichen lang sein.` });
  }

  const next = {
    title: title !== undefined ? title.trim() : existing.title,
    content: content !== undefined ? content.trim() : existing.content,
    updated_at: Date.now(),
  };
  db.prepare('UPDATE info_entries SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(
    next.title,
    next.content,
    next.updated_at,
    existing.id
  );
  broadcast(Events.infoChanged, null);
  res.json({ ...existing, ...next });
});

// DELETE /api/info/:id
infoBoardRouter.delete('/:id', requireAdmin, requireRecentReauthentication, (req, res) => {
  const result = db.prepare('DELETE FROM info_entries WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  writeAdminAudit({ actorPlayerId: req.player?.id, action: 'info_deleted', targetType: 'info_entry', targetId: req.params.id });
  broadcast(Events.infoChanged, null);
  res.status(204).end();
});
