import test from 'node:test';
import assert from 'node:assert/strict';

import { myTodoRow, myTodoRows } from './myTodos.js';

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
