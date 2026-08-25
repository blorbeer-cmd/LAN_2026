import { db } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';
import {
  EVENT_REMINDER_TOPIC_PREFIX,
  notifyPlayers,
  resolvePushTopic,
} from './push';

export const EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;
export const EVENT_CALENDAR_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_UPCOMING_WEEK_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_UPCOMING_DAY_DELAY_MS = 24 * 60 * 60 * 1000;
export const EVENT_REMINDER_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

type ReminderKind = 'calendar' | 'upcoming_week' | 'upcoming_day';

interface ReminderRow {
  eventId: string;
  groupId: string;
  eventName: string;
  startsAt: number;
  scheduleRevision: number;
  playerId: string;
}

export function eventReminderTopicKey(
  kind: ReminderKind,
  eventId: string,
  playerId: string,
  scheduleRevision: number,
): string {
  return `${EVENT_REMINDER_TOPIC_PREFIX}${kind}:${eventId}:${playerId}:${scheduleRevision}`;
}

function dueCalendarReminders(now: number): ReminderRow[] {
  return db
    .prepare(
      `SELECT e.id AS eventId, e.group_id AS groupId, e.name AS eventName,
              e.starts_at AS startsAt, e.schedule_revision AS scheduleRevision,
              ep.player_id AS playerId
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       JOIN event_participation_history h
         ON h.event_id = ep.event_id AND h.player_id = ep.player_id
       JOIN players p ON p.id = ep.player_id
       LEFT JOIN event_calendar_confirmations confirmation
         ON confirmation.event_id = e.id
        AND confirmation.player_id = ep.player_id
        AND confirmation.schedule_revision = e.schedule_revision
       LEFT JOIN event_reminder_deliveries delivery
         ON delivery.event_id = e.id
        AND delivery.player_id = ep.player_id
        AND delivery.schedule_revision = e.schedule_revision
        AND delivery.kind = 'calendar'
       WHERE e.group_id IS NOT NULL
         AND e.status = 'published'
         AND e.ended_at IS NULL
         AND e.is_test = 0
         AND e.starts_at IS NOT NULL
         AND e.ends_at IS NOT NULL
         AND e.starts_at > ?
         AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         AND p.deactivated_at IS NULL
         AND p.is_test = 0
         AND h.accepted_at IS NOT NULL
         AND h.updated_at <= ?
         AND confirmation.event_id IS NULL
         AND (delivery.last_sent_at IS NULL OR delivery.last_sent_at <= ?)
       ORDER BY e.starts_at, e.id, ep.player_id`,
    )
    .all(
      now,
      now - EVENT_CALENDAR_FIRST_REMINDER_DELAY_MS,
      now - EVENT_CALENDAR_REMINDER_INTERVAL_MS,
    ) as ReminderRow[];
}

function dueUpcomingReminders(now: number): Array<ReminderRow & { kind: 'upcoming_week' | 'upcoming_day' }> {
  return db
    .prepare(
      `SELECT e.id AS eventId, e.group_id AS groupId, e.name AS eventName,
              e.starts_at AS startsAt, e.schedule_revision AS scheduleRevision,
              ep.player_id AS playerId,
              CASE
                WHEN e.starts_at - ? <= ? THEN 'upcoming_day'
                ELSE 'upcoming_week'
              END AS kind
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       JOIN players p ON p.id = ep.player_id
       WHERE e.group_id IS NOT NULL
         AND e.status = 'published'
         AND e.ended_at IS NULL
         AND e.is_test = 0
         AND e.starts_at IS NOT NULL
         AND e.starts_at > ?
         AND e.starts_at - ? <= ?
         AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         AND p.deactivated_at IS NULL
         AND p.is_test = 0
         AND NOT EXISTS (
           SELECT 1 FROM event_reminder_deliveries delivery
           WHERE delivery.event_id = e.id
             AND delivery.player_id = ep.player_id
             AND delivery.schedule_revision = e.schedule_revision
             AND delivery.kind = CASE
               WHEN e.starts_at - ? <= ? THEN 'upcoming_day'
               ELSE 'upcoming_week'
             END
         )
       ORDER BY e.starts_at, e.id, ep.player_id`,
    )
    .all(
      EVENT_UPCOMING_DAY_DELAY_MS,
      now,
      now,
      EVENT_UPCOMING_WEEK_DELAY_MS,
      now,
      EVENT_UPCOMING_DAY_DELAY_MS,
      now,
    ) as Array<ReminderRow & { kind: 'upcoming_week' | 'upcoming_day' }>;
}

function recordDelivery(row: ReminderRow, kind: ReminderKind, now: number): void {
  db.prepare(
    `INSERT INTO event_reminder_deliveries
       (event_id, player_id, schedule_revision, kind, first_sent_at, last_sent_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, player_id, schedule_revision, kind)
     DO UPDATE SET last_sent_at = excluded.last_sent_at`,
  ).run(row.eventId, row.playerId, row.scheduleRevision, kind, now, now);
}

function sendCalendarReminder(row: ReminderRow, now: number): boolean {
  const delivery = notifyPlayers(
    [row.playerId],
    {
      title: 'Event in den Kalender eintragen',
      body: `Füge „${row.eventName}“ deinem Kalender hinzu und bestätige die Übernahme anschließend in der App.`,
      url: '/#events',
      type: 'event-calendar-reminder',
      targetId: row.eventId,
    },
    'direct',
    {
      key: eventReminderTopicKey('calendar', row.eventId, row.playerId, row.scheduleRevision),
      expiresAt: row.startsAt,
    },
    { groupId: row.groupId, eventId: row.eventId },
  );
  if (!delivery) return false;
  recordDelivery(row, 'calendar', now);
  return true;
}

function sendUpcomingReminder(
  row: ReminderRow,
  kind: 'upcoming_week' | 'upcoming_day',
  now: number,
): boolean {
  const isDay = kind === 'upcoming_day';
  const delivery = notifyPlayers(
    [row.playerId],
    {
      title: isDay ? 'Morgen geht es los' : 'In einer Woche geht es los',
      body: isDay
        ? `In einem Tag startet „${row.eventName}“.`
        : `In einer Woche startet „${row.eventName}“.`,
      url: '/#events',
      type: isDay ? 'event-upcoming-day' : 'event-upcoming-week',
      targetId: row.eventId,
    },
    'direct',
    {
      key: eventReminderTopicKey(kind, row.eventId, row.playerId, row.scheduleRevision),
      expiresAt: row.startsAt,
    },
    { groupId: row.groupId, eventId: row.eventId },
  );
  if (!delivery) return false;
  recordDelivery(row, kind, now);
  return true;
}

export function runEventReminderSweepOnce(now = Date.now()): { calendar: number; upcoming: number } {
  let calendar = 0;
  for (const row of dueCalendarReminders(now)) {
    if (sendCalendarReminder(row, now)) calendar += 1;
  }

  let upcoming = 0;
  for (const row of dueUpcomingReminders(now)) {
    if (sendUpcomingReminder(row, row.kind, now)) upcoming += 1;
  }
  return { calendar, upcoming };
}

export type ConfirmEventCalendarResult =
  | { ok: true; changed: boolean; confirmedAt: number; scheduleRevision: number }
  | { ok: false; reason: 'not_accepted' | 'not_upcoming' };

export function confirmEventCalendar(
  eventId: string,
  playerId: string,
  now = Date.now(),
): ConfirmEventCalendarResult {
  const row = db
    .prepare(
      `SELECT e.group_id AS groupId, e.schedule_revision AS scheduleRevision,
              e.status, e.starts_at AS startsAt, e.ends_at AS endsAt,
              e.ended_at AS endedAt, ep.status AS participationStatus
       FROM events e
       LEFT JOIN event_participants ep
         ON ep.event_id = e.id AND ep.player_id = ?
       WHERE e.id = ?`,
    )
    .get(playerId, eventId) as
    | {
        groupId: string | null;
        scheduleRevision: number;
        status: string;
        startsAt: number | null;
        endsAt: number | null;
        endedAt: number | null;
        participationStatus: string | null;
      }
    | undefined;
  if (!row || row.participationStatus !== 'accepted') return { ok: false, reason: 'not_accepted' };
  if (
    !row.groupId ||
    row.status !== 'published' ||
    row.endedAt !== null ||
    row.startsAt === null ||
    row.endsAt === null ||
    row.endsAt <= now
  ) {
    return { ok: false, reason: 'not_upcoming' };
  }

  const existing = db
    .prepare(
      `SELECT confirmed_at AS confirmedAt
       FROM event_calendar_confirmations
       WHERE event_id = ? AND player_id = ? AND schedule_revision = ?`,
    )
    .get(eventId, playerId, row.scheduleRevision) as { confirmedAt: number } | undefined;
  const confirmedAt = existing?.confirmedAt ?? now;
  const changed = db
    .prepare(
      `INSERT OR IGNORE INTO event_calendar_confirmations
         (event_id, player_id, schedule_revision, confirmed_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(eventId, playerId, row.scheduleRevision, confirmedAt).changes === 1;

  resolvePushTopic(
    eventReminderTopicKey('calendar', eventId, playerId, row.scheduleRevision),
    false,
    { groupId: row.groupId, eventId },
  );
  return { ok: true, changed, confirmedAt, scheduleRevision: row.scheduleRevision };
}

export function startEventReminderSweep(): NodeJS.Timeout {
  const run = () => {
    try {
      runEventReminderSweepOnce();
    } catch (error) {
      // A reminder failure must not take down the server; the durable state
      // leaves the item eligible for the next sweep.
      // eslint-disable-next-line no-console
      console.error('Event reminder sweep failed:', error);
    }
  };

  run();
  const timer = setInterval(run, EVENT_REMINDER_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
