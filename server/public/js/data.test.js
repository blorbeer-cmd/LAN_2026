import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDataLoad, isCurrentDataLoad, normalizeEventContext } from './data.js';

test('only the newest data load may commit its result', () => {
  const first = beginDataLoad();
  const second = beginDataLoad();

  assert.equal(isCurrentDataLoad(first), false);
  assert.equal(isCurrentDataLoad(second), true);
});

test('event context keeps the personal workspace separate from invitations', () => {
  const base = { id: 'base', name: 'Allgemein' };
  const lan = { id: 'lan', name: 'Sommer-LAN' };
  const invitation = { id: 'winter', name: 'Winter-LAN', participantStatus: 'invited' };

  assert.deepEqual(
    normalizeEventContext({
      activeEvent: lan,
      availableEvents: [base, lan],
      invitations: [invitation],
    }),
    {
      events: [base, lan],
      managedEvents: null,
      activeEvent: lan,
      availableEvents: [base, lan],
      eventInvitations: [invitation],
    },
  );
});

test('a member without management rights is distinguishable from an admin without events', () => {
  const available = [{ id: 'base', name: 'Allgemein' }];

  // Settings renders the management grid only for an admin. `null` says "no
  // rights", `[]` says "admin, nothing created yet" — an empty list alone
  // could not tell those apart, and a member would get admin cards fed with
  // summary data they never receive.
  assert.equal(normalizeEventContext({ availableEvents: available }).managedEvents, null);
  assert.deepEqual(normalizeEventContext({ availableEvents: available, managedEvents: [] }).managedEvents, []);
});

test('administrative event catalog does not replace the personal available-event list', () => {
  const available = [{ id: 'base', name: 'Allgemein' }];
  const managed = [...available, { id: 'private', name: 'Fremdes Event' }];

  const result = normalizeEventContext({ availableEvents: available, managedEvents: managed });

  assert.deepEqual(result.events, managed);
  assert.deepEqual(result.availableEvents, available);
  assert.equal(result.activeEvent, null);
});

test('an explicitly empty administrative catalog stays empty', () => {
  const available = [{ id: 'base', name: 'Allgemein' }];

  const result = normalizeEventContext({ availableEvents: available, managedEvents: [] });

  assert.deepEqual(result.events, []);
  assert.deepEqual(result.availableEvents, available);
});
