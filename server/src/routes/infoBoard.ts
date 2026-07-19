// Group/event-scoped Info Board storage. Socket and kiosk delivery are a
// later phase; this router exposes only durable CRUD data.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { isNonEmptyString } from '../validation';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { requireGroupRole } from '../groupAuthorization';
import { resolveGroupEventScope } from '../groupEventScope';

export const infoBoardRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_CONTENT_LENGTH = 1000;

interface InfoRow {
  id: string;
  group_id: string;
  event_id: string | null;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

function serialize(row: InfoRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    eventId: row.event_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

infoBoardRouter.get('/', (req, res) => {
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const rows = db
    .prepare('SELECT * FROM info_entries WHERE group_id = ? AND event_id IS ? ORDER BY created_at')
    .all(req.group!.id, scope.eventId) as InfoRow[];
  res.json({ entries: rows.map(serialize), summary: { total: rows.length } });
});

infoBoardRouter.post('/', requireGroupRole('admin'), (req, res) => {
  const { title, content, eventId } = req.body ?? {};
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen).` });
  }
  if (!isNonEmptyString(content, MAX_CONTENT_LENGTH)) {
    return res.status(400).json({ error: `Inhalt ist erforderlich (1-${MAX_CONTENT_LENGTH} Zeichen).` });
  }
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const now = Date.now();
  const row: InfoRow = {
    id: nanoid(),
    group_id: req.group!.id,
    event_id: scope.eventId,
    title: title.trim(),
    content: content.trim(),
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO info_entries (id, group_id, event_id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.group_id, row.event_id, row.title, row.content, row.created_at, row.updated_at);
  res.status(201).json(serialize(row));
});

infoBoardRouter.patch('/:id', requireGroupRole('admin'), (req, res) => {
  const existing = db
    .prepare('SELECT * FROM info_entries WHERE id = ? AND group_id = ?')
    .get(req.params.id, req.group!.id) as InfoRow | undefined;
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
  db.prepare('UPDATE info_entries SET title = ?, content = ?, updated_at = ? WHERE id = ? AND group_id = ?').run(
    next.title,
    next.content,
    next.updated_at,
    existing.id,
    existing.group_id,
  );
  res.json(serialize({ ...existing, ...next }));
});

infoBoardRouter.delete('/:id', requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  const result = db.prepare('DELETE FROM info_entries WHERE id = ? AND group_id = ?').run(req.params.id, req.group!.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.group!.id,
    action: 'info_deleted',
    targetType: 'info_entry',
    targetId: req.params.id,
  });
  res.status(204).end();
});
