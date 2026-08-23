// Background jobs for the event date poll (docs/plans/event-date-poll-concept.md):
// automatic reminders (48h-before + due-day) and the optional proactive lazy
// deadline close. Mirrors eventPaymentReminders.ts's interval-timer shape.

import { db, BASE_EVENT_ID } from './db';
import { notifyPlayers } from './push';
import { broadcast, Events } from './realtime';
import { writeAdminAudit } from './adminAudit';
import { dueAutomaticReminders, advanceAutomaticReminder, getDatePolls, materializeExpiredPollIfNeeded } from './eventDatePolls';

export const DATE_POLL_REMINDER_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface EventNameGroupRow {
  name: string;
  group_id: string | null;
}

function eventNameAndGroup(eventId: string): EventNameGroupRow | undefined {
  return db.prepare('SELECT name, group_id FROM events WHERE id = ?').get(eventId) as EventNameGroupRow | undefined;
}

// Sends every automatic reminder whose scheduled instant has passed, then
// proactively materializes any open round whose deadline has already passed
// (a convenience — the lazy check on first read/write would catch it anyway,
// but this keeps rounds visibly closed without waiting on the next request).
export function runEventDatePollReminderSweepOnce(now = Date.now()): { reminded: number; closed: number } {
  let reminded = 0;
  for (const due of dueAutomaticReminders(now)) {
    const event = eventNameAndGroup(due.eventId);
    if (!event?.group_id) continue;
    const delivery = notifyPlayers(
      [due.playerId],
      {
        title: 'Erinnerung: Abstimmung',
        body: `${event.name}: Bitte antworte auf die Abstimmung.`,
        url: `/#eventPolls/${due.pollId}`,
      },
      'direct',
      undefined,
      { groupId: event.group_id, eventId: BASE_EVENT_ID },
    );
    advanceAutomaticReminder(due.pollId, due.playerId, due.stage, now);
    if (delivery) reminded += 1;
  }

  let closed = 0;
  const eventIds = new Set(
    (db.prepare(`SELECT DISTINCT event_id FROM event_date_polls WHERE status = 'open'`).all() as Array<{ event_id: string }>).map(
      (row) => row.event_id,
    ),
  );
  for (const eventId of eventIds) {
    for (const poll of getDatePolls(eventId)) {
      if (poll.status !== 'open') continue;
      const materialized = materializeExpiredPollIfNeeded(poll.id, now);
      if (materialized?.transitioned) {
        closed += 1;
        const event = eventNameAndGroup(eventId);
        writeAdminAudit({
          groupId: event?.group_id ?? undefined,
          action: 'event_date_poll_deadline_closed',
          targetType: 'event_date_poll',
          targetId: poll.id,
          details: { eventId },
        });
        if (event?.group_id) {
          // Deliberately not scoped to `eventId`: a scoped broadcast only
          // reaches a socket whose *current* active workspace is exactly
          // this event, which a draft (or a not-yet-reconfirmed stale
          // participant's own workspace) never is — see routes/events.ts's
          // own eventsChanged calls, none of which scope to eventId either.
          broadcast(Events.eventsChanged, null, { groupId: event.group_id });
        }
      }
    }
  }

  return { reminded, closed };
}

export function startEventDatePollReminderSweep(): NodeJS.Timeout {
  const run = () => {
    try {
      runEventDatePollReminderSweepOnce();
    } catch (error) {
      // A reminder failure must not take down the LAN server.
      // eslint-disable-next-line no-console
      console.error('Event date poll reminder sweep failed:', error);
    }
  };

  run();
  const timer = setInterval(run, DATE_POLL_REMINDER_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
