import { db } from './db';
import { PAYMENT_REMINDER_INTERVAL_MS } from './paymentReminders';
import { notifyPlayers } from './push';

export const EVENT_PAYMENT_REMINDER_INTERVAL_MS = PAYMENT_REMINDER_INTERVAL_MS;

interface EventPaymentRow {
  eventId: string;
  groupId: string;
  eventName: string;
  costCents: number;
  playerId: string;
}

function eligiblePayments(now: number): EventPaymentRow[] {
  return db
    .prepare(
      `SELECT e.id AS eventId, e.group_id AS groupId, e.name AS eventName,
              e.cost_cents AS costCents, ep.player_id AS playerId
       FROM events e
       JOIN event_participants ep ON ep.event_id = e.id
       JOIN event_participation_history h
         ON h.event_id = ep.event_id AND h.player_id = ep.player_id
       JOIN players p ON p.id = ep.player_id
       WHERE e.cost_cents IS NOT NULL
         AND e.status = 'published'
         AND e.ended_at IS NULL
         AND ep.status = 'accepted'
         AND ep.paid = 0
         AND p.deactivated_at IS NULL
         AND h.accepted_at IS NOT NULL
         AND (
           (e.payment_due_at IS NOT NULL AND e.payment_due_at <= ?)
           OR (e.payment_due_at IS NULL AND h.accepted_at <= ?)
         )`,
    )
    .all(now, now - EVENT_PAYMENT_REMINDER_INTERVAL_MS) as EventPaymentRow[];
}

function topicKey(row: EventPaymentRow): string {
  return `event-payment-reminder:${row.playerId}:${row.eventId}`;
}

function wasSentRecently(row: EventPaymentRow, now: number): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM event_payment_reminders
         WHERE group_id = ? AND event_id = ? AND player_id = ? AND last_sent_at > ?
         LIMIT 1`,
      )
      .get(row.groupId, row.eventId, row.playerId, now - EVENT_PAYMENT_REMINDER_INTERVAL_MS),
  );
}

function recordSent(row: EventPaymentRow, now: number): void {
  db.prepare(
    `INSERT INTO event_payment_reminders (group_id, event_id, player_id, last_sent_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, event_id, player_id)
     DO UPDATE SET last_sent_at = excluded.last_sent_at`,
  ).run(row.groupId, row.eventId, row.playerId, now);
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/**
 * Reminds each accepted participant about an unpaid event contribution after
 * two hours and then at most once per rolling two-hour window. Durable state
 * keeps this cadence intact across restarts and bounded push-history cleanup.
 */
export function runEventPaymentReminderOnce(now = Date.now()): number {
  let sent = 0;
  for (const row of eligiblePayments(now)) {
    if (wasSentRecently(row, now)) continue;
    const delivery = notifyPlayers(
      [row.playerId],
      {
        title: 'Offener Event-Beitrag',
        body: `Für „${row.eventName}“ sind noch ${formatEuro(row.costCents)} offen. Bitte bezahle deinen Beitrag.`,
        url: '/#events',
        type: 'event-payment',
        targetId: row.eventId,
      },
      'direct',
      { key: topicKey(row), expiresAt: now + EVENT_PAYMENT_REMINDER_INTERVAL_MS },
      { groupId: row.groupId, eventId: row.eventId },
    );
    if (delivery) {
      recordSent(row, now);
      sent += 1;
    }
  }
  return sent;
}

export function startEventPaymentReminder(): NodeJS.Timeout {
  const run = () => {
    try {
      runEventPaymentReminderOnce();
    } catch (error) {
      // A reminder failure must not take down the LAN server. The next
      // scheduled run gets another chance while the error stays visible.
      // eslint-disable-next-line no-console
      console.error('Event payment reminder failed:', error);
    }
  };

  run();
  const timer = setInterval(run, EVENT_PAYMENT_REMINDER_INTERVAL_MS);
  timer.unref();
  return timer;
}
