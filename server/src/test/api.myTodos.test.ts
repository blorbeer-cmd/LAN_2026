// Integration tests for GET /api/me/todos (Home's "Meine To-Dos"): which
// personal obligations and which left-behind workflows each account sees,
// and that finishing one through its normal route removes it again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { nanoid } from 'nanoid';
import { createTestApp } from './testApp';
import { DEFAULT_GROUP_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { EVENT_FEATURE_KEYS } from '../eventFeatureCatalog';

const app = createTestApp();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Todo {
  id: string;
  kind: string;
  audience: string;
  eventId: string;
  overdue: boolean;
  [key: string]: unknown;
}

function createPlayer(name: string): string {
  const id = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(id, name, nanoid(), Date.now());
  ensureDefaultGroupMembership(id);
  return id;
}

function createEvent(
  name: string,
  { startsAt, endsAt, participants, createdBy = null, costCents = null, paymentDueAt = null }: {
    startsAt: number;
    endsAt: number;
    participants: string[];
    createdBy?: string | null;
    costCents?: number | null;
    paymentDueAt?: number | null;
  },
): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, group_id, status, visibility_scope, schedule_revision, created_by,
        cost_cents, payment_due_at, paypal_link)
     VALUES (?, ?, ?, ?, ?, 'published', 'participants', 1, ?, ?, ?, ?)`,
  ).run(id, name, startsAt, endsAt, DEFAULT_GROUP_ID, createdBy, costCents, paymentDueAt, costCents ? 'https://paypal.me/orga' : null);
  for (const playerId of participants) {
    db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(id, playerId);
  }
  return id;
}

async function todosOf(playerId: string): Promise<Todo[]> {
  const res = await request(app).get('/api/me/todos').set('x-test-player-id', playerId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.todos;
}

const kinds = (todos: Todo[]) => todos.map((todo) => todo.kind).sort();

test('personal obligations across events, in urgency order, and gone once done', async () => {
  const now = Date.now();
  const mia = createPlayer('Todo Mia');
  const event = createEvent('Todo LAN', {
    startsAt: now + 3 * DAY,
    endsAt: now + 4 * DAY,
    participants: [mia],
    costCents: 2500,
    paymentDueAt: now - DAY,
  });
  const orderId = nanoid();
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at, paypal_link)
     VALUES (?, ?, 'Pizza', ?, ?, ?, 'https://paypal.me/pizza')`,
  ).run(orderId, event, mia, now - 2 * HOUR, now - HOUR);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, price_cents, created_at)
     VALUES (?, ?, ?, 'Margherita', 2, 900, ?)`,
  ).run(nanoid(), orderId, mia, now - 2 * HOUR);
  const taskId = nanoid();
  db.prepare(
    `INSERT INTO checklist_tasks (id, group_id, event_id, type, title, created_by, status, created_at, taken_at, due_at)
     VALUES (?, ?, ?, 'todo', 'Steckdosen mitbringen', ?, 'taken', ?, ?, ?)`,
  ).run(taskId, DEFAULT_GROUP_ID, event, mia, now - 3 * DAY, now - 3 * DAY, now - 2 * DAY);
  db.prepare('INSERT INTO checklist_task_assignees (task_id, player_id, joined_at) VALUES (?, ?, ?)').run(taskId, mia, now - 3 * DAY);

  const todos = await todosOf(mia);
  assert.deepEqual(kinds(todos), ['arrival', 'event-calendar', 'event-payment', 'food-payment', 'task']);
  assert.ok(todos.every((todo) => todo.audience === 'personal' && todo.eventId === event));
  // Overdue first: the contribution past its due date and the To-Do past its own.
  assert.deepEqual(todos.slice(0, 2).map((todo) => todo.kind).sort(), ['event-payment', 'task']);
  assert.ok(todos.slice(0, 2).every((todo) => todo.overdue));
  const food = todos.find((todo) => todo.kind === 'food-payment')!;
  assert.equal(food.unpaidCount, 2);
  assert.equal(food.hasPaypal, true);

  // Finishing items through their regular routes removes them.
  assert.equal((await request(app).post(`/api/events/${event}/calendar-confirmation`).set('x-test-player-id', mia)).status, 200);
  db.prepare('UPDATE event_participants SET paid = 1 WHERE event_id = ? AND player_id = ?').run(event, mia);
  db.prepare("UPDATE checklist_tasks SET status = 'done', done_at = ? WHERE id = ?").run(now, taskId);
  db.prepare('INSERT INTO arrivals (event_id, player_id, arrival_at, updated_at) VALUES (?, ?, ?, ?)').run(event, mia, now + 3 * DAY, now);
  assert.deepEqual(kinds(await todosOf(mia)), ['food-payment']);

  // A switched-off area takes its To-Dos with it.
  const insertFeature = db.prepare('INSERT INTO event_features (event_id, feature_key, enabled, changed_at) VALUES (?, ?, ?, ?)');
  for (const key of EVENT_FEATURE_KEYS) insertFeature.run(event, key, key === 'food' ? 0 : 1, now);
  assert.deepEqual(await todosOf(mia), []);
});

test('left-behind workflows reach exactly the people who can close them', async () => {
  const now = Date.now();
  const mia = createPlayer('Orga Mia');
  const max = createPlayer('Orga Max');
  const admin = '__integration-test-admin__';
  const stale = createEvent('Stale LAN', {
    startsAt: now - 3 * DAY,
    endsAt: now - 13 * HOUR,
    participants: [mia, max, admin],
    createdBy: mia,
    costCents: 1000,
    paymentDueAt: now - 2 * DAY,
  });
  const recent = createEvent('Recent LAN', {
    startsAt: now - 2 * DAY,
    endsAt: now - 11 * HOUR,
    participants: [mia, max, admin],
  });
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, send_at)
     VALUES (?, ?, 'Burger', ?, ?, ?)`,
  ).run(nanoid(), recent, max, now - 4 * HOUR, now - 3 * HOUR);
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at, send_at)
     VALUES (?, ?, 'Sushi', ?, ?, ?)`,
  ).run(nanoid(), recent, max, now - 2 * HOUR, now - HOUR);
  db.prepare(
    `INSERT INTO vote_rounds (group_id, round, event_id, started_at, mode, created_by)
     VALUES (?, 9001, ?, ?, 'points', ?)`,
  ).run(DEFAULT_GROUP_ID, recent, now - 4 * HOUR, mia);
  const gameId = (db.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get(DEFAULT_GROUP_ID) as { id: string }).id;
  db.prepare(
    `INSERT INTO tournaments (id, event_id, game_id, name, format, status, created_at, group_id)
     VALUES (?, ?, ?, 'Stale Cup', 'round_robin', 'active', ?, ?)`,
  ).run(nanoid(), recent, gameId, now - DAY, DEFAULT_GROUP_ID);

  const orga = (todos: Todo[]) => kinds(todos.filter((todo) => todo.audience === 'orga'));
  // Ending the event, the tournament and moderating any order and vote is
  // the admins' job; the 11-hour-old event end is still within its grace.
  const adminTodos = await todosOf(admin);
  assert.deepEqual(orga(adminTodos), ['event-end', 'food-order-send', 'tournament-finish', 'vote-close']);
  assert.equal(adminTodos.find((todo) => todo.kind === 'event-end')!.eventId, stale);
  // The order's creator sees only the order left unsent past its time.
  assert.deepEqual(orga(await todosOf(max)), ['food-order-send']);
  // The vote's starter and the event's creator see their own.
  assert.deepEqual(orga(await todosOf(mia)), ['event-contributions', 'vote-close']);

  // The starter may close the round herself once she is in its workspace,
  // which is where the To-Do leads her; afterwards it is gone for everyone.
  assert.equal((await request(app).put('/api/me/active-event').set('x-test-player-id', mia).send({ eventId: recent })).status, 200);
  // Inside that workspace the open round also counts as not yet voted by her.
  const inWorkspace = await request(app).get('/api/me/todos').set('x-test-player-id', mia);
  assert.deepEqual(inWorkspace.body.pendingVoteRounds, [9001]);
  const closed = await request(app).post('/api/votes/close').set('x-test-player-id', mia).send({ round: 9001 });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.deepEqual(orga(await todosOf(mia)), ['event-contributions']);
  assert.equal((await todosOf(admin)).some((todo) => todo.kind === 'vote-close'), false);
});
