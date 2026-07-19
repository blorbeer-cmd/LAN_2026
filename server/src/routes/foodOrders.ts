// Sammelbestellungen ("Pizza bei Luigi's — wer will was?"): one order is
// opened, everyone adds their own items while it's open, closing ("wird
// abgeschickt" in the UI — closed_at) freezes the list for reading out to
// the phone/delivery app. That's reversible via reopen (add a forgotten
// item, fix a price) until the creator/an admin finalizes it ("wird
// geschlossen" in the UI — finalized_at) — a one-way lock, no more
// reopening, items, paid or metadata changes. The check-then-write race to
// watch: someone closes the order while others are still typing — adding to
// a closed order must fail with a clean 409, never silently append, and two
// simultaneous closes must resolve to exactly one winner (see
// api.concurrency.test.ts).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, OUTSIDE_EVENTS_ID } from '../db';
import { broadcast, Events } from '../realtime';
import { getTrackingEventId } from '../events';
import { isIntInRange, isNonEmptyString, isValidUrl } from '../validation';
import { notifyPlayers, resolvePushTopic, updatePushTopicExpiry } from '../push';
import { requireConfiguredUser, withBodyPlayerIdentity } from '../sessions';
import { communicationRecipientIds } from '../communicationRecipients';

export const foodOrdersRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_ITEM_LENGTH = 120;
const MAX_PRICE_CENTS = 500_00; // nobody orders a 500€ pizza
const MAX_ITEM_QUANTITY = 99;
const MAX_NOTES_LENGTH = 500;
const MAX_LINK_LENGTH = 300;
const HISTORY_LIMIT = 10;
const communicationEventId = (eventId: string): string | null => (eventId === OUTSIDE_EVENTS_ID ? null : eventId);

interface OrderRow {
  id: string;
  event_id: string;
  title: string;
  created_by: string;
  created_at: number;
  closed_at: number | null;
  finalized_at: number | null;
  send_at: number | null;
  notes: string | null;
  link: string | null;
  paypal_link: string | null;
  tip_percent: number | null;
}

// Epoch-ms bounds a "wann geht's raus" timestamp must fall within — loose on
// purpose (just catches fat-fingered garbage, e.g. a year-1970 value from a
// blank/parsed-wrong datetime-local field), not a "must be in the future"
// rule: correcting a passed deadline after the fact is a legitimate edit.
const MIN_SEND_AT = Date.UTC(2000, 0, 1);
const MAX_SEND_AT = Date.UTC(2100, 0, 1);

function isValidSendAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_SEND_AT && value <= MAX_SEND_AT;
}

// notes/link are both optional metadata: valid values are either absent
// (undefined - "don't touch it" on PATCH), null (explicit clear), or a
// string within bounds. Never required, unlike title/description.
function isValidNotes(value: unknown): boolean {
  return value === null || isNonEmptyString(value, MAX_NOTES_LENGTH);
}

function isValidLink(value: unknown): boolean {
  return value === null || isValidUrl(value, MAX_LINK_LENGTH);
}

// Whole percent, 0-100 — a decimal-point tip is more precision than anyone
// needs at a LAN party.
function isValidTipPercent(value: unknown): boolean {
  return value === null || isIntInRange(value, 0, 100);
}

interface ItemRow {
  id: string;
  order_id: string;
  player_id: string;
  description: string;
  quantity: number;
  price_cents: number | null;
  paid: number;
  created_at: number;
}

function serializeOrder(row: OrderRow) {
  const items = (
    db
      .prepare(
        `SELECT i.id, i.player_id AS playerId, p.name AS playerName, p.color AS playerColor, p.avatar AS playerAvatar,
                i.description, i.quantity, i.price_cents AS priceCents, i.paid, i.created_at AS createdAt
         FROM food_order_items i JOIN players p ON p.id = i.player_id
         WHERE i.order_id = ? ORDER BY i.created_at`
      )
      .all(row.id) as Array<{ playerId: string; quantity: number; priceCents: number | null; paid: number }>
  ).map((i) => ({ ...i, paid: Boolean(i.paid) }));

  const creator = db.prepare('SELECT name FROM players WHERE id = ?').get(row.created_by) as
    | { name: string }
    | undefined;

  const totalCents = items.reduce((sum, i) => sum + (i.priceCents ?? 0) * i.quantity, 0);

  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdByName: creator?.name ?? '?',
    createdAt: row.created_at,
    closedAt: row.closed_at,
    finalizedAt: row.finalized_at,
    sendAt: row.send_at,
    notes: row.notes,
    link: row.link,
    paypalLink: row.paypal_link,
    tipPercent: row.tip_percent,
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

// POST /api/food-orders - body: { playerId, title, sendAt?, notes?, link?, paypalLink?, tipPercent? }.
// Multiple open orders are allowed (drinks run + pizza run can overlap) — no
// single-open guard. sendAt is optional: when this order will actually be
// placed/picked up, so everyone knows the cutoff for adding items instead of
// guessing. notes/link are optional too: free-text info (e.g. Mindestbestell-
// wert, "bar zahlen") and a link to the menu/delivery service. paypalLink is
// where co-orderers pay their share back to (rendered as a "Bezahlen"
// button); tipPercent is added on top of that amount.
foodOrdersRouter.post('/', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, title, sendAt, notes, link, paypalLink, tipPercent } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen), z.B. "Pizza bei Luigi's".` });
  }
  if (sendAt !== undefined && sendAt !== null && !isValidSendAt(sendAt)) {
    return res.status(400).json({ error: 'sendAt muss ein gültiger Zeitpunkt sein.' });
  }
  if (notes !== undefined && notes !== null && !isValidNotes(notes)) {
    return res.status(400).json({ error: `Infos dürfen höchstens ${MAX_NOTES_LENGTH} Zeichen lang sein.` });
  }
  if (link !== undefined && link !== null && !isValidLink(link)) {
    return res.status(400).json({ error: 'Link muss eine gültige http(s)-URL sein.' });
  }
  if (paypalLink !== undefined && paypalLink !== null && !isValidLink(paypalLink)) {
    return res.status(400).json({ error: 'PayPal-Link muss eine gültige http(s)-URL sein.' });
  }
  if (tipPercent !== undefined && tipPercent !== null && !isValidTipPercent(tipPercent)) {
    return res.status(400).json({ error: 'Trinkgeld muss zwischen 0 und 100 Prozent liegen.' });
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
    finalized_at: null,
    send_at: sendAt ?? null,
    notes: notes ? notes.trim() : null,
    link: link ? link.trim() : null,
    paypal_link: paypalLink ? paypalLink.trim() : null,
    tip_percent: tipPercent ?? null,
  };
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at, finalized_at, send_at, notes, link, paypal_link, tip_percent)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.event_id,
    row.title,
    row.created_by,
    row.created_at,
    row.send_at,
    row.notes,
    row.link,
    row.paypal_link,
    row.tip_percent
  );

  const sendAtNote = row.send_at ? ` (geht raus um ${new Date(row.send_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : '';

  // The socket payload carries a toast for everyone except the creator
  // (they just tapped the button themselves).
  broadcast(Events.foodOrdersChanged, {
    notify: {
      message: `Neue Sammelbestellung: ${row.title}${sendAtNote} – jetzt eintragen!`,
      excludePlayerId: playerId,
    },
  });
  const eventScope = communicationEventId(row.event_id);
  const allPlayerIds = communicationRecipientIds(req.group!.id, eventScope);
  notifyPlayers(
    allPlayerIds,
    {
      title: 'Neue Sammelbestellung',
      body: `${row.title}${sendAtNote} (von ${player.name}) – jetzt eintragen!`,
      url: '/#foodOrders',
    },
    'all',
    { key: `food-order:${row.id}`, expiresAt: row.send_at },
    { groupId: req.group!.id, eventId: eventScope },
  );

  res.status(201).json(serializeOrder(row));
});

// PATCH /api/food-orders/:id - body: { sendAt?, notes?, link?, paypalLink?, tipPercent? }.
// Only this metadata is editable this way (not title/items) — correcting a
// mis-typed or shifted deadline, a typo in the notes, or a wrong link is
// legitimate even after the order closed, so none of this is gated on
// open/closed like items are. Each field is independent: omit a field to
// leave it as-is, pass null to clear it. A finalized order is fully locked,
// though: no more edits of any kind.
foodOrdersRouter.patch('/:id', requireConfiguredUser, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann diese Bestellung bearbeiten.' });
  }
  if (order.finalized_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist geschlossen und kann nicht mehr geändert werden.' });
  }

  const { sendAt, notes, link, paypalLink, tipPercent } = req.body ?? {};
  if (sendAt !== undefined && sendAt !== null && !isValidSendAt(sendAt)) {
    return res.status(400).json({ error: 'sendAt muss ein gültiger Zeitpunkt sein (oder null zum Entfernen).' });
  }
  if (notes !== undefined && !isValidNotes(notes)) {
    return res.status(400).json({ error: `Infos dürfen höchstens ${MAX_NOTES_LENGTH} Zeichen lang sein (oder null zum Entfernen).` });
  }
  if (link !== undefined && !isValidLink(link)) {
    return res.status(400).json({ error: 'Link muss eine gültige http(s)-URL sein (oder null zum Entfernen).' });
  }
  if (paypalLink !== undefined && !isValidLink(paypalLink)) {
    return res.status(400).json({ error: 'PayPal-Link muss eine gültige http(s)-URL sein (oder null zum Entfernen).' });
  }
  if (tipPercent !== undefined && !isValidTipPercent(tipPercent)) {
    return res.status(400).json({ error: 'Trinkgeld muss zwischen 0 und 100 Prozent liegen (oder null zum Entfernen).' });
  }

  const next = {
    send_at: sendAt !== undefined ? sendAt : order.send_at,
    notes: notes !== undefined ? (notes ? notes.trim() : null) : order.notes,
    link: link !== undefined ? (link ? link.trim() : null) : order.link,
    paypal_link: paypalLink !== undefined ? (paypalLink ? paypalLink.trim() : null) : order.paypal_link,
    tip_percent: tipPercent !== undefined ? tipPercent : order.tip_percent,
  };
  db.prepare('UPDATE food_orders SET send_at = ?, notes = ?, link = ?, paypal_link = ?, tip_percent = ? WHERE id = ?').run(
    next.send_at,
    next.notes,
    next.link,
    next.paypal_link,
    next.tip_percent,
    order.id
  );
  if (sendAt !== undefined) {
    updatePushTopicExpiry(`food-order:${order.id}`, next.send_at, {
      groupId: req.group!.id,
      eventId: communicationEventId(order.event_id),
    });
  }
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder({ ...order, ...next }));
});

// POST /api/food-orders/:id/items - body: { playerId, description, quantity, priceCents? }
foodOrdersRouter.post('/:id/items', ...withBodyPlayerIdentity, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  // The race guard: the order may have been closed between this device
  // rendering the form and the submit arriving.
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung wurde bereits abgeschickt.' });
  }

  const { playerId, description, quantity = 1, priceCents } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!isNonEmptyString(description, MAX_ITEM_LENGTH)) {
    return res.status(400).json({ error: `Was möchtest du? (1-${MAX_ITEM_LENGTH} Zeichen)` });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
    return res.status(400).json({ error: `Anzahl muss zwischen 1 und ${MAX_ITEM_QUANTITY} liegen.` });
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
    'INSERT INTO food_order_items (id, order_id, player_id, description, quantity, price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), order.id, playerId, description.trim(), quantity, priceCents ?? null, Date.now());

  broadcast(Events.foodOrdersChanged, null);
  res.status(201).json(serializeOrder(order));
});

// DELETE /api/food-orders/:id/items/:itemId - body: { playerId }. Players
// may only remove their own items (mis-taps happen), and only while open.
foodOrdersRouter.delete('/:id/items/:itemId', ...withBodyPlayerIdentity, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung wurde bereits abgeschickt.' });
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

// PATCH /api/food-orders/:id/items/:itemId - body: { paid }. Whoever collects
// the money (the order's creator, or an admin) checks items off as people
// pay — same authorization as close. Deliberately not gated on open/closed:
// settling up normally happens after the order is already closed. A
// finalized order is fully locked, though.
foodOrdersRouter.patch('/:id/items/:itemId', requireConfiguredUser, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann Positionen als bezahlt markieren.' });
  }
  if (order.finalized_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist geschlossen und kann nicht mehr geändert werden.' });
  }

  const { paid } = req.body ?? {};
  if (typeof paid !== 'boolean') {
    return res.status(400).json({ error: 'paid muss true oder false sein.' });
  }
  const item = db
    .prepare('SELECT id FROM food_order_items WHERE id = ? AND order_id = ?')
    .get(req.params.itemId, order.id) as { id: string } | undefined;
  if (!item) return res.status(404).json({ error: 'Position nicht gefunden.' });

  db.prepare('UPDATE food_order_items SET paid = ? WHERE id = ?').run(paid ? 1 : 0, item.id);
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder(order));
});

// POST /api/food-orders/:id/close - freezes the list ("wird abgeschickt" in
// the UI). Exactly one closer wins; the second tap gets a 409 instead of
// double-notifying everyone.
foodOrdersRouter.post('/:id/close', requireConfiguredUser, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann diese Bestellung abschicken.' });
  }
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung wurde bereits abgeschickt.' });
  }

  const closedAt = Date.now();
  db.prepare('UPDATE food_orders SET closed_at = ? WHERE id = ?').run(closedAt, order.id);
  resolvePushTopic(`food-order:${order.id}`, false, {
    groupId: req.group!.id,
    eventId: communicationEventId(order.event_id),
  });
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder({ ...order, closed_at: closedAt }));
});

// POST /api/food-orders/:id/reopen - undoes a close so items/prices can be
// corrected or added and paid status keeps changing. Only from the (non-
// final) closed state; a finalized order can never be reopened.
foodOrdersRouter.post('/:id/reopen', requireConfiguredUser, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann diese Bestellung wieder öffnen.' });
  }
  if (order.finalized_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist bereits geschlossen und kann nicht mehr geöffnet werden.' });
  }
  if (order.closed_at === null) {
    return res.status(409).json({ error: 'Diese Bestellung ist bereits offen.' });
  }

  db.prepare('UPDATE food_orders SET closed_at = NULL WHERE id = ?').run(order.id);
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder({ ...order, closed_at: null }));
});

// POST /api/food-orders/:id/finalize - the creator's/admin's terminal lock
// ("wird geschlossen" in the UI): no more reopening, items, paid changes or
// metadata edits. Only from the closed/"abgeschickt" state (close first,
// then finalize once everyone has settled up).
foodOrdersRouter.post('/:id/finalize', requireConfiguredUser, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann diese Bestellung schließen.' });
  }
  if (order.finalized_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist bereits geschlossen.' });
  }
  if (order.closed_at === null) {
    return res.status(409).json({ error: 'Die Bestellung muss erst abgeschickt werden.' });
  }

  const finalizedAt = Date.now();
  db.prepare('UPDATE food_orders SET finalized_at = ? WHERE id = ?').run(finalizedAt, order.id);
  broadcast(Events.foodOrdersChanged, null);
  res.json(serializeOrder({ ...order, finalized_at: finalizedAt }));
});
