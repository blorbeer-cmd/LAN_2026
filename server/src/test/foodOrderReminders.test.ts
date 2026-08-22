import test from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, DEFAULT_GROUP_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { runFoodOrderPaymentReminderOnce } from '../foodOrderReminders';
import { getPushLogEntriesFor, hidePushForPlayer, markPushSeen, recordPushLog } from '../push';

test('food-order payment reminders aggregate unpaid orders and refresh one feed entry', () => {
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
    assert.equal(runFoodOrderPaymentReminderOnce(now + 59 * 60 * 1000), 0);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 60 * 60 * 1000), 1);
    const topic = `food-order-payment-reminder:${playerId}:${BASE_EVENT_ID}`;
    const entry = db
      .prepare(
        'SELECT id, title, body, url, audience, topic_key AS topicKey, expires_at AS expiresAt, created_at AS createdAt FROM push_log WHERE topic_key = ?',
      )
      .get(topic) as {
      id: string;
      title: string;
      body: string;
      url: string;
      audience: string;
      topicKey: string;
      expiresAt: number;
      createdAt: number;
    };
    assert.equal(entry.title, 'Offene Essenszahlung');
    assert.match(entry.body, /2 Sammelbestellungen/);
    assert.match(entry.body, /3 unbezahlte Positionen/);
    assert.equal(entry.url, '/#foodOrders');
    assert.equal(entry.audience, 'direct');
    assert.equal(entry.topicKey, topic);

    const legacyDuplicateId = nanoid();
    const unrelatedTopic = `legacy-food-order-payment:${playerId}:${BASE_EVENT_ID}`;
    const unrelatedId = nanoid();
    const insertLegacyPushLog = db.prepare(
      `INSERT INTO push_log
         (id, group_id, event_id, event_name_snapshot, notification_type, target_id,
          title, body, url, audience, player_ids, topic_key, expires_at, resolved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    insertLegacyPushLog.run(
      legacyDuplicateId,
      DEFAULT_GROUP_ID,
      BASE_EVENT_ID,
      'Default Event',
      'food-order-payment',
      'legacy-order',
      entry.title,
      entry.body,
      entry.url,
      entry.audience,
      JSON.stringify([playerId]),
      topic,
      entry.expiresAt,
      entry.createdAt - 1,
    );
    insertLegacyPushLog.run(
      unrelatedId,
      DEFAULT_GROUP_ID,
      BASE_EVENT_ID,
      'Default Event',
      'food-order-payment',
      'unrelated-order',
      'Unrelated legacy entry',
      'Must remain untouched',
      '/#foodOrders',
      'direct',
      JSON.stringify([playerId]),
      unrelatedTopic,
      entry.expiresAt,
      entry.createdAt - 2,
    );
    db.prepare('INSERT INTO push_log_seen (push_id, player_id, seen_at) VALUES (?, ?, ?)').run(
      legacyDuplicateId,
      playerId,
      now,
    );
    db.prepare('INSERT INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)').run(entry.id, playerId, now);
    assert.equal(
      getPushLogEntriesFor(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId).filter(
        (candidate) => candidate.body === entry.body,
      ).length,
      0,
      'legacy duplicates must collapse before per-player hiding is applied',
    );
    db.prepare('DELETE FROM push_log_hidden WHERE push_id = ?').run(entry.id);
    db.prepare('INSERT INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)').run(
      legacyDuplicateId,
      playerId,
      now,
    );
    db.prepare('INSERT INTO push_log_seen (push_id, player_id, seen_at) VALUES (?, ?, ?)').run(entry.id, playerId, now);
    db.prepare('INSERT INTO push_log_hidden (push_id, player_id, hidden_at) VALUES (?, ?, ?)').run(entry.id, playerId, now);
    db.prepare('UPDATE food_order_items SET paid = 1 WHERE id = ?').run(firstItemId);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 120 * 60 * 1000), 1);
    const refreshed = db
      .prepare('SELECT id, body, url FROM push_log WHERE topic_key = ?')
      .get(topic) as { id: string; body: string; url: string };
    assert.equal(refreshed.id, entry.id, 'recurring reminders must keep one stable feed entry');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key = ?').get(topic) as { count: number }).count,
      1,
      'the next reminder must remove legacy duplicates for the same topic',
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE id = ?').get(legacyDuplicateId) as { count: number }).count,
      0,
      'the legacy duplicate must be deleted',
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log_seen WHERE push_id = ?').get(legacyDuplicateId) as { count: number }).count,
      0,
      'cascaded read state for the deleted duplicate must be removed',
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE id = ?').get(unrelatedId) as { count: number }).count,
      1,
      'a different topic must not be removed during duplicate cleanup',
    );
    assert.match(refreshed.body, /Reminder Drinks/);
    assert.equal(refreshed.url, `/#foodOrders/${secondOrderId}`);
    const feedEntry = getPushLogEntriesFor(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId).find(
      (candidate) => candidate.notificationType === 'food-order-payment',
    );
    assert.ok(feedEntry, 'the refreshed reminder must remain visible in the feed');
    assert.equal(feedEntry.seen, false, 'a recurring reminder must become unread again');

    const latestReminderAt = now + 120 * 60 * 1000;
    assert.equal(
      (
        db
          .prepare(
            'SELECT last_sent_at AS lastSentAt FROM food_order_payment_reminders WHERE event_id = ? AND player_id = ?',
          )
          .get(BASE_EVENT_ID, playerId) as { lastSentAt: number }
      ).lastSentAt,
      latestReminderAt,
    );

    // Home's push history is intentionally bounded. Even after its entry is
    // gone, the dedicated reminder state must still suppress another send.
    db.prepare('DELETE FROM push_log WHERE topic_key = ?').run(topic);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 179 * 60 * 1000), 0);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key = ?').get(topic) as { count: number }).count,
      0,
    );
    assert.equal(runFoodOrderPaymentReminderOnce(now + 180 * 60 * 1000), 1);

    db.prepare('UPDATE food_order_items SET paid = 1 WHERE id = ?').run(secondItemId);
    assert.equal(runFoodOrderPaymentReminderOnce(now + 240 * 60 * 1000), 0);
  } finally {
    db.prepare('DELETE FROM food_orders WHERE id IN (?, ?)').run(firstOrderId, secondOrderId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  }
});

test('deduplicated push logs reset state only for current recipients', () => {
  const firstPlayerId = nanoid();
  const secondPlayerId = nanoid();
  const now = Date.now();
  const topic = `food-order-payment-reminder:shared:${nanoid()}`;
  const ordinaryTopic = `food-order-payment:${nanoid()}`;
  const playerRows = [firstPlayerId, secondPlayerId].map((id) => [id, nanoid(), now]);

  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    firstPlayerId,
    'Dedup Recipient A',
    playerRows[0][1],
    now,
  );
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    secondPlayerId,
    'Dedup Recipient B',
    playerRows[1][1],
    now,
  );
  ensureDefaultGroupMembership(firstPlayerId);
  ensureDefaultGroupMembership(secondPlayerId);

  try {
    const first = recordPushLog(
      [firstPlayerId, secondPlayerId],
      { title: 'Shared reminder', body: 'First occurrence', type: 'food-order-payment' },
      'direct',
      { key: topic },
    );
    assert.equal(markPushSeen(DEFAULT_GROUP_ID, first.id, firstPlayerId), 'seen');
    assert.equal(hidePushForPlayer(DEFAULT_GROUP_ID, first.id, firstPlayerId), 'hidden');
    assert.equal(markPushSeen(DEFAULT_GROUP_ID, first.id, secondPlayerId), 'seen');
    assert.equal(hidePushForPlayer(DEFAULT_GROUP_ID, first.id, secondPlayerId), 'hidden');

    const refreshed = recordPushLog(
      [firstPlayerId],
      { title: 'Shared reminder', body: 'Second occurrence', type: 'food-order-payment' },
      'direct',
      { key: topic },
    );
    assert.equal(refreshed.id, first.id);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log_seen WHERE push_id = ? AND player_id = ?').get(first.id, firstPlayerId) as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log_hidden WHERE push_id = ? AND player_id = ?').get(first.id, firstPlayerId) as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log_seen WHERE push_id = ? AND player_id = ?').get(first.id, secondPlayerId) as { count: number }).count,
      1,
      'a recipient not included in the new occurrence keeps their read state',
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log_hidden WHERE push_id = ? AND player_id = ?').get(first.id, secondPlayerId) as { count: number }).count,
      1,
      'a recipient not included in the new occurrence keeps their hidden state',
    );

    recordPushLog(
      [firstPlayerId],
      { title: 'Normal history', body: 'Occurrence one', type: 'food-order-payment' },
      'direct',
      { key: ordinaryTopic },
    );
    recordPushLog(
      [firstPlayerId],
      { title: 'Normal history', body: 'Occurrence two', type: 'food-order-payment' },
      'direct',
      { key: ordinaryTopic },
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key = ?').get(ordinaryTopic) as { count: number }).count,
      2,
      'a non-reminder topic keeps its normal history even with the same payload type',
    );
  } finally {
    db.prepare('DELETE FROM push_log WHERE topic_key IN (?, ?)').run(topic, ordinaryTopic);
    db.prepare('DELETE FROM players WHERE id IN (?, ?)').run(firstPlayerId, secondPlayerId);
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
    assert.equal(runFoodOrderPaymentReminderOnce(now + 60 * 60 * 1000), 1);
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
    assert.equal(runFoodOrderPaymentReminderOnce(now + 60 * 60 * 1000), 0);
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
    assert.equal(runFoodOrderPaymentReminderOnce(now + 60 * 60 * 1000), 0);
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
    assert.equal(runFoodOrderPaymentReminderOnce(now + 60 * 60 * 1000), 0);
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
