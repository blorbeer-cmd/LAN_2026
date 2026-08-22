import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REGISTER_INVITE_DURATION_MS,
  formatInviteRemaining,
  inviteValidityLabel,
  registerInviteEventOptions,
  REGISTER_INVITE_DURATION_OPTIONS,
} from './views/admin.js';
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

test('registration links offer only finite validity choices', () => {
  assert.equal(REGISTER_INVITE_DURATION_OPTIONS.some((option) => /unbegrenzt/i.test(option.label)), false);
  assert.ok(REGISTER_INVITE_DURATION_OPTIONS.every((option) => option.value > 0));
  assert.equal(DEFAULT_REGISTER_INVITE_DURATION_MS, 7 * 24 * 60 * 60 * 1000);
});

test('registration link validity is shown as remaining time and expiry date', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0);
  assert.equal(formatInviteRemaining(now + 45 * 60 * 1000, now), 'noch 45 Minuten gültig');
  assert.equal(formatInviteRemaining(now + 2 * 24 * 60 * 60 * 1000, now), 'noch 2 Tage gültig');
  assert.match(inviteValidityLabel(now + 60 * 60 * 1000, now), /^noch 1 Stunde gültig · bis /);
  assert.equal(inviteValidityLabel(null, now), 'Gültig bis zum Widerruf');
});
