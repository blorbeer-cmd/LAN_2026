// Packliste: two independent lists sharing one router.
//
// "Meine Packliste" (checklist_items) is private per player/event - a
// Grundstock of default items (DEFAULT_CHECKLIST_ITEMS) is materialized into
// real rows the first time a player fetches their list for the current
// event, so it can be freely checked off, extended and pruned per person
// without touching the shared defaults. It starts fresh for every event on
// purpose (a new LAN may need different gear), even though the Grundstock
// itself is the same list every time.
//
// "To-Dos" (checklist_tasks, docs/KONZEPT-PACKLISTE-TICKETS.md) is the
// shared pool: any active group member - not just an admin/owner - can
// distribute a to-do, either straight to one or several people or left open
// for anyone to claim, and any member can likewise post an open "kann mir
// jemand X mitnehmen"-style request. Both share one lifecycle - open
// (unassigned, in the pool) -> taken (an assignee is set, either directly by
// the creator or by someone claiming it) -> done, with cancelled as a
// separate terminal state for withdrawing something no longer needed.
// Claiming is immediate and binding (first request wins, same as a captain-
// draft pick) - no confirmation step. A batch-assignment to several people at
// once inserts one independent row per person sharing a batch_id, so each
// person's own progress (and own push topic) stays separate even though they
// were assigned together. Both creation routes accept an optional due_at
// (epoch ms) surfaced to the frontend as dueAt, purely a display/sort hint -
// nothing here enforces or reacts to it passing.
//
// event_id is null for "the group's room, no specific event" (resolved per
// request via resolveGroupEventScope) rather than the global sentinel -
// this is a group-owned feature, so the event scope must be resolved
// relative to req.group, never from the single global tracking event (see
// resolveGroupEventScope's own doc comment). Every :id-based mutation loads
// its row through resolveGroupResource, so a retained group_id mismatch stays
// hidden behind a 404.

import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString } from '../validation';
import { notifyPlayers, resolvePushTopic } from '../push';
import { withBodyPlayerIdentity, withQueryPlayerIdentity } from '../sessions';
import { requireGroupRole, resolveGroupResource } from '../groupAuthorization';
import { resolveGroupEventScope } from '../groupEventScope';
import { communicationRecipientIds } from '../communicationRecipients';
import { activeGroupPlayers } from '../groupPlayers';
import { DEFAULT_CHECKLIST_ITEMS } from '../checklistDefaults';

export const checklistRouter = Router();

const MAX_ITEM_LABEL = 80;
const MAX_TASK_TITLE = 80;
const MAX_TASK_DESCRIPTION = 300;
const MAX_CLAIM_COMMENT = 200;
const MAX_BATCH_ASSIGNEES = 30; // generous over the ~15-person LAN this is sized for

interface ItemRow {
  id: string;
  group_id: string;
  event_id: string | null;
  player_id: string;
  label: string;
  template_key: string | null;
  checked_at: number | null;
  created_at: number;
}

interface TaskRow {
  id: string;
  group_id: string;
  event_id: string | null;
  type: 'todo' | 'item_request';
  title: string;
  description: string | null;
  created_by: string;
  assignee_id: string | null;
  batch_id: string | null;
  status: 'open' | 'taken' | 'done' | 'cancelled';
  created_at: number;
  taken_at: number | null;
  done_at: number | null;
  cancelled_at: number | null;
  claim_comment: string | null;
  due_at: number | null;
}

function serializeItem(row: ItemRow) {
  return {
    id: row.id,
    label: row.label,
    isCustom: row.template_key === null,
    checked: row.checked_at !== null,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}

function playerRef(id: string | null): { id: string; name: string; color: string; avatar: string | null } | null {
  if (!id) return null;
  const row = db.prepare('SELECT id, name, color, avatar FROM players WHERE id = ?').get(id) as
    | { id: string; name: string; color: string; avatar: string | null }
    | undefined;
  return row ?? null;
}

function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    createdBy: playerRef(row.created_by),
    assignee: playerRef(row.assignee_id),
    batchId: row.batch_id,
    status: row.status,
    createdAt: row.created_at,
    takenAt: row.taken_at,
    doneAt: row.done_at,
    cancelledAt: row.cancelled_at,
    claimComment: row.claim_comment,
    dueAt: row.due_at,
  };
}

// Optional due date (epoch ms), same shape/convention as events.ts's own
// timestamp parser. undefined/null both mean "no due date" (returns null);
// anything else must be a finite number, or creation is rejected instead of
// silently storing a garbage value.
function parseOptionalDueAt(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'dueAt muss ein Zeitstempel (ms) sein.' };
  }
  return { ok: true, value };
}

// Inserts the Grundstock exactly once per player/event (tracked in
// checklist_materializations, not just inferred from existing rows - a
// deliberately deleted default item must never come back on a later fetch),
// spacing created_at by 1ms per entry so materialization stays deterministic;
// the API sorts the visible list alphabetically below.
function ensureDefaultItems(groupId: string, eventId: string | null, playerId: string): void {
  const already = db
    .prepare('SELECT 1 FROM checklist_materializations WHERE group_id = ? AND event_id IS ? AND player_id = ?')
    .get(groupId, eventId, playerId);
  if (already) return;

  const insert = db.prepare(
    `INSERT INTO checklist_items (id, group_id, event_id, player_id, label, template_key, checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  const now = Date.now();
  db.transaction(() => {
    DEFAULT_CHECKLIST_ITEMS.forEach((entry, index) => {
      insert.run(nanoid(), groupId, eventId, playerId, entry.label, entry.key, now + index);
    });
    db.prepare(
      'INSERT OR IGNORE INTO checklist_materializations (group_id, event_id, player_id, materialized_at) VALUES (?, ?, ?, ?)',
    ).run(groupId, eventId, playerId, now);
  })();
}

function listItems(groupId: string, eventId: string | null, playerId: string): ItemRow[] {
  const items = db
    .prepare('SELECT * FROM checklist_items WHERE group_id = ? AND event_id IS ? AND player_id = ? ORDER BY created_at')
    .all(groupId, eventId, playerId) as ItemRow[];
  return items.sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
}

function getItem(id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id) as ItemRow | undefined;
}

function getTask(id: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM checklist_tasks WHERE id = ?').get(id) as TaskRow | undefined;
}

function listTasks(groupId: string, eventId: string | null): TaskRow[] {
  return db
    .prepare(
      `SELECT * FROM checklist_tasks WHERE group_id = ? AND event_id IS ? AND status != 'cancelled' ORDER BY created_at DESC`,
    )
    .all(groupId, eventId) as TaskRow[];
}

// A resource route never treats request scope as ownership evidence. The
// loader hands the resource's own group_id to resolveGroupResource, which
// re-verifies active membership for that retained scope before exposing it.
const resolveChecklistItem = resolveGroupResource<ItemRow>({
  resourceType: 'Packlisten-Position',
  load: (id) => {
    const row = getItem(id);
    return row ? { resource: row, groupId: row.group_id } : undefined;
  },
});

const resolveChecklistTask = resolveGroupResource<TaskRow>({
  resourceType: 'Aufgabe',
  load: (id) => {
    const row = getTask(id);
    return row ? { resource: row, groupId: row.group_id } : undefined;
  },
});

// Group owners/admins additionally moderate the shared pool (done/cancel on
// someone else's task) - creating and assigning a to-do no longer needs this
// role (see requireGroupRole('member') on POST /tasks/todo above). Deliberately
// *not* falling back to the global req.player.is_admin flag: that's an
// instance-wide moderation role unrelated to any specific group's management
// and must not let someone who merely has a "member" role in this group
// override its own admins/owner (see the required-mode regression in
// api.groupChecklist.required.test.ts).
// Legacy mode never populates req.groupMembership, so this is creator/
// assignee-only there - matching requireGroupRole's own legacy behavior of
// having no group-role concept to check in the first place.
function isChecklistModerator(req: Request): boolean {
  const role = req.groupMembership?.role;
  return role === 'owner' || role === 'admin';
}

// resolveGroupResource only re-verifies group membership - a task/item id
// from a *past* event in the very same group (e.g. right after an organizer
// switches which event is tracked) would otherwise stay mutable forever,
// even though GET no longer lists it in the current scope. Every id-based
// mutation calls this right after loading its row and 404s on a mismatch,
// same wording as "not found" since a stale id has no other legitimate use.
function currentEventScope(req: Request, res: Response): { eventId: string | null } | null {
  const scope = resolveGroupEventScope(req.group!.id, undefined);
  if (!scope.ok) {
    res.status(scope.status).json({ error: scope.error });
    return null;
  }
  return scope;
}

// GET /api/checklist/items?playerId=... - materializes the Grundstock (if not
// already done for this event) then returns the player's full personal list.
checklistRouter.get('/items', ...withQueryPlayerIdentity, (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const groupId = req.group!.id;
  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  ensureDefaultItems(groupId, scope.eventId, playerId);
  res.json({ items: listItems(groupId, scope.eventId, playerId).map(serializeItem) });
});

// POST /api/checklist/items - body: { playerId, label }. Adds one custom item.
checklistRouter.post('/items', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, label } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(label, MAX_ITEM_LABEL)) {
    return res.status(400).json({ error: `Bezeichnung ist erforderlich (1-${MAX_ITEM_LABEL} Zeichen).` });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const groupId = req.group!.id;
  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const row: ItemRow = {
    id: nanoid(),
    group_id: groupId,
    event_id: scope.eventId,
    player_id: playerId,
    label: label.trim(),
    template_key: null,
    checked_at: null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO checklist_items (id, group_id, event_id, player_id, label, template_key, checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(row.id, row.group_id, row.event_id, row.player_id, row.label, row.created_at);

  broadcast(Events.checklistChanged, { scope: 'items', playerId }, { groupId, eventId: scope.eventId });
  res.status(201).json(serializeItem(row));
});

// PATCH /api/checklist/items/:id - body: { playerId, checked }. Own items only.
checklistRouter.patch('/items/:id', resolveChecklistItem, ...withBodyPlayerIdentity, (req, res) => {
  const item = req.groupResource as ItemRow;
  const scope = currentEventScope(req, res);
  if (!scope) return;
  if (item.event_id !== scope.eventId) return res.status(404).json({ error: 'Position nicht gefunden.' });
  const { playerId, checked } = req.body ?? {};
  if (item.player_id !== playerId) {
    return res.status(403).json({ error: 'Nur die eigene Packliste kann bearbeitet werden.' });
  }
  if (typeof checked !== 'boolean') {
    return res.status(400).json({ error: 'checked muss true oder false sein.' });
  }

  const checkedAt = checked ? Date.now() : null;
  db.prepare('UPDATE checklist_items SET checked_at = ? WHERE id = ?').run(checkedAt, item.id);
  broadcast(Events.checklistChanged, { scope: 'items', playerId }, { groupId: item.group_id, eventId: item.event_id });
  res.json(serializeItem({ ...item, checked_at: checkedAt }));
});

// DELETE /api/checklist/items/:id - body: { playerId }. Own items only
// (including default ones - the list is meant to be freely pruned).
checklistRouter.delete('/items/:id', resolveChecklistItem, ...withBodyPlayerIdentity, (req, res) => {
  const item = req.groupResource as ItemRow;
  const scope = currentEventScope(req, res);
  if (!scope) return;
  if (item.event_id !== scope.eventId) return res.status(404).json({ error: 'Position nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (item.player_id !== playerId) {
    return res.status(403).json({ error: 'Nur die eigene Packliste kann bearbeitet werden.' });
  }

  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(item.id);
  broadcast(Events.checklistChanged, { scope: 'items', playerId }, { groupId: item.group_id, eventId: item.event_id });
  res.status(204).end();
});

// GET /api/checklist/tasks - every non-cancelled task/request for the
// current event, open and taken/done alike; the frontend splits them up.
checklistRouter.get('/tasks', (req, res) => {
  const groupId = req.group!.id;
  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  res.json({ tasks: listTasks(groupId, scope.eventId).map(serializeTask) });
});

// POST /api/checklist/tasks - body: { playerId, title, description?,
// assigneePlayerIds?, dueAt? }. Any member can post a "kann mir jemand X
// mitnehmen"-style request. Without assigneePlayerIds it starts open in the
// shared pool (the common case - a request is usually addressed to nobody in
// particular); the same optional direct-assignment shape as /tasks/todo lets
// someone address it straight at themselves or specific others instead of
// leaving it in the pool, mirroring the unified create form (docs/
// KONZEPT-PACKLISTE-TICKETS.md Abschnitt 6).
checklistRouter.post('/tasks', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, title, description, assigneePlayerIds, dueAt } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(title, MAX_TASK_TITLE)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TASK_TITLE} Zeichen).` });
  }
  if (description !== undefined && description !== null && !isNonEmptyString(description, MAX_TASK_DESCRIPTION)) {
    return res.status(400).json({ error: `Beschreibung darf höchstens ${MAX_TASK_DESCRIPTION} Zeichen lang sein.` });
  }
  const parsedDueAt = parseOptionalDueAt(dueAt);
  if (!parsedDueAt.ok) return res.status(400).json({ error: parsedDueAt.error });
  let assigneeIds: string[] = [];
  if (assigneePlayerIds !== undefined && assigneePlayerIds !== null) {
    if (
      !Array.isArray(assigneePlayerIds) ||
      assigneePlayerIds.length > MAX_BATCH_ASSIGNEES ||
      !assigneePlayerIds.every((id) => typeof id === 'string' && id)
    ) {
      return res.status(400).json({ error: 'assigneePlayerIds muss eine Liste von Spieler-IDs sein.' });
    }
    assigneeIds = [...new Set(assigneePlayerIds)];
  }
  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const groupId = req.group!.id;
  if (assigneeIds.length > 0 && activeGroupPlayers(groupId, assigneeIds).size !== assigneeIds.length) {
    return res.status(404).json({ error: 'Mindestens eine zugewiesene Person wurde nicht gefunden.' });
  }

  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const eventId = scope.eventId;
  const now = Date.now();
  const trimmedTitle = title.trim();
  const trimmedDescription = description ? description.trim() : null;
  const batchId = assigneeIds.length > 1 ? nanoid() : null;

  const insert = db.prepare(
    `INSERT INTO checklist_tasks (id, group_id, event_id, type, title, description, created_by, assignee_id, batch_id, status, created_at, taken_at, due_at)
     VALUES (?, ?, ?, 'item_request', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const rows: TaskRow[] =
    assigneeIds.length === 0
      ? [
          {
            id: nanoid(),
            group_id: groupId,
            event_id: eventId,
            type: 'item_request',
            title: trimmedTitle,
            description: trimmedDescription,
            created_by: playerId,
            assignee_id: null,
            batch_id: null,
            status: 'open',
            created_at: now,
            taken_at: null,
            done_at: null,
            cancelled_at: null,
            claim_comment: null,
            due_at: parsedDueAt.value,
          },
        ]
      : assigneeIds.map((assigneeId) => ({
          id: nanoid(),
          group_id: groupId,
          event_id: eventId,
          type: 'item_request' as const,
          title: trimmedTitle,
          description: trimmedDescription,
          created_by: playerId,
          assignee_id: assigneeId,
          batch_id: batchId,
          status: 'taken' as const,
          created_at: now,
          taken_at: now,
          done_at: null,
          cancelled_at: null,
          claim_comment: null,
          due_at: parsedDueAt.value,
        }));

  db.transaction(() => {
    for (const row of rows) {
      insert.run(row.id, row.group_id, row.event_id, row.title, row.description, row.created_by, row.assignee_id, row.batch_id, row.status, row.created_at, row.taken_at, row.due_at);
    }
  })();

  if (assigneeIds.length === 0) {
    const recipients = communicationRecipientIds(groupId, eventId).filter((id) => id !== playerId);
    notifyPlayers(
      recipients,
      { title: 'Neue Mitbring-Anfrage', body: `${player.name}: ${trimmedTitle}`, url: '/#checklist' },
      'all',
      { key: `checklist-task:${rows[0].id}` },
      { groupId, eventId },
    );
  } else {
    // Self-assigning ("Ich") skips its own notification - you already know,
    // you just did it. Still notified if you assigned yourself alongside
    // others in the same batch.
    for (const row of rows) {
      if (row.assignee_id === playerId) continue;
      notifyPlayers(
        [row.assignee_id!],
        { title: 'Dir wurde eine Mitbring-Anfrage zugewiesen', body: `${player.name}: ${trimmedTitle}`, url: '/#checklist' },
        'direct',
        { key: `checklist-task:${row.id}` },
        { groupId, eventId },
      );
    }
  }

  broadcast(Events.checklistChanged, { scope: 'tasks' }, { groupId, eventId });
  res.status(201).json({ tasks: rows.map(serializeTask) });
});

// POST /api/checklist/tasks/todo - body: { playerId, title, description?,
// assigneePlayerIds?, dueAt? }. Any active group member (not just Owner/
// Admin - docs/KONZEPT-PACKLISTE-TICKETS.md Abschnitt 4/9). Without
// assigneePlayerIds, creates one open task in the shared pool (anyone can
// claim it). With one or more ids, creates one independently-tracked row per
// person right away instead (skips the pool entirely) and pushes each of
// them a direct notification.
checklistRouter.post('/tasks/todo', ...withBodyPlayerIdentity, requireGroupRole('member'), (req, res) => {
  const { playerId, title, description, assigneePlayerIds, dueAt } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(title, MAX_TASK_TITLE)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TASK_TITLE} Zeichen).` });
  }
  if (description !== undefined && description !== null && !isNonEmptyString(description, MAX_TASK_DESCRIPTION)) {
    return res.status(400).json({ error: `Beschreibung darf höchstens ${MAX_TASK_DESCRIPTION} Zeichen lang sein.` });
  }
  const parsedDueAt = parseOptionalDueAt(dueAt);
  if (!parsedDueAt.ok) return res.status(400).json({ error: parsedDueAt.error });
  let assigneeIds: string[] = [];
  if (assigneePlayerIds !== undefined && assigneePlayerIds !== null) {
    if (
      !Array.isArray(assigneePlayerIds) ||
      assigneePlayerIds.length > MAX_BATCH_ASSIGNEES ||
      !assigneePlayerIds.every((id) => typeof id === 'string' && id)
    ) {
      return res.status(400).json({ error: 'assigneePlayerIds muss eine Liste von Spieler-IDs sein.' });
    }
    assigneeIds = [...new Set(assigneePlayerIds)];
  }
  const organizer = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!organizer) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const groupId = req.group!.id;
  if (assigneeIds.length > 0 && activeGroupPlayers(groupId, assigneeIds).size !== assigneeIds.length) {
    return res.status(404).json({ error: 'Mindestens eine zugewiesene Person wurde nicht gefunden.' });
  }

  const scope = resolveGroupEventScope(groupId, undefined);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const eventId = scope.eventId;
  const now = Date.now();
  const trimmedTitle = title.trim();
  const trimmedDescription = description ? description.trim() : null;
  const batchId = assigneeIds.length > 1 ? nanoid() : null;

  const insert = db.prepare(
    `INSERT INTO checklist_tasks (id, group_id, event_id, type, title, description, created_by, assignee_id, batch_id, status, created_at, taken_at, due_at)
     VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const rows: TaskRow[] =
    assigneeIds.length === 0
      ? [
          {
            id: nanoid(),
            group_id: groupId,
            event_id: eventId,
            type: 'todo',
            title: trimmedTitle,
            description: trimmedDescription,
            created_by: playerId,
            assignee_id: null,
            batch_id: null,
            status: 'open',
            created_at: now,
            taken_at: null,
            done_at: null,
            cancelled_at: null,
            claim_comment: null,
            due_at: parsedDueAt.value,
          },
        ]
      : assigneeIds.map((assigneeId) => ({
          id: nanoid(),
          group_id: groupId,
          event_id: eventId,
          type: 'todo' as const,
          title: trimmedTitle,
          description: trimmedDescription,
          created_by: playerId,
          assignee_id: assigneeId,
          batch_id: batchId,
          status: 'taken' as const,
          created_at: now,
          taken_at: now,
          done_at: null,
          cancelled_at: null,
          claim_comment: null,
          due_at: parsedDueAt.value,
        }));

  db.transaction(() => {
    for (const row of rows) {
      insert.run(row.id, row.group_id, row.event_id, row.title, row.description, row.created_by, row.assignee_id, row.batch_id, row.status, row.created_at, row.taken_at, row.due_at);
    }
  })();

  if (assigneeIds.length === 0) {
    const recipients = communicationRecipientIds(groupId, eventId).filter((id) => id !== playerId);
    notifyPlayers(
      recipients,
      { title: 'Neue Aufgabe', body: `${organizer.name}: ${trimmedTitle}`, url: '/#checklist' },
      'all',
      { key: `checklist-task:${rows[0].id}` },
      { groupId, eventId },
    );
  } else {
    // Self-assigning ("Ich") skips its own notification - you already know,
    // you just did it. Still notified if you assigned yourself alongside
    // others in the same batch.
    for (const row of rows) {
      if (row.assignee_id === playerId) continue;
      notifyPlayers(
        [row.assignee_id!],
        { title: 'Dir wurde eine Aufgabe zugewiesen', body: `${organizer.name}: ${trimmedTitle}`, url: '/#checklist' },
        'direct',
        { key: `checklist-task:${row.id}` },
        { groupId, eventId },
      );
    }
  }

  broadcast(Events.checklistChanged, { scope: 'tasks' }, { groupId, eventId });
  res.status(201).json({ tasks: rows.map(serializeTask) });
});

// POST /api/checklist/tasks/:id/claim - body: { playerId, comment? }. First
// request wins: exactly one concurrent claim succeeds, everyone else gets a
// 409. The optional comment (e.g. "Bringe einen XBOX Controller mit.") is
// stored on the task and included in the creator's notification.
checklistRouter.post('/tasks/:id/claim', resolveChecklistTask, ...withBodyPlayerIdentity, (req, res) => {
  const task = req.groupResource as TaskRow;
  const scope = currentEventScope(req, res);
  if (!scope) return;
  if (task.event_id !== scope.eventId) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  const { playerId, comment } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (comment !== undefined && comment !== null && !isNonEmptyString(comment, MAX_CLAIM_COMMENT)) {
    return res.status(400).json({ error: `Kommentar darf höchstens ${MAX_CLAIM_COMMENT} Zeichen lang sein.` });
  }
  if (task.created_by === playerId) {
    return res.status(409).json({ error: 'Die eigene Aufgabe kann nicht selbst übernommen werden.' });
  }
  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const trimmedComment = comment ? comment.trim() : null;
  const now = Date.now();
  const update = db
    .prepare(
      `UPDATE checklist_tasks SET status = 'taken', assignee_id = ?, taken_at = ?, claim_comment = ? WHERE id = ? AND status = 'open'`,
    )
    .run(playerId, now, trimmedComment, task.id);
  if (update.changes !== 1) {
    return res.status(409).json({ error: 'Diese Aufgabe wurde bereits übernommen.' });
  }

  resolvePushTopic(`checklist-task:${task.id}`, false, { groupId: task.group_id, eventId: task.event_id });
  notifyPlayers(
    [task.created_by],
    {
      title: 'Übernommen',
      body: trimmedComment
        ? `${player.name} übernimmt: ${task.title} – ${trimmedComment}`
        : `${player.name} übernimmt: ${task.title}`,
      url: '/#checklist',
    },
    'direct',
    undefined,
    { groupId: task.group_id, eventId: task.event_id },
  );
  broadcast(Events.checklistChanged, { scope: 'tasks' }, { groupId: task.group_id, eventId: task.event_id });
  res.json(serializeTask({ ...task, status: 'taken', assignee_id: playerId, taken_at: now, claim_comment: trimmedComment }));
});

// POST /api/checklist/tasks/:id/release - body: { playerId }. Only the
// current assignee can back out, returning the task to the open pool.
checklistRouter.post('/tasks/:id/release', resolveChecklistTask, ...withBodyPlayerIdentity, (req, res) => {
  const task = req.groupResource as TaskRow;
  const scope = currentEventScope(req, res);
  if (!scope) return;
  if (task.event_id !== scope.eventId) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (task.assignee_id !== playerId) {
    return res.status(403).json({ error: 'Nur die zugewiesene Person kann die Aufgabe wieder freigeben.' });
  }
  if (task.status !== 'taken') {
    return res.status(409).json({ error: 'Diese Aufgabe ist nicht übernommen.' });
  }

  db.prepare(
    `UPDATE checklist_tasks SET status = 'open', assignee_id = NULL, taken_at = NULL, claim_comment = NULL WHERE id = ? AND status = 'taken'`,
  ).run(task.id);
  // The create-with-assigneePlayerIds path records an active "you were
  // assigned" push topic for the assignee - releasing must close it too, or
  // their notification center keeps claiming they're still assigned to a
  // task that's back in the open pool.
  resolvePushTopic(`checklist-task:${task.id}`, false, { groupId: task.group_id, eventId: task.event_id });
  broadcast(Events.checklistChanged, { scope: 'tasks' }, { groupId: task.group_id, eventId: task.event_id });
  res.json(serializeTask({ ...task, status: 'open', assignee_id: null, taken_at: null, claim_comment: null }));
});

// PATCH /api/checklist/tasks/:id/done - body: { playerId }. The assignee,
// the creator, or a group moderator (owner/admin) can mark a taken task done.
checklistRouter.patch('/tasks/:id/done', resolveChecklistTask, ...withBodyPlayerIdentity, (req, res) => {
  const task = req.groupResource as TaskRow;
  const scope = currentEventScope(req, res);
  if (!scope) return;
  if (task.event_id !== scope.eventId) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (playerId !== task.assignee_id && playerId !== task.created_by && !isChecklistModerator(req)) {
    return res.status(403).json({ error: 'Nur die zugewiesene Person, der Ersteller oder ein Admin kann dies als erledigt markieren.' });
  }
  if (task.status !== 'taken') {
    return res.status(409).json({ error: 'Diese Aufgabe ist nicht übernommen.' });
  }

  const doneAt = Date.now();
  db.prepare(`UPDATE checklist_tasks SET status = 'done', done_at = ? WHERE id = ? AND status = 'taken'`).run(doneAt, task.id);
  resolvePushTopic(`checklist-task:${task.id}`, false, { groupId: task.group_id, eventId: task.event_id });
  broadcast(Events.checklistChanged, { scope: 'tasks' }, { groupId: task.group_id, eventId: task.event_id });
  res.json(serializeTask({ ...task, status: 'done', done_at: doneAt }));
});

// DELETE /api/checklist/tasks/:id - body: { playerId }. Creator or group
// moderator only, and only before it's done - withdraws a task/request
// that's no longer needed instead of leaving it in the pool or on someone's
// plate.
checklistRouter.delete('/tasks/:id', resolveChecklistTask, ...withBodyPlayerIdentity, (req, res) => {
  const task = req.groupResource as TaskRow;
  const scope = currentEventScope(req, res);
  if (!scope) return;
  if (task.event_id !== scope.eventId) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (playerId !== task.created_by && !isChecklistModerator(req)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann dies zurückziehen.' });
  }
  if (task.status === 'done' || task.status === 'cancelled') {
    return res.status(409).json({ error: 'Diese Aufgabe ist bereits abgeschlossen.' });
  }

  const cancelledAt = Date.now();
  const update = db
    .prepare(`UPDATE checklist_tasks SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status != 'done' AND status != 'cancelled'`)
    .run(cancelledAt, task.id);
  if (update.changes !== 1) {
    return res.status(409).json({ error: 'Diese Aufgabe ist bereits abgeschlossen.' });
  }

  resolvePushTopic(`checklist-task:${task.id}`, false, { groupId: task.group_id, eventId: task.event_id });
  broadcast(Events.checklistChanged, { scope: 'tasks' }, { groupId: task.group_id, eventId: task.event_id });
  res.status(204).end();
});
