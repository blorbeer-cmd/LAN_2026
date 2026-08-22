import test from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, DEFAULT_GROUP_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { runFoodOrderPaymentReminderOnce } from '../foodOrderReminders';

test('food-order payment reminders aggregate unpaid orders and deduplicate within two hours', () => {
  const playerId = nanoid();
  const firstOrderId = nanoid();
  const secondOrderId = nanoid();
  const firstItemId = nanoid();
  const secondItemId = nanoid();
  const now = Date.now();

  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at)
     VALUES (?, 'Food Reminder Tester', ?, ?)`,
  ).run(playerId, nanoid(), now);
  ensureDefaultGroupMembership(playerId);
  db.prepare("INSERT OR IGNORE INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    BASE_EVENT_ID,
    playerId,
  );
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at)
     VALUES (?, ?, 'Reminder Pizza', ?, ?, ?)`,
  ).run(firstOrderId, BASE_EVENT_ID, playerId, now, now);
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at)
     VALUES (?, ?, 'Reminder Drinks', ?, ?, ?)`,
  ).run(secondOrderId, BASE_EVENT_ID, playerId, now + 1, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at)
     VALUES (?, ?, ?, 'Pizza', 1, ?)`,
  ).run(firstItemId, firstOrderId, playerId, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at)
     VALUES (?, ?, ?, 'Cola', 2, ?)`,
  ).run(secondItemId, secondOrderId, playerId, now);

  try {
    assert.equal(runFoodOrderPaymentReminderOnce(now), 0);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 119 * 60 * 1000), 0);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 120 * 60 * 1000), 1);
    const topic = `food-order-payment-reminder:${playerId}:${BASE_EVENT_ID}`;
    const entry = db
      .prepare('SELECT title, body, url, audience, topic_key AS topicKey FROM push_log WHERE topic_key = ?')
      .get(topic) as { title: string; body: string; url: string; audience: string; topicKey: string };
    assert.equal(entry.title, 'Offene Essenszahlung');
    assert.match(entry.body, /2 Sammelbestellungen/);
    assert.match(entry.body, /3 unbezahlte Positionen/);
    assert.equal(entry.url, '/#foodOrders');
    assert.equal(entry.audience, 'direct');
    assert.equal(entry.topicKey, topic);

    const firstReminderAt = now + 120 * 60 * 1000;
    assert.equal(
      (
        db
          .prepare(
            'SELECT last_sent_at AS lastSentAt FROM food_order_payment_reminders WHERE event_id = ? AND player_id = ?',
          )
          .get(BASE_EVENT_ID, playerId) as { lastSentAt: number }
      ).lastSentAt,
      firstReminderAt,
    );

    // Home's push history is intentionally bounded. Even after its entry is
    // gone, the dedicated reminder state must still suppress another send.
    db.prepare('DELETE FROM push_log WHERE topic_key = ?').run(topic);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 239 * 60 * 1000), 0);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key = ?').get(topic) as { count: number }).count,
      0,
    );
    assert.equal(runFoodOrderPaymentReminderOnce(now + 240 * 60 * 1000), 1);

    db.prepare('UPDATE food_order_items SET paid = 1 WHERE id IN (?, ?)').run(firstItemId, secondItemId);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 360 * 60 * 1000), 0);
  } finally {
    db.prepare('DELETE FROM food_orders WHERE id IN (?, ?)').run(firstOrderId, secondOrderId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }
});

test('food-order payment reminders use a direct order deep link for one order', () => {
  const playerId = nanoid();
  const orderId = nanoid();
  const itemId = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at) VALUES (?, 'Single Reminder Tester', ?, ?)`,
  ).run(playerId, nanoid(), now);
  ensureDefaultGroupMembership(playerId);
  db.prepare("INSERT OR IGNORE INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    BASE_EVENT_ID,
    playerId,
  );
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at)
     VALUES (?, ?, 'Single Reminder Pizza', ?, ?, ?)`,
  ).run(orderId, BASE_EVENT_ID, playerId, now, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at)
     VALUES (?, ?, ?, 'Pizza', 1, ?)`,
  ).run(itemId, orderId, playerId, now);

  try {
    assert.equal(runFoodOrderPaymentReminderOnce(now + 120 * 60 * 1000), 1);
    const entry = db
      .prepare('SELECT url FROM push_log WHERE event_id = ? AND target_id = ?')
      .get(BASE_EVENT_ID, orderId) as { url: string };
    assert.equal(entry.url, `/#foodOrders/${orderId}`);
  } finally {
    db.prepare('DELETE FROM food_orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }
});

test('food-order payment reminders skip finalized orders', () => {
  const playerId = nanoid();
  const orderId = nanoid();
  const itemId = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at) VALUES (?, 'Finalized Reminder Tester', ?, ?)`,
  ).run(playerId, nanoid(), now);
  ensureDefaultGroupMembership(playerId);
  db.prepare("INSERT OR IGNORE INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    BASE_EVENT_ID,
    playerId,
  );
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at, finalized_at)
     VALUES (?, ?, 'Finalized Reminder Pizza', ?, ?, ?, ?)`,
  ).run(orderId, BASE_EVENT_ID, playerId, now, now, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at)
     VALUES (?, ?, ?, 'Pizza', 1, ?)`,
  ).run(itemId, orderId, playerId, now);

  try {
    assert.equal(runFoodOrderPaymentReminderOnce(now + 120 * 60 * 1000), 0);
  } finally {
    db.prepare('DELETE FROM food_orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }
});

test('food-order payment reminders skip unpublished events', () => {
  const playerId = nanoid();
  const eventId = nanoid();
  const orderId = nanoid();
  const itemId = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at) VALUES (?, 'Draft Reminder Tester', ?, ?)`,
  ).run(playerId, nanoid(), now);
  ensureDefaultGroupMembership(playerId);
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, tracking_enabled, ended_at, is_test, group_id, status, visibility_scope)
     VALUES (?, 'Draft Reminder Event', ?, 0, NULL, 1, ?, 'draft', 'participants')`,
  ).run(eventId, now, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    eventId,
    playerId,
  );
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at)
     VALUES (?, ?, 'Draft Reminder Pizza', ?, ?, ?)`,
  ).run(orderId, eventId, playerId, now, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at)
     VALUES (?, ?, ?, 'Pizza', 1, ?)`,
  ).run(itemId, orderId, playerId, now);

  try {
    assert.equal(runFoodOrderPaymentReminderOnce(now + 120 * 60 * 1000), 0);
  } finally {
    db.prepare('DELETE FROM food_orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }
});

test('food-order payment reminders skip ended events', () => {
  const playerId = nanoid();
  const eventId = nanoid();
  const orderId = nanoid();
  const itemId = nanoid();
  const now = Date.now();

  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at)
     VALUES (?, 'Ended Event Reminder Tester', ?, ?)`,
  ).run(playerId, nanoid(), now);
  ensureDefaultGroupMembership(playerId);
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, tracking_enabled, ended_at, is_test, group_id, status, visibility_scope)
     VALUES (?, 'Ended Reminder Event', ?, 0, ?, 1, ?, 'ended', 'participants')`,
  ).run(eventId, now - 2 * 60 * 60 * 1000, now, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    eventId,
    playerId,
  );
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at)
     VALUES (?, ?, 'Ended Reminder Pizza', ?, ?, ?)`,
  ).run(orderId, eventId, playerId, now, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at)
     VALUES (?, ?, ?, 'Pizza', 1, ?)`,
  ).run(itemId, orderId, playerId, now);

  try {
    assert.equal(runFoodOrderPaymentReminderOnce(now + 120 * 60 * 1000), 0);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE event_id = ?').get(eventId) as { count: number }).count,
      0,
    );
  } finally {
    db.prepare('DELETE FROM food_orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }
});
