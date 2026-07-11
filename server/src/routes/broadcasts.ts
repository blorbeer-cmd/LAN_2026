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
import { notifyPlayers } from '../push';

export const broadcastsRouter = Router();

const MAX_MESSAGE_LENGTH = 200;
const HISTORY_LIMIT = 20;

interface BroadcastRow {
  id: string;
  player_id: string;
  message: string;
  created_at: number;
}

function buildList() {
  const rows = db
    .prepare(
      `SELECT b.id, b.player_id AS playerId, p.name AS playerName, p.color AS playerColor,
              b.message, b.created_at AS createdAt
       FROM broadcasts b JOIN players p ON p.id = b.player_id
       ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(HISTORY_LIMIT);
  return { broadcasts: rows };
}

// GET /api/broadcasts - recent history, newest first.
broadcastsRouter.get('/', (_req, res) => {
  res.json(buildList());
});

// POST /api/broadcasts - body: { playerId, message }
broadcastsRouter.post('/', (req, res) => {
  const { playerId, message } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(message, MAX_MESSAGE_LENGTH)) {
    return res.status(400).json({ error: `Nachricht ist erforderlich (1-${MAX_MESSAGE_LENGTH} Zeichen).` });
  }
  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const row: BroadcastRow = {
    id: nanoid(),
    player_id: playerId,
    message: message.trim(),
    created_at: Date.now(),
  };
  db.prepare('INSERT INTO broadcasts (id, player_id, message, created_at) VALUES (?, ?, ?, ?)').run(
    row.id,
    row.player_id,
    row.message,
    row.created_at
  );

  const payload = {
    id: row.id,
    playerId: player.id,
    playerName: player.name,
    message: row.message,
    createdAt: row.created_at,
  };
  broadcast(Events.broadcastNew, payload);

  const allPlayerIds = (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((p) => p.id);
  notifyPlayers(allPlayerIds, {
    title: `📢 ${player.name}`,
    body: row.message,
    url: '/#broadcast',
  });

  res.status(201).json(payload);
});
