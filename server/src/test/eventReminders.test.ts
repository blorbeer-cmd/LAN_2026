import test from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { DEFAULT_GROUP_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import {
  EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS,
  EVENT_CALENDAR_REMINDER_INTERVAL_MS,
  EVENT_STEFAN_CONFIRMATION_FOLLOWUP_DELAY_MS,
  EVENT_UPCOMING_DAY_DELAY_MS,
  EVENT_UPCOMING_WEEK_DELAY_MS,
  STEFAN_CALENDAR_GAG_USERNAME,
  confirmEventCalendar,
  eventReminderTopicKey,
  runEventReminderSweepOnce,
} from '../eventReminders';

function createReminderFixture(startsAt: number, playerName?: string) {
  const playerId = nanoid();
  const eventId = nanoid();
  const acceptedAt = Date.now();
  db.prepare(
    `INSERT INTO players (id, name, api_key, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(playerId, playerName ?? `Calendar Reminder ${playerId}`, nanoid(), acceptedAt);
  ensureDefaultGroupMembership(playerId);
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, group_id, status, visibility_scope, schedule_revision)
     VALUES (?, ?, ?, ?, ?, 'published', 'participants', 1)`,
  ).run(eventId, `Reminder Event ${eventId}`, startsAt, startsAt + 2 * 60 * 60 * 1000, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')`,
  ).run(eventId, playerId);
  db.prepare(
    `UPDATE event_participation_history SET accepted_at = ?, updated_at = ?
     WHERE event_id = ? AND player_id = ?`,
  ).run(acceptedAt, acceptedAt, eventId, playerId);
  return { eventId, playerId, acceptedAt, startsAt };
}

function cleanupFixture(eventId: string, playerId: string): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
}

test('calendar reminders start two hours after acceptance, repeat weekly and stop after confirmation', () => {
  const acceptedAt = Date.now();
  const fixture = createReminderFixture(acceptedAt + 30 * 24 * 60 * 60 * 1000);
  const firstDue = fixture.acceptedAt + EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS;
  const topic = eventReminderTopicKey('calendar', fixture.eventId, fixture.playerId, 1);

  try {
    assert.deepEqual(runEventReminderSweepOnce(firstDue - 1), { calendar: 0, upcoming: 0 });
    assert.deepEqual(runEventReminderSweepOnce(firstDue), { calendar: 1, upcoming: 0 });
    assert.deepEqual(runEventReminderSweepOnce(firstDue + EVENT_CALENDAR_REMINDER_INTERVAL_MS - 1), {
      calendar: 0,
      upcoming: 0,
    });
    assert.deepEqual(runEventReminderSweepOnce(firstDue + EVENT_CALENDAR_REMINDER_INTERVAL_MS), {
      calendar: 1,
      upcoming: 0,
    });

    const push = db
      .prepare(
        `SELECT title, body, url, audience, notification_type AS notificationType,
                target_id AS targetId, topic_key AS topicKey, resolved_at AS resolvedAt
         FROM push_log WHERE topic_key = ?`,
      )
      .get(topic) as Record<string, string | number | null>;
    assert.equal(push.title, 'Event in den Kalender eintragen');
    assert.match(String(push.body), /bestätige die Übernahme/);
    assert.equal(push.url, '/#events');
    assert.equal(push.audience, 'direct');
    assert.equal(push.notificationType, 'event-calendar-reminder');
    assert.equal(push.targetId, fixture.eventId);
    assert.equal(push.topicKey, topic);
    assert.equal(push.resolvedAt, null);

    const confirmed = confirmEventCalendar(
      fixture.eventId,
      fixture.playerId,
      firstDue + EVENT_CALENDAR_REMINDER_INTERVAL_MS + 1,
    );
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.ok && confirmed.changed, true);
    assert.notEqual(
      (db.prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?').get(topic) as {
        resolvedAt: number | null;
      }).resolvedAt,
      null,
    );
    assert.deepEqual(runEventReminderSweepOnce(firstDue + 2 * EVENT_CALENDAR_REMINDER_INTERVAL_MS), {
      calendar: 0,
      upcoming: 0,
    });

    const repeated = confirmEventCalendar(fixture.eventId, fixture.playerId, firstDue + 2);
    assert.equal(repeated.ok, true);
    assert.equal(repeated.ok && repeated.changed, false);
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('a changed schedule revision requires a fresh calendar confirmation', () => {
  const acceptedAt = Date.now();
  const fixture = createReminderFixture(acceptedAt + 30 * 24 * 60 * 60 * 1000);
  const firstDue = fixture.acceptedAt + EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS;

  try {
    const firstConfirmation = confirmEventCalendar(fixture.eventId, fixture.playerId, firstDue);
    assert.equal(firstConfirmation.ok, true);
    db.prepare(
      `UPDATE events
       SET schedule_revision = 2, starts_at = ?, ends_at = ?
       WHERE id = ?`,
    ).run(fixture.startsAt + EVENT_CALENDAR_REMINDER_INTERVAL_MS, fixture.startsAt + EVENT_CALENDAR_REMINDER_INTERVAL_MS + 2 * 60 * 60 * 1000, fixture.eventId);

    assert.deepEqual(runEventReminderSweepOnce(firstDue + 1), { calendar: 1, upcoming: 0 });
    const secondConfirmation = confirmEventCalendar(fixture.eventId, fixture.playerId, firstDue + 2);
    assert.equal(secondConfirmation.ok, true);
    assert.equal(secondConfirmation.ok && secondConfirmation.scheduleRevision, 2);
    assert.equal(
      (db
        .prepare('SELECT COUNT(*) AS count FROM event_calendar_confirmations WHERE event_id = ? AND player_id = ?')
        .get(fixture.eventId, fixture.playerId) as { count: number }).count,
      2,
    );
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('Stefan receives one extra calendar check a week after confirming', () => {
  const confirmedAt = Date.now();
  const fixture = createReminderFixture(
    confirmedAt + 30 * 24 * 60 * 60 * 1000,
    STEFAN_CALENDAR_GAG_USERNAME,
  );
  const followupDue = confirmedAt + EVENT_STEFAN_CONFIRMATION_FOLLOWUP_DELAY_MS;
  const topic = eventReminderTopicKey('stefan_calendar_followup', fixture.eventId, fixture.playerId, 1);

  try {
    assert.equal(confirmEventCalendar(fixture.eventId, fixture.playerId, confirmedAt).ok, true);
    assert.deepEqual(runEventReminderSweepOnce(followupDue - 1), { calendar: 0, upcoming: 0 });
    assert.deepEqual(runEventReminderSweepOnce(followupDue), { calendar: 1, upcoming: 0 });
    assert.deepEqual(runEventReminderSweepOnce(followupDue + 1), { calendar: 0, upcoming: 0 });

    const push = db
      .prepare(
        `SELECT title, body, notification_type AS notificationType, topic_key AS topicKey
         FROM push_log WHERE topic_key = ?`,
      )
      .get(topic) as Record<string, string>;
    assert.equal(push.title, 'Ist der Termin wirklich im Kalender, Stefan??');
    assert.match(push.body, /steht wirklich drin/);
    assert.equal(push.notificationType, 'event-calendar-stefan-followup');
    assert.equal(push.topicKey, topic);
    assert.deepEqual(
      db
        .prepare(
          `SELECT kind FROM event_reminder_deliveries
           WHERE event_id = ? AND player_id = ? AND schedule_revision = 1`,
        )
        .all(fixture.eventId, fixture.playerId),
      [{ kind: 'stefan_calendar_followup' }],
    );
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('the latest acceptance starts the two-hour calendar reminder delay again', () => {
  const acceptedAt = Date.now();
  const fixture = createReminderFixture(acceptedAt + 30 * 24 * 60 * 60 * 1000);
  const reacceptedAt = fixture.acceptedAt + 24 * 60 * 60 * 1000;

  try {
    db.prepare("UPDATE event_participants SET status = 'declined' WHERE event_id = ? AND player_id = ?").run(
      fixture.eventId,
      fixture.playerId,
    );
    db.prepare("UPDATE event_participants SET status = 'accepted' WHERE event_id = ? AND player_id = ?").run(
      fixture.eventId,
      fixture.playerId,
    );
    db.prepare(
      `UPDATE event_participation_history SET updated_at = ?
       WHERE event_id = ? AND player_id = ?`,
    ).run(reacceptedAt, fixture.eventId, fixture.playerId);

    assert.deepEqual(
      runEventReminderSweepOnce(fixture.acceptedAt + EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS),
      { calendar: 0, upcoming: 0 },
    );
    assert.deepEqual(
      runEventReminderSweepOnce(reacceptedAt + EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS),
      { calendar: 1, upcoming: 0 },
    );
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('reminder and confirmation state is removed with the participant', () => {
  const now = Date.now();
  const fixture = createReminderFixture(now + 30 * 24 * 60 * 60 * 1000);

  try {
    assert.equal(confirmEventCalendar(fixture.eventId, fixture.playerId, now).ok, true);
    db.prepare(
      `INSERT INTO event_reminder_deliveries
         (event_id, player_id, schedule_revision, kind, first_sent_at, last_sent_at)
       VALUES (?, ?, 1, 'calendar', ?, ?)`,
    ).run(fixture.eventId, fixture.playerId, now, now);
    db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(
      fixture.eventId,
      fixture.playerId,
    );

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM event_calendar_confirmations WHERE event_id = ?').get(fixture.eventId) as {
        count: number;
      }).count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM event_reminder_deliveries WHERE event_id = ?').get(fixture.eventId) as {
        count: number;
      }).count,
      0,
    );
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('upcoming reminders send once at one week and one day even after calendar confirmation', () => {
  const now = Date.now();
  const startsAt = now + 8 * 24 * 60 * 60 * 1000;
  const fixture = createReminderFixture(startsAt);
  const weekDue = startsAt - EVENT_UPCOMING_WEEK_DELAY_MS;
  const dayDue = startsAt - EVENT_UPCOMING_DAY_DELAY_MS;

  try {
    assert.equal(confirmEventCalendar(fixture.eventId, fixture.playerId, now).ok, true);
    assert.deepEqual(runEventReminderSweepOnce(weekDue - 1), { calendar: 0, upcoming: 0 });
    assert.deepEqual(runEventReminderSweepOnce(weekDue), { calendar: 0, upcoming: 1 });
    assert.deepEqual(runEventReminderSweepOnce(weekDue + 1), { calendar: 0, upcoming: 0 });
    assert.deepEqual(runEventReminderSweepOnce(dayDue), { calendar: 0, upcoming: 1 });
    assert.deepEqual(runEventReminderSweepOnce(dayDue + 1), { calendar: 0, upcoming: 0 });

    const pushes = db
      .prepare(
        `SELECT notification_type AS notificationType, title
         FROM push_log
         WHERE target_id = ? AND notification_type LIKE 'event-upcoming-%'
         ORDER BY created_at`,
      )
      .all(fixture.eventId) as Array<{
        notificationType: string;
        title: string;
      }>;
    assert.deepEqual(
      pushes.map((push) => push.notificationType).sort(),
      ['event-upcoming-day', 'event-upcoming-week'],
    );
    assert.ok(pushes.some((push) => push.title === 'Morgen geht es los'));
    assert.ok(pushes.some((push) => push.title === 'In einer Woche geht es los'));
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});

test('a first sweep inside the final day sends only the day reminder', () => {
  const now = Date.now();
  const fixture = createReminderFixture(now + 12 * 60 * 60 * 1000);

  try {
    assert.deepEqual(runEventReminderSweepOnce(now), { calendar: 0, upcoming: 1 });
    const deliveries = db
      .prepare(
        `SELECT kind FROM event_reminder_deliveries
         WHERE event_id = ? AND player_id = ?`,
      )
      .all(fixture.eventId, fixture.playerId) as Array<{ kind: string }>;
    assert.deepEqual(deliveries, [{ kind: 'upcoming_day' }]);
  } finally {
    cleanupFixture(fixture.eventId, fixture.playerId);
  }
});
