// "Meine To-Dos" on Home: everything the signed-in account still has to do,
// across every open event of the group, in one read. Two audiences:
//
// - personal: obligations of this account (pay, add the date to the
//   calendar, finish a taken To-Do, enter the arrival).
// - orga: workflows that only this account can unblock because it started
//   them or moderates the group, and that have been left open too long
//   ("liegengeblieben").
//
// The payment and calendar items follow the same eligibility as the push
// reminders in foodOrderReminders.ts, eventPaymentReminders.ts and
// eventReminders.ts, minus their delivery delay: a reminder is a delayed
// nudge, the To-Do is the open obligation itself. Event invitations and
// skill ratings are not part of this payload; the client already holds
// both (state.eventInvitations, the digest) and renders them alongside.
//
// The payload carries data, not copy: the client formats dates locally and
// owns the German wording, like Home's "Aktuell" list.

import { BASE_EVENT_ID, OUTSIDE_EVENTS_ID, SCHEDULE_KEY_SQL, db } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';
import { isEventFeatureEnabled } from './eventFeatures';
import type { EventFeatureKey } from './eventFeatureCatalog';
import { STEFAN_CALENDAR_GAG_USERNAME } from './eventReminders';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// When an open workflow counts as left behind. Product decision (see
// docs/product/navigation-and-account-rules.md, "Meine To-Dos").
export const STALE_FOOD_ORDER_AFTER_SEND_AT_MS = 2 * HOUR_MS;
export const STALE_FOOD_ORDER_WITHOUT_SEND_AT_MS = 24 * HOUR_MS;
export const STALE_FOOD_ORDER_SETTLEMENT_MS = 24 * HOUR_MS;
export const STALE_EVENT_AFTER_END_MS = 12 * HOUR_MS;
export const STALE_VOTE_ROUND_MS = 3 * HOUR_MS;
// Arrival times only matter once the event is close; a LAN months ahead
// should not open with a To-Do nobody can answer yet.
export const ARRIVAL_TODO_LEAD_MS = 14 * DAY_MS;

export type MyTodoAudience = 'personal' | 'orga';

interface MyTodoBase {
  id: string;
  kind: string;
  audience: MyTodoAudience;
  eventId: string;
  eventName: string;
  // Overdue entries sort first (oldest first); the rest by sortAt ascending.
  overdue: boolean;
  sortAt: number | null;
}

export type MyTodo = MyTodoBase & Record<string, unknown>;

export interface MyTodosResult {
  todos: MyTodo[];
  // Open Vote rounds of the active workspace without a ballot of this
  // account, for "Aktuell"'s "Du hast noch nicht abgestimmt".
  pendingVoteRounds: number[];
}

export interface MyTodosContext {
  groupId: string;
  playerId: string;
  role: string | undefined;
  activeEventId: string | null;
  includeTestEvents: boolean;
  now?: number;
}

interface EventRef {
  eventId: string;
  eventName: string;
}

// Accepted participation is the workspace access contract (see
// groupEventScope.ts): only those events' operational data is visible.
function workspaceEventsSql(includeTestEvents: boolean): string {
  return `SELECT e.id FROM events e
          JOIN event_participants ep ON ep.event_id = e.id AND ep.player_id = @playerId
          WHERE e.group_id = @groupId AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
            AND e.status IN ('published', 'draft') AND e.ended_at IS NULL
            AND e.id != '${OUTSIDE_EVENTS_ID}'
            ${includeTestEvents ? '' : 'AND e.is_test = 0'}`;
}

function featureFilter<T extends EventRef>(rows: T[], feature: EventFeatureKey): T[] {
  const cache = new Map<string, boolean>();
  return rows.filter((row) => {
    if (!cache.has(row.eventId)) cache.set(row.eventId, isEventFeatureEnabled(row.eventId, feature));
    return cache.get(row.eventId);
  });
}

const isModerator = (role: string | undefined) => role === 'owner' || role === 'admin';

function foodPayments(ctx: Required<MyTodosContext>): MyTodo[] {
  const rows = db
    .prepare(
      `SELECT fo.id AS orderId, fo.title AS orderTitle, fo.paypal_link AS paypalLink, fo.closed_at AS closedAt,
              e.id AS eventId, e.name AS eventName
       FROM food_orders fo
       JOIN events e ON e.id = fo.event_id
       WHERE fo.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND fo.closed_at IS NOT NULL AND fo.finalized_at IS NULL
         AND EXISTS (SELECT 1 FROM food_order_items i WHERE i.order_id = fo.id AND i.player_id = @playerId AND i.paid = 0)
       ORDER BY fo.closed_at`,
    )
    .all({ groupId: ctx.groupId, playerId: ctx.playerId }) as Array<
    EventRef & { orderId: string; orderTitle: string; paypalLink: string | null; closedAt: number }
  >;
  const items = db.prepare(
    'SELECT id, paid, quantity FROM food_order_items WHERE order_id = ? AND player_id = ? ORDER BY created_at',
  );
  return featureFilter(rows, 'food').map((row) => {
    const own = items.all(row.orderId, ctx.playerId) as Array<{ id: string; paid: number; quantity: number }>;
    return {
      id: `food-payment:${row.orderId}`,
      kind: 'food-payment',
      audience: 'personal',
      eventId: row.eventId,
      eventName: row.eventName,
      overdue: false,
      sortAt: row.closedAt,
      orderId: row.orderId,
      orderTitle: row.orderTitle,
      hasPaypal: Boolean(row.paypalLink),
      paypalLink: row.paypalLink,
      unpaidCount: own.filter((item) => !item.paid).reduce((sum, item) => sum + item.quantity, 0),
      items: own.map((item) => ({ id: item.id, playerId: ctx.playerId, paid: Boolean(item.paid) })),
    };
  });
}

// Event-level obligations need no workspace access: they are answered on the
// event itself (/api/events/:id/...), which a published event allows from
// any workspace.
function acceptedPublishedEventsSql(includeTestEvents: boolean): string {
  return `FROM events e
          JOIN event_participants ep ON ep.event_id = e.id AND ep.player_id = @playerId
          WHERE e.group_id = @groupId AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
            AND e.status = 'published' AND e.ended_at IS NULL
            AND e.id NOT IN ('${BASE_EVENT_ID}', '${OUTSIDE_EVENTS_ID}')
            ${includeTestEvents ? '' : 'AND e.is_test = 0'}`;
}

function eventPayments(ctx: Required<MyTodosContext>): MyTodo[] {
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, e.cost_cents AS costCents,
              e.payment_due_at AS paymentDueAt, e.paypal_link AS paypalLink, e.starts_at AS startsAt
       ${acceptedPublishedEventsSql(ctx.includeTestEvents)}
         AND e.cost_cents IS NOT NULL AND ep.paid = 0
       ORDER BY COALESCE(e.payment_due_at, e.starts_at)`,
    )
    .all({ groupId: ctx.groupId, playerId: ctx.playerId }) as Array<
    EventRef & { costCents: number; paymentDueAt: number | null; paypalLink: string | null; startsAt: number | null }
  >;
  return featureFilter(rows, 'costs').map((row) => ({
    id: `event-payment:${row.eventId}`,
    kind: 'event-payment',
    audience: 'personal',
    eventId: row.eventId,
    eventName: row.eventName,
    overdue: row.paymentDueAt !== null && row.paymentDueAt <= ctx.now,
    sortAt: row.paymentDueAt ?? row.startsAt,
    costCents: row.costCents,
    paymentDueAt: row.paymentDueAt,
    hasPaypal: Boolean(row.paypalLink),
  }));
}

function calendarEntries(ctx: Required<MyTodosContext>): MyTodo[] {
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, e.starts_at AS startsAt, e.ends_at AS endsAt,
              e.location, e.description
       ${acceptedPublishedEventsSql(ctx.includeTestEvents)}
         AND e.starts_at IS NOT NULL AND e.ends_at IS NOT NULL AND e.starts_at > @now
         AND NOT EXISTS (
           SELECT 1 FROM event_calendar_confirmations confirmation
           WHERE confirmation.event_id = e.id AND confirmation.player_id = ep.player_id
             AND confirmation.schedule_key = ${SCHEDULE_KEY_SQL}
         )
       ORDER BY e.starts_at`,
    )
    .all({ groupId: ctx.groupId, playerId: ctx.playerId, now: ctx.now }) as Array<
    EventRef & { startsAt: number; endsAt: number; location: string | null; description: string | null }
  >;
  if (rows.length === 0) return [];
  const playerName = (db.prepare('SELECT name FROM players WHERE id = ?').get(ctx.playerId) as { name: string } | undefined)?.name;
  return rows.map((row) => ({
    id: `event-calendar:${row.eventId}`,
    kind: 'event-calendar',
    audience: 'personal',
    eventId: row.eventId,
    eventName: row.eventName,
    overdue: false,
    sortAt: row.startsAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    location: row.location,
    description: row.description,
    needsExtraCheck: playerName === STEFAN_CALENDAR_GAG_USERNAME,
  }));
}

function arrivals(ctx: Required<MyTodosContext>): MyTodo[] {
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, e.starts_at AS startsAt
       ${acceptedPublishedEventsSql(ctx.includeTestEvents)}
         AND e.starts_at IS NOT NULL AND e.starts_at > @now AND e.starts_at - @now <= @lead
         AND NOT EXISTS (
           SELECT 1 FROM arrivals a WHERE a.event_id = e.id AND a.player_id = ep.player_id AND a.arrival_at IS NOT NULL
         )
       ORDER BY e.starts_at`,
    )
    .all({ groupId: ctx.groupId, playerId: ctx.playerId, now: ctx.now, lead: ARRIVAL_TODO_LEAD_MS }) as Array<
    EventRef & { startsAt: number }
  >;
  return featureFilter(rows, 'travel').map((row) => ({
    id: `arrival:${row.eventId}`,
    kind: 'arrival',
    audience: 'personal',
    eventId: row.eventId,
    eventName: row.eventName,
    overdue: false,
    sortAt: row.startsAt,
    startsAt: row.startsAt,
  }));
}

// A To-Do's due date is a whole day (stored as its local midnight, see the
// date-only DateTimeField): it is only overdue once that day is over, like
// the "Überfällig" of checklistDue.js.
function dueDayPassed(dueAt: number | null, now: number): boolean {
  return dueAt !== null && dueAt + DAY_MS <= now;
}

// Taken To-Dos of this account (personal) and To-Dos it created that nobody
// took before their due date passed (orga). Both only exist in a workspace.
function tasks(ctx: Required<MyTodosContext>): MyTodo[] {
  const params = { groupId: ctx.groupId, playerId: ctx.playerId, dueBefore: ctx.now - DAY_MS };
  const taken = db
    .prepare(
      `SELECT t.id AS taskId, t.title, t.type AS taskType, t.due_at AS dueAt, e.id AS eventId, e.name AS eventName
       FROM checklist_tasks t
       JOIN events e ON e.id = t.event_id
       JOIN checklist_task_assignees a ON a.task_id = t.id AND a.player_id = @playerId
       WHERE t.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND t.status = 'taken' AND t.archived_at IS NULL`,
    )
    .all(params) as Array<EventRef & { taskId: string; title: string; taskType: string; dueAt: number | null }>;
  const unclaimed = db
    .prepare(
      `SELECT t.id AS taskId, t.title, t.type AS taskType, t.due_at AS dueAt, e.id AS eventId, e.name AS eventName
       FROM checklist_tasks t
       JOIN events e ON e.id = t.event_id
       WHERE t.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND t.status = 'open' AND t.archived_at IS NULL AND t.created_by = @playerId
         AND t.due_at IS NOT NULL AND t.due_at <= @dueBefore`,
    )
    .all(params) as Array<EventRef & { taskId: string; title: string; taskType: string; dueAt: number }>;
  return [
    ...featureFilter(taken, 'tasks').map((row) => ({
      id: `task:${row.taskId}`,
      kind: 'task',
      audience: 'personal' as const,
      eventId: row.eventId,
      eventName: row.eventName,
      overdue: dueDayPassed(row.dueAt, ctx.now),
      sortAt: row.dueAt,
      taskId: row.taskId,
      title: row.title,
      taskType: row.taskType,
      dueAt: row.dueAt,
    })),
    ...featureFilter(unclaimed, 'tasks').map((row) => ({
      id: `task-unclaimed:${row.taskId}`,
      kind: 'task-unclaimed',
      audience: 'orga' as const,
      eventId: row.eventId,
      eventName: row.eventName,
      overdue: true,
      sortAt: row.dueAt,
      taskId: row.taskId,
      title: row.title,
      taskType: row.taskType,
      dueAt: row.dueAt,
    })),
  ];
}

function staleEvents(ctx: Required<MyTodosContext>): MyTodo[] {
  if (!isModerator(ctx.role)) return [];
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, e.ends_at AS endsAt
       FROM events e
       WHERE e.group_id = @groupId AND e.status = 'published' AND e.ended_at IS NULL
         AND e.id NOT IN ('${BASE_EVENT_ID}', '${OUTSIDE_EVENTS_ID}')
         AND e.ends_at IS NOT NULL AND e.ends_at + @grace <= @now
         ${ctx.includeTestEvents ? '' : 'AND e.is_test = 0'}
       ORDER BY e.ends_at`,
    )
    .all({ groupId: ctx.groupId, now: ctx.now, grace: STALE_EVENT_AFTER_END_MS }) as Array<EventRef & { endsAt: number }>;
  return rows.map((row) => ({
    id: `event-end:${row.eventId}`,
    kind: 'event-end',
    audience: 'orga',
    eventId: row.eventId,
    eventName: row.eventName,
    overdue: true,
    sortAt: row.endsAt + STALE_EVENT_AFTER_END_MS,
    endsAt: row.endsAt,
  }));
}

// Mirrors routes/events.ts's canManageEventPayments: the creator, or the
// group owner once the creator is no longer an active member.
function openContributions(ctx: Required<MyTodosContext>): MyTodo[] {
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.name AS eventName, e.payment_due_at AS paymentDueAt, e.cost_cents AS costCents,
              (SELECT COUNT(*) FROM event_participants ep JOIN players p ON p.id = ep.player_id
               WHERE ep.event_id = e.id AND ${ACCEPTED_EVENT_PARTICIPANT_SQL} AND ep.paid = 0
                 AND p.deactivated_at IS NULL) AS unpaidCount
       FROM events e
       WHERE e.group_id = @groupId AND e.status = 'published' AND e.ended_at IS NULL
         AND e.cost_cents IS NOT NULL AND e.payment_due_at IS NOT NULL AND e.payment_due_at <= @now
         AND (
           e.created_by = @playerId
           OR (@role = 'owner' AND (e.created_by IS NULL OR NOT EXISTS (
             SELECT 1 FROM players creator
             JOIN group_memberships gm ON gm.player_id = creator.id
             WHERE creator.id = e.created_by AND creator.deactivated_at IS NULL
               AND gm.group_id = e.group_id AND gm.status = 'active'
           )))
         )
         ${ctx.includeTestEvents ? '' : 'AND e.is_test = 0'}
       ORDER BY e.payment_due_at`,
    )
    .all({ groupId: ctx.groupId, playerId: ctx.playerId, role: ctx.role ?? '', now: ctx.now }) as Array<
    EventRef & { paymentDueAt: number; costCents: number; unpaidCount: number }
  >;
  return featureFilter(rows, 'costs')
    .filter((row) => row.unpaidCount > 0)
    .map((row) => ({
      id: `event-contributions:${row.eventId}`,
      kind: 'event-contributions',
      audience: 'orga',
      eventId: row.eventId,
      eventName: row.eventName,
      overdue: true,
      sortAt: row.paymentDueAt,
      paymentDueAt: row.paymentDueAt,
      unpaidCount: row.unpaidCount,
    }));
}

// Food-order moderation mirrors routes/foodOrders.ts: the creator or a group
// admin (players.is_admin follows the admin/owner role).
function staleFoodOrders(ctx: Required<MyTodosContext>): MyTodo[] {
  const params = {
    groupId: ctx.groupId,
    playerId: ctx.playerId,
    now: ctx.now,
    moderator: isModerator(ctx.role) ? 1 : 0,
    afterSendAt: STALE_FOOD_ORDER_AFTER_SEND_AT_MS,
    withoutSendAt: STALE_FOOD_ORDER_WITHOUT_SEND_AT_MS,
    settlement: STALE_FOOD_ORDER_SETTLEMENT_MS,
  };
  const unsent = db
    .prepare(
      `SELECT fo.id AS orderId, fo.title AS orderTitle, fo.send_at AS sendAt, fo.created_at AS createdAt,
              e.id AS eventId, e.name AS eventName
       FROM food_orders fo JOIN events e ON e.id = fo.event_id
       WHERE fo.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND (fo.created_by = @playerId OR @moderator = 1)
         AND fo.closed_at IS NULL
         AND (
           (fo.send_at IS NOT NULL AND fo.send_at + @afterSendAt <= @now)
           OR (fo.send_at IS NULL AND fo.created_at + @withoutSendAt <= @now)
         )
       ORDER BY COALESCE(fo.send_at, fo.created_at)`,
    )
    .all(params) as Array<EventRef & { orderId: string; orderTitle: string; sendAt: number | null; createdAt: number }>;
  const unsettled = db
    .prepare(
      `SELECT fo.id AS orderId, fo.title AS orderTitle, fo.closed_at AS closedAt, e.id AS eventId, e.name AS eventName,
              (SELECT COUNT(DISTINCT i.player_id) FROM food_order_items i WHERE i.order_id = fo.id AND i.paid = 0) AS unpaidPeople
       FROM food_orders fo JOIN events e ON e.id = fo.event_id
       WHERE fo.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND (fo.created_by = @playerId OR @moderator = 1)
         AND fo.closed_at IS NOT NULL AND fo.finalized_at IS NULL AND fo.closed_at + @settlement <= @now
         AND EXISTS (SELECT 1 FROM food_order_items i WHERE i.order_id = fo.id AND i.paid = 0)
       ORDER BY fo.closed_at`,
    )
    .all(params) as Array<EventRef & { orderId: string; orderTitle: string; closedAt: number; unpaidPeople: number }>;
  return [
    ...featureFilter(unsent, 'food').map((row) => ({
      id: `food-order-send:${row.orderId}`,
      kind: 'food-order-send',
      audience: 'orga' as const,
      eventId: row.eventId,
      eventName: row.eventName,
      overdue: true,
      sortAt: row.sendAt !== null ? row.sendAt + STALE_FOOD_ORDER_AFTER_SEND_AT_MS : row.createdAt + STALE_FOOD_ORDER_WITHOUT_SEND_AT_MS,
      orderId: row.orderId,
      orderTitle: row.orderTitle,
      sendAt: row.sendAt,
      createdAt: row.createdAt,
    })),
    ...featureFilter(unsettled, 'food').map((row) => ({
      id: `food-order-settle:${row.orderId}`,
      kind: 'food-order-settle',
      audience: 'orga' as const,
      eventId: row.eventId,
      eventName: row.eventName,
      overdue: true,
      sortAt: row.closedAt + STALE_FOOD_ORDER_SETTLEMENT_MS,
      orderId: row.orderId,
      orderTitle: row.orderTitle,
      closedAt: row.closedAt,
      unpaidPeople: row.unpaidPeople,
    })),
  ];
}

// Vote rounds have no deadline of their own. A round counts as left open
// after STALE_VOTE_ROUND_MS or once its event's period is over. Only the
// people routes/votes.ts's close accepts get the entry.
function staleVoteRounds(ctx: Required<MyTodosContext>): MyTodo[] {
  const rows = db
    .prepare(
      `SELECT vr.round, vr.title, vr.started_at AS startedAt, e.ends_at AS endsAt, e.id AS eventId, e.name AS eventName
       FROM vote_rounds vr JOIN events e ON e.id = vr.event_id
       WHERE vr.group_id = @groupId AND vr.closed_at IS NULL
         AND vr.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND (@moderator = 1 OR vr.created_by = @playerId)
         AND (vr.started_at + @stale <= @now OR (e.ends_at IS NOT NULL AND e.ends_at <= @now))
       ORDER BY vr.started_at`,
    )
    .all({
      groupId: ctx.groupId,
      playerId: ctx.playerId,
      now: ctx.now,
      stale: STALE_VOTE_ROUND_MS,
      moderator: isModerator(ctx.role) ? 1 : 0,
    }) as Array<EventRef & { round: number; title: string | null; startedAt: number; endsAt: number | null }>;
  return featureFilter(rows, 'games').map((row) => ({
    id: `vote-close:${row.round}`,
    kind: 'vote-close',
    audience: 'orga',
    eventId: row.eventId,
    eventName: row.eventName,
    overdue: true,
    sortAt: Math.min(row.startedAt + STALE_VOTE_ROUND_MS, row.endsAt ?? Number.POSITIVE_INFINITY),
    round: row.round,
    title: row.title,
    startedAt: row.startedAt,
  }));
}

function staleTournaments(ctx: Required<MyTodosContext>): MyTodo[] {
  if (!isModerator(ctx.role)) return [];
  const rows = db
    .prepare(
      `SELECT t.id AS tournamentId, t.name, e.ends_at AS endsAt, e.id AS eventId, e.name AS eventName
       FROM tournaments t JOIN events e ON e.id = t.event_id
       WHERE t.group_id = @groupId AND t.status = 'active'
         AND t.event_id IN (${workspaceEventsSql(ctx.includeTestEvents)})
         AND e.ends_at IS NOT NULL AND e.ends_at <= @now
       ORDER BY e.ends_at, t.created_at`,
    )
    .all({ groupId: ctx.groupId, playerId: ctx.playerId, now: ctx.now }) as Array<
    EventRef & { tournamentId: string; name: string; endsAt: number }
  >;
  return featureFilter(rows, 'competition').map((row) => ({
    id: `tournament-finish:${row.tournamentId}`,
    kind: 'tournament-finish',
    audience: 'orga',
    eventId: row.eventId,
    eventName: row.eventName,
    overdue: true,
    sortAt: row.endsAt,
    tournamentId: row.tournamentId,
    name: row.name,
  }));
}

function pendingVoteRounds(ctx: Required<MyTodosContext>): number[] {
  if (!ctx.activeEventId) return [];
  return (
    db
      .prepare(
        `SELECT vr.round FROM vote_rounds vr
         WHERE vr.group_id = ? AND vr.event_id = ? AND vr.closed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.group_id = vr.group_id AND v.round = vr.round AND v.player_id = ?)
         ORDER BY vr.round`,
      )
      .all(ctx.groupId, ctx.activeEventId, ctx.playerId) as Array<{ round: number }>
  ).map((row) => row.round);
}

export function compareMyTodos(a: MyTodo, b: MyTodo): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.sortAt !== b.sortAt) {
    if (a.sortAt === null) return 1;
    if (b.sortAt === null) return -1;
    return a.sortAt - b.sortAt;
  }
  return a.id.localeCompare(b.id);
}

export function buildMyTodos(context: MyTodosContext): MyTodosResult {
  const ctx: Required<MyTodosContext> = { ...context, now: context.now ?? Date.now() };
  const todos = [
    ...foodPayments(ctx),
    ...eventPayments(ctx),
    ...calendarEntries(ctx),
    ...arrivals(ctx),
    ...tasks(ctx),
    ...staleEvents(ctx),
    ...openContributions(ctx),
    ...staleFoodOrders(ctx),
    ...staleVoteRounds(ctx),
    ...staleTournaments(ctx),
  ].sort(compareMyTodos);
  return { todos, pendingVoteRounds: pendingVoteRounds(ctx) };
}
