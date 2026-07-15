// Durchsagen ("Essen ist da!"): one message out to every device at once —
// in-app toast via socket, kiosk banner, and a real push notification for
// phones that opted in. LAN trust model: any player may send one; the
// sender's name is always attached so it reads as a person speaking, not
// the system.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString } from '../validation';
import { notifyPlayers, resolvePushTopic } from '../push';
import { withBodyPlayerIdentity } from '../sessions';

export const broadcastsRouter = Router();

const MAX_MESSAGE_LENGTH = 200;
const HISTORY_LIMIT = 20;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

interface BroadcastRow {
  id: string;
  player_id: string;
  message: string;
  ends_at: number;
  ended_at: number | null;
  created_at: number;
}

const broadcastTopicKey = (id: string) => `broadcast:${id}`;

function buildList() {
  const rows = db
    .prepare(
      `SELECT b.id, b.player_id AS playerId, p.name AS playerName, p.color AS playerColor,
              b.message, b.ends_at AS endsAt, b.ended_at AS endedAt, b.created_at AS createdAt
       FROM broadcasts b JOIN players p ON p.id = b.player_id
       ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(HISTORY_LIMIT) as Array<Record<string, unknown> & { endsAt: number; endedAt: number | null }>;
  const now = Date.now();
  return { broadcasts: rows.map((row) => ({ ...row, active: row.endedAt === null && row.endsAt > now })) };
}

// GET /api/broadcasts - recent history, newest first.
broadcastsRouter.get('/', (_req, res) => {
  res.json(buildList());
});

// POST /api/broadcasts - body: { playerId, message, endsAt? }
broadcastsRouter.post('/', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, message, endsAt } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(message, MAX_MESSAGE_LENGTH)) {
    return res.status(400).json({ error: `Nachricht ist erforderlich (1-${MAX_MESSAGE_LENGTH} Zeichen).` });
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

  const row: BroadcastRow = {
    id: nanoid(),
    player_id: playerId,
    message: message.trim(),
    ends_at: effectiveEndsAt,
    ended_at: null,
    created_at: createdAt,
  };
  db.prepare('INSERT INTO broadcasts (id, player_id, message, ends_at, ended_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)').run(
    row.id,
    row.player_id,
    row.message,
    row.ends_at,
    row.created_at
  );

  const payload = {
    id: row.id,
    playerId: player.id,
    playerName: player.name,
    message: row.message,
    endsAt: row.ends_at,
    endedAt: null,
    active: true,
    createdAt: row.created_at,
  };
  broadcast(Events.broadcastNew, payload);

  const allPlayerIds = (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((p) => p.id);
  notifyPlayers(allPlayerIds, {
    title: `📢 ${player.name}`,
    body: row.message,
    url: '/#broadcast',
  }, 'all', { key: broadcastTopicKey(row.id), expiresAt: row.ends_at });

  res.status(201).json(payload);
});

// POST /api/broadcasts/:id/end - only the creator may end an active
// announcement before its configured deadline.
broadcastsRouter.post('/:id/end', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }

  const row = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id) as BroadcastRow | undefined;
  if (!row) return res.status(404).json({ error: 'Durchsage nicht gefunden.' });
  if (row.player_id !== playerId) return res.status(403).json({ error: 'Nur der Ersteller kann diese Durchsage beenden.' });

  const endedAt = Date.now();
  const result = db
    .prepare('UPDATE broadcasts SET ended_at = ? WHERE id = ? AND ended_at IS NULL AND ends_at > ?')
    .run(endedAt, row.id, endedAt);
  if (result.changes === 0) return res.status(409).json({ error: 'Durchsage ist bereits beendet oder abgelaufen.' });

  resolvePushTopic(broadcastTopicKey(row.id));
  const payload = { id: row.id, endedAt };
  broadcast(Events.broadcastsChanged, payload);
  res.json(payload);
});
