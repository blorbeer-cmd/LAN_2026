// Sammelbestellungen ("Pizza bei Luigi's — wer will was?"): one order is
// opened, everyone adds their own items while it's open, closing ("wird
// abgeschickt" in the UI — closed_at) freezes the list for reading out to
// the phone/delivery app. That's reversible via reopen (add a forgotten
// item, fix a price) until the creator/an admin finalizes it ("wird
// geschlossen" in the UI — finalized_at): while finalized, no more items,
// paid or metadata changes are possible. Finalizing is itself reversible
// through the same reopen endpoint (it undoes exactly the most recent lock
// step — finalized back to closed, closed back to open) — a finalized order
// is never permanently stuck, someone just has to explicitly reopen it
// before payments can be marked or anything else changes again. The
// check-then-write race to watch: someone closes the order while others are
// still typing — adding to a closed order must fail with a clean 409, never
// silently append, and two simultaneous closes must resolve to exactly one
// winner (see api.concurrency.test.ts).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { requireGroupEventAccess, resolveRequestGroupEventScope, resolveRequestGroupEventStorageId } from '../groupEventScope';
import { isIntInRange, isNonEmptyString, isValidUrl } from '../validation';
import { notifyPlayers, resolvePushTopic, updatePushTopicExpiry } from '../push';
import { requireUser, withBodyPlayerIdentity } from '../sessions';
import { communicationRecipientIds } from '../communicationRecipients';

export const foodOrdersRouter = Router();

foodOrdersRouter.use((req, res, next) => {
  const scope = resolveRequestGroupEventScope(req, undefined);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.locals.storageEventId = resolveRequestGroupEventStorageId(req);
  next();
});

const MAX_TITLE_LENGTH = 80;
const MAX_ITEM_LENGTH = 120;
const MAX_PRICE_CENTS = 500_00; // nobody orders a 500€ pizza
const MAX_ITEM_QUANTITY = 99;
const MAX_NOTES_LENGTH = 500;
const MAX_LINK_LENGTH = 300;
const HISTORY_LIMIT = 10;
const MAX_GROUP_PAYMENT_ITEMS = 100;

interface OrderRow {
  id: string;
  event_id: string;
  group_id: string;
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

function serializeOrder(row: OrderRow) {
  const items = (
    db
      .prepare(
        `SELECT i.id, i.player_id AS playerId, p.name AS playerName, p.color AS playerColor, p.avatar AS playerAvatar,
                i.description, i.quantity, i.price_cents AS priceCents, i.paid,
                i.paid_by AS paidBy, pb.name AS paidByName, i.paid_at AS paidAt, i.created_at AS createdAt
         FROM food_order_items i
         JOIN players p ON p.id = i.player_id
         LEFT JOIN players pb ON pb.id = i.paid_by
         WHERE i.order_id = ? ORDER BY i.created_at`
      )
      .all(row.id) as Array<{
      playerId: string;
      quantity: number;
      priceCents: number | null;
      paid: number;
      paidBy: string | null;
      paidByName: string | null;
      paidAt: number | null;
    }>
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

function buildList(groupId: string, eventId: string | null, targetOrderId: string | null = null) {
  if (!eventId) return { orders: [] };
  const rows = db
    .prepare(
      `SELECT fo.*, e.group_id
       FROM food_orders fo JOIN events e ON e.id = fo.event_id
       WHERE fo.event_id = ? AND e.group_id = ?
       ORDER BY fo.created_at DESC LIMIT ?`,
    )
    .all(eventId, groupId, HISTORY_LIMIT) as OrderRow[];
  if (targetOrderId && !rows.some((row) => row.id === targetOrderId)) {
    const target = getOrder(targetOrderId, groupId, eventId);
    if (target) rows.push(target);
  }
  rows.sort((a, b) => b.created_at - a.created_at);
  return { orders: rows.map(serializeOrder) };
}

function getOrder(id: string, groupId: string, eventId: string | null): OrderRow | undefined {
  if (!eventId) return undefined;
  return db
    .prepare(
      `SELECT fo.*, e.group_id
       FROM food_orders fo JOIN events e ON e.id = fo.event_id
       WHERE fo.id = ? AND e.group_id = ? AND fo.event_id = ?`,
    )
    .get(id, groupId, eventId) as OrderRow | undefined;
}

function orderDeliveryScope(order: OrderRow): { groupId: string; eventId: string } {
  return { groupId: order.group_id, eventId: order.event_id };
}

// GET /api/food-orders - current event's orders, newest first (open ones on
// top by recency; the frontend splits open vs closed).
foodOrdersRouter.get('/', (req, res) => {
  const targetOrderId = typeof req.query.orderId === 'string' ? req.query.orderId : null;
  res.json(buildList(req.group!.id, res.locals.storageEventId as string | null, targetOrderId));
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
    return res.status(400).json({ error: 'Speisekarte muss eine gültige http(s)-URL sein.' });
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

  const eventId = res.locals.storageEventId as string | null;
  if (!eventId) return res.status(409).json({ error: 'Für diese Gruppe läuft derzeit kein Event.' });
  const row: OrderRow = {
    id: nanoid(),
    event_id: eventId,
    group_id: req.group!.id,
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
  // (they just tapped the button themselves). Scoped to the order's event so
  // non-participants of an event-only order are not prompted for it — the
  // same recipient set the push below is limited to.
  const eventScope = row.event_id;
  broadcast(Events.foodOrdersChanged, {
    notify: {
      message: `Neue Sammelbestellung: ${row.title}${sendAtNote} – jetzt eintragen!`,
      excludePlayerId: playerId,
      target: { type: 'order', id: row.id },
    },
  }, { groupId: row.group_id, eventId: eventScope });
  const allPlayerIds = communicationRecipientIds(row.group_id, eventScope);
  notifyPlayers(
    allPlayerIds,
    {
      title: 'Neue Sammelbestellung',
      body: `${row.title}${sendAtNote} (von ${player.name}) – jetzt eintragen!`,
      url: `/#foodOrders/${row.id}`,
    },
    'all',
    { key: `food-order:${row.id}`, expiresAt: row.send_at },
    { groupId: row.group_id, eventId: eventScope },
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
foodOrdersRouter.patch('/:id', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
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
    return res.status(400).json({ error: 'Speisekarte muss eine gültige http(s)-URL sein (oder null zum Entfernen).' });
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
      groupId: order.group_id,
      eventId: order.event_id,
    });
  }
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.json(serializeOrder({ ...order, ...next }));
});

// DELETE /api/food-orders/:id - permanently removes the whole order (items
// cascade via the food_order_items foreign key). Unlike every other mutation
// here, this is deliberately NOT gated on open/closed/finalized: scrapping an
// order opened by mistake, or one nobody wants to keep around after the LAN,
// must stay possible at every stage, not just while it's still open.
foodOrdersRouter.delete('/:id', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann diese Bestellung löschen.' });
  }

  db.prepare('DELETE FROM food_orders WHERE id = ?').run(order.id);
  resolvePushTopic(`food-order:${order.id}`, false, {
    groupId: order.group_id,
    eventId: order.event_id,
  });
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.status(204).end();
});

// POST /api/food-orders/:id/items - body: { playerId, description, quantity, priceCents? }
foodOrdersRouter.post('/:id/items', ...withBodyPlayerIdentity, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
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

  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.status(201).json(serializeOrder(order));
});

// DELETE /api/food-orders/:id/items/:itemId - body: { playerId }. Players
// may only remove their own items (mis-taps happen), and only while open.
foodOrdersRouter.delete('/:id/items/:itemId', ...withBodyPlayerIdentity, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (order.closed_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung wurde bereits abgeschickt.' });
  }

  const { playerId } = req.body ?? {};
  const item = db
    .prepare('SELECT id, player_id, paid FROM food_order_items WHERE id = ? AND order_id = ?')
    .get(req.params.itemId, order.id) as { id: string; player_id: string; paid: number } | undefined;
  if (!item) return res.status(404).json({ error: 'Position nicht gefunden.' });
  if (item.player_id !== playerId) {
    return res.status(403).json({ error: 'Nur eigene Positionen können entfernt werden.' });
  }
  if (item.paid) {
    return res.status(409).json({ error: 'Bezahlte Positionen können nicht entfernt werden.' });
  }

  // Keep the state check in the DELETE itself: the read above only decides
  // which user-facing error to return. A simultaneous payment must win over
  // deletion instead of turning a stale UI into a paid-item delete.
  const deleted = db
    .prepare(
      `DELETE FROM food_order_items
       WHERE id = ? AND order_id = ? AND player_id = ? AND paid = 0
         AND EXISTS (SELECT 1 FROM food_orders WHERE id = ? AND closed_at IS NULL)`,
    )
    .run(item.id, order.id, playerId, order.id);
  if (deleted.changes === 0) {
    const currentOrder = db.prepare('SELECT closed_at FROM food_orders WHERE id = ?').get(order.id) as { closed_at: number | null } | undefined;
    if (!currentOrder) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
    if (currentOrder.closed_at !== null) {
      return res.status(409).json({ error: 'Diese Bestellung wurde bereits abgeschickt.' });
    }
    const currentItem = db
      .prepare('SELECT player_id, paid FROM food_order_items WHERE id = ? AND order_id = ?')
      .get(item.id, order.id) as { player_id: string; paid: number } | undefined;
    if (!currentItem) return res.status(404).json({ error: 'Position nicht gefunden.' });
    if (currentItem.player_id !== playerId) {
      return res.status(403).json({ error: 'Nur eigene Positionen können entfernt werden.' });
    }
    if (currentItem.paid) {
      return res.status(409).json({ error: 'Bezahlte Positionen können nicht entfernt werden.' });
    }
    return res.status(409).json({ error: 'Position konnte wegen einer parallelen Änderung nicht entfernt werden.' });
  }
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.json(serializeOrder(order));
});

// PATCH /api/food-orders/:id/items/bulk-paid - body: { itemIds, paid }. Apply a
// person's payment state as one transaction. The precondition check and the
// update live in the same transaction so a concurrent change cannot leave a
// partially paid group behind.
foodOrdersRouter.patch('/:id/items/bulk-paid', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (order.finalized_at !== null) {
    return res.status(409).json({ error: 'Diese Bestellung ist geschlossen und kann nicht mehr geändert werden.' });
  }

  const { itemIds, paid } = req.body ?? {};
  if (
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    itemIds.length > MAX_GROUP_PAYMENT_ITEMS ||
    itemIds.some((id: unknown) => typeof id !== 'string' || id.length === 0) ||
    new Set(itemIds).size !== itemIds.length ||
    typeof paid !== 'boolean'
  ) {
    return res.status(400).json({ error: 'itemIds muss eine eindeutige Liste sein und paid muss true oder false sein.' });
  }

  const placeholders = itemIds.map(() => '?').join(', ');
  const expectedPaid = paid ? 0 : 1;
  const result = db.transaction(() => {
    const items = db
      .prepare(`SELECT id, paid FROM food_order_items WHERE order_id = ? AND id IN (${placeholders})`)
      .all(order.id, ...itemIds) as Array<{ id: string; paid: number }>;
    if (items.length !== itemIds.length) {
      return { status: 404, error: 'Eine Position wurde nicht gefunden.' } as const;
    }
    if (items.some((item) => item.paid !== expectedPaid)) {
      return { status: 409, error: paid ? 'Eine Position wurde inzwischen bereits als bezahlt markiert.' : 'Eine Position ist bereits offen.' } as const;
    }

    const updated = db
      .prepare(
        `UPDATE food_order_items
         SET paid = ?, paid_by = ?, paid_at = ?
         WHERE order_id = ? AND paid = ? AND id IN (${placeholders})`,
      )
      .run(paid ? 1 : 0, paid ? req.player!.id : null, paid ? Date.now() : null, order.id, expectedPaid, ...itemIds);
    if (updated.changes !== itemIds.length) {
      return { status: 409, error: 'Die Positionen wurden inzwischen parallel geändert.' } as const;
    }
    return { status: 200 } as const;
  })();

  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  return res.json(serializeOrder(order));
});

// PATCH /api/food-orders/:id/items/:itemId - body: { paid }. Anyone who can
// pay into this order (any authenticated group member, same as the identity
// switch on the order itself) can also check a position off as paid — the
// automatic "mark paid after paying" flows through the group payment handoff
// otherwise. paid_by/paid_at record who last flipped the mark, shown in the
// Bezahlt-Marke's tooltip; both clear again when a position is unmarked.
// Deliberately not gated on open/closed: settling up normally happens after
// the order is already closed. A finalized order is fully locked, though.
foodOrdersRouter.patch('/:id/items/:itemId', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
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

  const expectedPaid = paid ? 0 : 1;
  const updated = db.prepare(
    'UPDATE food_order_items SET paid = ?, paid_by = ?, paid_at = ? WHERE id = ? AND paid = ?',
  ).run(
    paid ? 1 : 0,
    paid ? req.player!.id : null,
    paid ? Date.now() : null,
    item.id,
    expectedPaid,
  );
  if (updated.changes === 0) {
    return res.status(409).json({ error: paid ? 'Position wurde inzwischen bereits als bezahlt markiert.' : 'Position ist bereits offen.' });
  }
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.json(serializeOrder(order));
});

// POST /api/food-orders/:id/close - freezes the list ("wird abgeschickt" in
// the UI). Exactly one closer wins; the second tap gets a 409 instead of
// double-notifying everyone.
foodOrdersRouter.post('/:id/close', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
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
    groupId: order.group_id,
    eventId: order.event_id,
  });
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.json(serializeOrder({ ...order, closed_at: closedAt }));
});

// POST /api/food-orders/:id/reopen - undoes exactly the most recent lock
// step, one at a time. From finalized ("geschlossen"), it clears
// finalized_at and drops the order back to the closed/"abgeschickt" state
// (paid marking and metadata edits work again, items stay frozen). From
// closed, it clears closed_at and drops the order back to fully open so
// items/prices can be corrected or added. Calling it on an already-open
// order is a 409 - there is nothing left to undo.
foodOrdersRouter.post('/:id/reopen', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  if (req.player && order.created_by !== req.player.id && !req.player.is_admin) {
    return res.status(403).json({ error: 'Nur der Ersteller oder ein Admin kann diese Bestellung wieder öffnen.' });
  }
  if (order.finalized_at !== null) {
    db.prepare('UPDATE food_orders SET finalized_at = NULL WHERE id = ?').run(order.id);
    broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
    return res.json(serializeOrder({ ...order, finalized_at: null }));
  }
  if (order.closed_at === null) {
    return res.status(409).json({ error: 'Diese Bestellung ist bereits offen.' });
  }

  db.prepare('UPDATE food_orders SET closed_at = NULL WHERE id = ?').run(order.id);
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.json(serializeOrder({ ...order, closed_at: null }));
});

// POST /api/food-orders/:id/finalize - the creator's/admin's lock
// ("wird geschlossen" in the UI): no more items, paid changes or metadata
// edits while finalized. Only from the closed/"abgeschickt" state (close
// first, then finalize once everyone has settled up). Reversible via
// /reopen, which clears finalized_at and drops the order back to closed.
foodOrdersRouter.post('/:id/finalize', requireUser, (req, res) => {
  const order = getOrder(req.params.id, req.group!.id, res.locals.storageEventId as string | null);
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
  broadcast(Events.foodOrdersChanged, null, orderDeliveryScope(order));
  res.json(serializeOrder({ ...order, finalized_at: finalizedAt }));
});
