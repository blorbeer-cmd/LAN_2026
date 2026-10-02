import test from 'node:test';
import assert from 'node:assert/strict';

import { api } from './api.js';
import { ensureMyTodosLoaded, MY_TODOS_RETRY_AFTER_FAILURE_MS, myTodoRow, myTodoRows } from './myTodos.js';

const NOW = Date.UTC(2026, 9, 2, 12);

test('event-level actions run from any workspace, workspace data only inside its own event', () => {
  const payment = { id: 'event-payment:lan', kind: 'event-payment', eventId: 'lan', eventName: 'Winter LAN', costCents: 2500, paymentDueAt: null, overdue: false };
  const food = { id: 'food-payment:o1', kind: 'food-payment', eventId: 'lan', eventName: 'Winter LAN', orderTitle: 'Pizza', orderId: 'o1', unpaidCount: 2, overdue: false };

  const paymentElsewhere = myTodoRow(payment, { activeEventId: 'group', now: NOW });
  assert.equal(paymentElsewhere.inline, true);
  assert.equal(paymentElsewhere.switchesEvent, false);
  assert.equal(paymentElsewhere.title, 'Beitrag für „Winter LAN“ bezahlen');

  const foodHere = myTodoRow(food, { activeEventId: 'lan', now: NOW });
  assert.equal(foodHere.inline, true);
  assert.equal(foodHere.sub, '2 Positionen offen');
  const foodElsewhere = myTodoRow(food, { activeEventId: 'group', now: NOW });
  assert.equal(foodElsewhere.inline, false);
  assert.equal(foodElsewhere.switchesEvent, true);
  // A row from another workspace names its event.
  assert.equal(foodElsewhere.sub, '2 Positionen offen · Winter LAN');
});

test('an overdue entry says so in text, not only by its position', () => {
  const row = myTodoRow(
    { id: 'event-payment:lan', kind: 'event-payment', eventId: 'lan', eventName: 'LAN', costCents: 1000, paymentDueAt: NOW - 1, overdue: true },
    { activeEventId: 'lan', now: NOW },
  );
  assert.match(row.sub, /^Überfällig · /);
});

test('invitations lead, overdue server entries and live skill nudges follow, the rest keeps its order', () => {
  const todos = [
    { id: 'event-calendar:a', kind: 'event-calendar', eventId: 'a', eventName: 'A', startsAt: NOW + 1, endsAt: NOW + 2, overdue: false },
    { id: 'event-end:b', kind: 'event-end', eventId: 'b', eventName: 'B', endsAt: NOW - 1, overdue: true },
    { id: 'unknown:c', kind: 'from-a-newer-server', eventId: 'c', overdue: false },
  ];
  const rows = myTodoRows({
    todos,
    invitations: [{ id: 'inv', name: 'Sommer LAN', startsAt: null }],
    skillNudges: [{ id: 'skill:cs2:1', kind: 'skill' }],
    activeEventId: 'a',
    now: NOW,
  });
  assert.deepEqual(rows.map((row) => row.id), ['event-invitation:inv', 'event-end:b', 'skill:cs2:1', 'event-calendar:a']);
  assert.equal(myTodoRows({ todos: null }), null);
});

test('a failing load neither redraws Home nor retries before its back-off has passed', async () => {
  const previous = { get: api.myTodos.get, window: globalThis.window, document: globalThis.document };
  let requests = 0;
  let fail = true;
  api.myTodos.get = async () => {
    requests += 1;
    if (fail) throw new Error('Service Unavailable');
    return { todos: [], pendingVoteRounds: [] };
  };
  globalThis.document = { getElementById: () => ({ dataset: { view: 'home' } }) };
  globalThis.window = new EventTarget();
  // Home redraws on every change signal, and every redraw asks for the list.
  let redraws = 0;
  window.addEventListener('respawn:my-todos-changed', () => {
    redraws += 1;
    ensureMyTodosLoaded();
  });
  try {
    await ensureMyTodosLoaded();
    assert.equal(requests, 1);
    assert.equal(redraws, 0, 'a failure has nothing new to show');
    assert.equal(ensureMyTodosLoaded(), null, 'renders right after a failure do not retry');
    assert.equal(requests, 1);

    fail = false;
    await ensureMyTodosLoaded(Date.now() + MY_TODOS_RETRY_AFTER_FAILURE_MS);
    assert.equal(requests, 2);
    // The successful load redraws once; that redraw finds a fresh list.
    assert.equal(redraws, 1);
    assert.equal(requests, 2);
  } finally {
    api.myTodos.get = previous.get;
    globalThis.window = previous.window;
    globalThis.document = previous.document;
  }
});
