// Sammelbestellungen ("Pizza bei Luigi's — wer will was?"): one order is
// opened, everyone adds their own items while it's open, closing freezes the
// list for reading out to the phone/delivery app. The check-then-write race
// to watch: someone closes the order while others are still typing — adding
// to a closed order must fail with a clean 409, never silently append, and
// two simultaneous closes must resolve to exactly one winner (see
// api.concurrency.test.ts).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getTrackingEventId } from '../events';
import { isNonEmptyString } from '../validation';
import { notifyPlayers } from '../push';

export const foodOrdersRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_ITEM_LENGTH = 120;
const MAX_PRICE_CENTS = 500_00; // nobody orders a 500€ pizza
const HISTORY_LIMIT = 10;

interface OrderRow {
  id: string;
  event_id: string;
  title: string;
  created_by: string;
  created_at: number;
  closed_at: number | null;
}

interface ItemRow {
  id: string;
  order_id: string;
  player_id: string;
  description: string;
  price_cents: number | null;
  created_at: number;
}

function serializeOrder(row: OrderRow) {
  const items = db
    .prepare(
      `SELECT i.id, i.player_id AS playerId, p.name AS playerName, p.color AS playerColor, p.avatar AS playerAvatar,
              i.description, i.price_cents AS priceCents, i.created_at AS createdAt
       FROM food_order_items i JOIN players p ON p.id = i.player_id
       WHERE i.order_id = ? ORDER BY i.created_at`
    )
    .all(row.id) as Array<{ playerId: string; priceCents: number | null }>;

  const creator = db.prepare('SELECT name FROM players WHERE id = ?').get(row.created_by) as
    | { name: string }
    | undefined;

  const totalCents = items.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);

  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdByName: creator?.name ?? '?',
    createdAt: row.created_at,
    closedAt: row.closed_at,
    open: row.closed_at === null,
    items,
    totalCents,
  };
}

function buildList() {
  const rows = db
    .prepare('SELECT * FROM food_orders WHERE event_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(getTrackingEventId(), HISTORY_LIMIT) as OrderRow[];
  return { orders: rows.map(serializeOrder) };
}

function getOrder(id: string): OrderRow | undefined {
  return db.prepare('SELECT * FROM food_orders WHERE id = ?').get(id) as OrderRow | undefined;
}

// GET /api/food-orders - current event's orders, newest first (open ones on
// top by recency; the frontend splits open vs closed).
foodOrdersRouter.get('/', (_req, res) => {
  res.json(buildList());
});

// POST /api/food-orders - body: { playerId, title }. Multiple open orders
// are allowed (drinks run + pizza run can overlap) — no single-open guard.
foodOrdersRouter.post('/', (req, res) => {
  const { playerId, title } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen), z.B. "Pizza bei Luigi's".` });
  }
  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string }
    | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const row: OrderRow = {
    id: nanoid(),
    event_id: getTrackingEventId(),
    title: title.trim(),
    created_by: playerId,
    created_at: Date.now(),
    closed_at: null,
  };
  db.prepare(
    'INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at) VALUES (?, ?, ?, ?, ?, NULL)'
  ).run(row.id, row.event_id, row.title, row.created_by, row.created_at);

  // Same notify pattern as pings: the socket payload carries a toast for
  // everyone except the creator (they just tapped the button themselves).
  broadcast(Events.foodOrdersChanged, {
    notify: {
      message: `🍕 Neue Sammelbestellung: ${row.title} – jetzt eintragen!`,
      excludePlayerId: playerId,
    },
  });
  const allPlayerIds = (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((p) => p.id);
  notifyPlayers(allPlayerIds, {
    title: '🍕 Neue Sammelbestellung',
    body: `${row.title} (von ${player.name}) – jetzt eintragen!`,
    url: '/',
  });

  res.status(201).json(serializeOrder(row));
});

// POST /api/food-orders/:id/items - body: { playerId, description, priceCents? }
foodOrdersRouter.post('/:id/items', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  // The race guard: the order may have been closed between this device
  // rendering the form and the submit arriving.
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist schon geschlossen.' });
  }

  const { playerId, description, priceCents } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(description, MAX_ITEM_LENGTH)) {
    return res.status(400).json({ error: `Was möchtest du? (1-${MAX_ITEM_LENGTH} Zeichen)` });
  }
  if (
    priceCents !== undefined &&
    priceCents !== null &&
    (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > MAX_PRICE_CENTS)
  ) {
    return res.status(400).json({ error: 'Preis muss ein Betrag in Cent (0 bis 50000) sein.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  db.prepare(
    'INSERT INTO food_order_items (id, order_id, player_id, description, price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), order.id, playerId, description.trim(), priceCents ?? null, Date.now());

  broadcast(Events.foodOrdersChanged, null);
  res.status(201).json(serializeOrder(order));
});

// DELETE /api/food-orders/:id/items/:itemId - body: { playerId }. Players
// may only remove their own items (mis-taps happen), and only while open.
foodOrdersRouter.delete('/:id/items/:itemId', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist schon geschlossen.' });
  }

  const { playerId } = req.body ?? {};
  const item = db
    .prepare('SELECT id, player_id FROM food_order_items WHERE id = ? AND order_id = ?')
    .get(req.params.itemId, order.id) as { id: string; player_id: string } | undefined;
  if (!item) return res.status(404).json({ error: 'Position nicht gefunden.' });
  if (item.player_id !== playerId) {
    return res.status(403).json({ error: 'Nur eigene Positionen können entfernt werden.' });
  }

  db.prepare('DELETE FROM food_order_items WHERE id = ?').run(item.id);
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder(order));
});

// POST /api/food-orders/:id/close - freezes the list. Exactly one closer
// wins; the second tap gets a 409 instead of double-notifying everyone.
foodOrdersRouter.post('/:id/close', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist schon geschlossen.' });
  }

  const closedAt = Date.now();
  db.prepare('UPDATE food_orders SET closed_at = ? WHERE id = ?').run(closedAt, order.id);
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder({ ...order, closed_at: closedAt }));
});
