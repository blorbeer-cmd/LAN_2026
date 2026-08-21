import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerInviteEventOptions } from './views/admin.js';
import { state } from './state.js';

test('register invite event options omit cancelled, ended and base events', () => {
  const previous = state.managedEvents;
  state.managedEvents = [
    { id: 'cancelled', name: 'Abgesagt', startsAt: 3, status: 'cancelled' },
    { id: 'ended', name: 'Beendet', startsAt: 2, status: 'ended', isEnded: true },
    { id: 'idle', name: 'Offen', startsAt: 1, status: 'published' },
    { id: 'base', name: 'Allgemein', startsAt: 4, status: 'published', isBase: true },
  ];
  try {
    assert.deepEqual(
      registerInviteEventOptions().map((option) => option.value),
      ['', 'idle'],
    );
  } finally {
    state.managedEvents = previous;
  }
});
