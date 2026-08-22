import test from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { DEFAULT_GROUP_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { runEventPaymentReminderOnce } from '../eventPaymentReminders';

function createReminderFixture(options: {
  status?: 'published' | 'draft' | 'ended';
  costCents?: number | null;
  paymentDueAt?: number | null;
} = {}) {
  const playerId = nanoid();
  const eventId = nanoid();
  const now = Date.now();
  const status = options.status ?? 'published';
  const endedAt = status === 'ended' ? now : null;
  const costCents = options.costCents === undefined ? 2550 : options.costCents;

  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(playerId, `Event Reminder ${playerId}`, nanoid(), now);
  ensureDefaultGroupMembership(playerId);
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, cost_cents, paypal_link, payment_due_at, tracking_enabled,
        ended_at, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, ?, 'https://paypal.me/reminder', ?, 0, ?, ?, ?, 'participants')`,
  ).run(eventId, `Reminder LAN ${eventId}`, now, now + 24 * 60 * 60 * 1000, costCents, options.paymentDueAt ?? null, endedAt, DEFAULT_GROUP_ID, status);
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status, paid)
     VALUES (?, ?, 'accepted', 0)`,
  ).run(eventId, playerId);
  // SQLite's history trigger uses wall-clock time. Pin it to this test's
  // clock so exact two-hour boundaries stay deterministic.
  db.prepare(
    `UPDATE event_participation_history SET accepted_at = ?, updated_at = ?
     WHERE event_id = ? AND player_id = ?`,
  ).run(now, now, eventId, playerId);

  return { playerId, eventId, now };
}

function cleanupFixture(eventId: string, playerId: string): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
}

test('event payment reminders start after two hours and preserve their cadence across push cleanup', () => {
  const { playerId, eventId, now } = createReminderFixture();
  const topic = `event-payment-reminder:${playerId}:${eventId}`;

  try {
    assert.equal(runEventPaymentReminderOnce(now), 0);
    assert.equal(runEventPaymentReminderOnce(now + 119 * 60 * 1000), 0);
    assert.equal(runEventPaymentReminderOnce(now + 120 * 60 * 1000), 1);

    const entry = db
      .prepare(
        `SELECT title, body, url, audience, notification_type AS notificationType,
                target_id AS targetId, topic_key AS topicKey
         FROM push_log WHERE topic_key = ?`,
      )
      .get(topic) as Record<string, string>;
    assert.equal(entry.title, 'Offener Event-Beitrag');
    assert.match(entry.body, /Reminder LAN/);
    assert.match(entry.body, /25,50/);
    assert.equal(entry.url, '/#events');
    assert.equal(entry.audience, 'direct');
    assert.equal(entry.notificationType, 'event-payment');
    assert.equal(entry.targetId, eventId);
    assert.equal(entry.topicKey, topic);

    db.prepare('DELETE FROM push_log WHERE topic_key = ?').run(topic);
    assert.equal(runEventPaymentReminderOnce(now + 239 * 60 * 1000), 0);
    assert.equal(runEventPaymentReminderOnce(now + 240 * 60 * 1000), 1);

    db.prepare('UPDATE event_participants SET paid = 1 WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
    assert.equal(runEventPaymentReminderOnce(now + 360 * 60 * 1000), 0);
  } finally {
    cleanupFixture(eventId, playerId);
  }
});

test('event payment reminders skip contributions that are not currently payable', () => {
  const fixtures = [
    createReminderFixture({ status: 'draft' }),
    createReminderFixture({ status: 'ended' }),
    createReminderFixture({ costCents: null }),
  ];

  try {
    const afterTwoHours = Math.max(...fixtures.map((fixture) => fixture.now)) + 120 * 60 * 1000;
    assert.equal(runEventPaymentReminderOnce(afterTwoHours), 0);
  } finally {
    for (const fixture of fixtures) cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('an event payment due date defers the first reminder until that date', () => {
  const baseNow = Date.now();
  const dueAt = baseNow + 6 * 60 * 60 * 1000;
  const fixture = createReminderFixture({ paymentDueAt: dueAt });

  try {
    assert.equal(runEventPaymentReminderOnce(dueAt - 1), 0);
    assert.equal(runEventPaymentReminderOnce(dueAt), 1);
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});
