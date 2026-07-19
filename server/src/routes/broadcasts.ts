// Phase 5c communication data: announcements are persisted with an immutable
// group/event recipient snapshot. Delivery is deliberately deferred.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { isNonEmptyString } from '../validation';
import { recordPushLog, resolvePushTopic } from '../push';
import { withBodyPlayerIdentity } from '../sessions';
import { resolveGroupEventScope } from '../groupEventScope';
import { communicationRecipientIds } from '../communicationRecipients';
import { activeGroupPlayers } from '../groupPlayers';

export const broadcastsRouter = Router();

const MAX_MESSAGE_LENGTH = 200;
const HISTORY_LIMIT = 20;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

interface BroadcastRow {
  id: string;
  group_id: string;
  event_id: string | null;
  player_id: string;
  player_name_snapshot: string;
  message: string;
  ends_at: number;
  ended_at: number | null;
  recipient_ids: string;
  created_at: number;
}

const broadcastTopicKey = (id: string) => `broadcast:${id}`;

function buildList(groupId: string, eventId: string | null) {
  const rows = db
    .prepare(
      `SELECT b.id, b.group_id AS groupId, b.event_id AS eventId, b.player_id AS playerId,
              b.player_name_snapshot AS playerName, p.color AS playerColor, b.message,
              b.ends_at AS endsAt, b.ended_at AS endedAt, b.recipient_ids AS recipientIds,
              b.created_at AS createdAt
       FROM broadcasts b LEFT JOIN players p ON p.id = b.player_id
       WHERE b.group_id = ? AND b.event_id IS ?
       ORDER BY b.created_at DESC LIMIT ?`,
    )
    .all(groupId, eventId, HISTORY_LIMIT) as Array<
      Record<string, unknown> & { endsAt: number; endedAt: number | null; recipientIds: string }
    >;
  const now = Date.now();
  const broadcasts = rows.map(({ recipientIds, ...row }) => {
    const ids = JSON.parse(recipientIds) as string[];
    return { ...row, recipientIds: ids, recipientCount: ids.length, active: row.endedAt === null && row.endsAt > now };
  });
  return {
    broadcasts,
    summary: {
      total: broadcasts.length,
      active: broadcasts.filter((entry) => entry.active).length,
      recipientCount: new Set(broadcasts.flatMap((entry) => entry.recipientIds)).size,
    },
  };
}

broadcastsRouter.get('/', (req, res) => {
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  res.json(buildList(req.group!.id, scope.eventId));
});

broadcastsRouter.post('/', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, message, endsAt, eventId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(message, MAX_MESSAGE_LENGTH)) {
    return res.status(400).json({ error: `Nachricht ist erforderlich (1-${MAX_MESSAGE_LENGTH} Zeichen).` });
  }
  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!activeGroupPlayers(req.group!.id, [playerId]).has(playerId)) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }

  const createdAt = Date.now();
  const effectiveEndsAt = endsAt === undefined ? createdAt + DEFAULT_DURATION_MS : endsAt;
  if (!Number.isSafeInteger(effectiveEndsAt) || effectiveEndsAt <= createdAt) {
    return res.status(400).json({ error: 'Endzeitpunkt muss in der Zukunft liegen.' });
  }
  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const recipientIds = communicationRecipientIds(req.group!.id, scope.eventId);
  const row: BroadcastRow = {
    id: nanoid(),
    group_id: req.group!.id,
    event_id: scope.eventId,
    player_id: playerId,
    player_name_snapshot: player.name,
    message: message.trim(),
    ends_at: effectiveEndsAt,
    ended_at: null,
    recipient_ids: JSON.stringify(recipientIds),
    created_at: createdAt,
  };
  db.prepare(
    `INSERT INTO broadcasts
       (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, ended_at, recipient_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    row.id,
    row.group_id,
    row.event_id,
    row.player_id,
    row.player_name_snapshot,
    row.message,
    row.ends_at,
    row.recipient_ids,
    row.created_at,
  );

  const pushEntry = recordPushLog(
    recipientIds,
    { title: player.name, body: row.message, url: '/#broadcast' },
    'all',
    { key: broadcastTopicKey(row.id), expiresAt: row.ends_at },
    { groupId: row.group_id, eventId: row.event_id },
  );
  res.status(201).json({
    id: row.id,
    groupId: row.group_id,
    eventId: row.event_id,
    playerId: row.player_id,
    playerName: row.player_name_snapshot,
    message: row.message,
    endsAt: row.ends_at,
    endedAt: null,
    active: true,
    recipientIds,
    recipientCount: recipientIds.length,
    pushLogId: pushEntry.id,
    createdAt: row.created_at,
  });
});

broadcastsRouter.post('/:id/end', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const row = db
    .prepare('SELECT * FROM broadcasts WHERE id = ? AND group_id = ?')
    .get(req.params.id, req.group!.id) as BroadcastRow | undefined;
  if (!row) return res.status(404).json({ error: 'Durchsage nicht gefunden.' });
  const mayModerate = req.groupMembership?.role === 'owner' || req.groupMembership?.role === 'admin';
  if (row.player_id !== playerId && !mayModerate) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Gruppen-Admin kann diese Durchsage beenden.' });
  }

  const endedAt = Date.now();
  const result = db
    .prepare('UPDATE broadcasts SET ended_at = ? WHERE id = ? AND group_id = ? AND ended_at IS NULL AND ends_at > ?')
    .run(endedAt, row.id, row.group_id, endedAt);
  if (result.changes === 0) return res.status(409).json({ error: 'Durchsage ist bereits beendet oder abgelaufen.' });

  resolvePushTopic(broadcastTopicKey(row.id), false, { groupId: row.group_id, eventId: row.event_id }, false);
  res.json({ id: row.id, endedAt });
});
