// In-app feedback (docs/KONZEPT-FEATURE-NUTZUNGSANALYSE.md, Baustein B): a
// short message anyone can send from wherever they currently are, captured
// with the view it came from so admins see what prompted it. Freeform text
// is deliberate here (unlike usage telemetry, which never stores free text)
// since the sender wrote it on purpose.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { isNonEmptyString } from '../validation';
import { requireUser } from '../sessions';
import { requireAdmin } from '../auth';
import { getOrRepairActiveEvent } from '../eventContext';

export const feedbackRouter = Router();

const MAX_MESSAGE_LENGTH = 500;
const MAX_VIEW_LENGTH = 60;
const SENTIMENTS = new Set(['positive', 'negative', 'idea']);
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const LIST_LIMIT = 200;

// POST /api/feedback - body: { message, view, device, sentiment? }
feedbackRouter.post('/', requireUser, (req, res) => {
  const { message, view, device, sentiment } = req.body ?? {};
  if (!isNonEmptyString(message, MAX_MESSAGE_LENGTH)) {
    return res.status(400).json({ error: `message ist erforderlich (max. ${MAX_MESSAGE_LENGTH} Zeichen).` });
  }
  if (!isNonEmptyString(view, MAX_VIEW_LENGTH)) {
    return res.status(400).json({ error: 'view ist erforderlich.' });
  }
  if (typeof device !== 'string' || !DEVICES.has(device)) {
    return res.status(400).json({ error: `device muss eine von ${[...DEVICES].join(', ')} sein.` });
  }
  if (sentiment !== undefined && sentiment !== null && !SENTIMENTS.has(sentiment)) {
    return res.status(400).json({ error: `sentiment muss eine von ${[...SENTIMENTS].join(', ')} sein.` });
  }

  const id = nanoid();
  const now = Date.now();
  const activeEvent = getOrRepairActiveEvent(req.player!.id);
  db.prepare(
    `INSERT INTO feedback_entries (id, group_id, event_id, player_id, view, sentiment, message, device, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.group!.id, activeEvent.id, req.player!.id, view.trim(), sentiment ?? null, message.trim(), device, now);

  res.status(201).json({ id, createdAt: now });
});

// GET /api/feedback?limit= - admin-only history, newest first.
feedbackRouter.get('/', requireAdmin, (req, res) => {
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(limitRaw) ? Math.min(LIST_LIMIT, Math.max(1, limitRaw)) : 50;
  const rows = db
    .prepare(
      `SELECT f.id, f.event_id AS eventId, e.name AS eventName, f.player_id AS playerId, p.name AS playerName,
              f.view, f.sentiment, f.message, f.device, f.created_at AS createdAt
       FROM feedback_entries f
       LEFT JOIN players p ON p.id = f.player_id
       LEFT JOIN events e ON e.id = f.event_id
       WHERE f.group_id = ?
       ORDER BY f.created_at DESC
       LIMIT ?`,
    )
    .all(req.group!.id, limit);
  res.json(rows);
});
