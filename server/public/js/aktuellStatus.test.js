import test from 'node:test';
import assert from 'node:assert/strict';

import { activeEventPeriodOver, aktuellItems, foodOrderAktuellItem, missingSkillAktuellId } from './aktuellStatus.js';
import { state } from './state.js';

test('a later live occurrence yields a new missing-skill lifecycle id', () => {
  const firstLiveOccurrence = [
    { games: [{ game_id: 'cs2', since: 1_000 }] },
    { games: [{ game_id: 'cs2', since: 1_200 }] },
  ];
  const laterLiveOccurrence = [{ games: [{ game_id: 'cs2', since: 5_000 }] }];

  // The id names the earliest live start so a genuinely new play session gets
  // a distinct id and reappears as its own entry.
  assert.equal(missingSkillAktuellId('cs2', firstLiveOccurrence), 'skill:cs2:1000');
  assert.equal(missingSkillAktuellId('cs2', laterLiveOccurrence), 'skill:cs2:5000');
  assert.equal(missingSkillAktuellId('cs2', []), null);
});

test('only an open order is current; paying a closed one is a personal To-Do instead', () => {
  const item = foodOrderAktuellItem({ id: 'order-2', title: 'Drinks', open: true, sendAt: 123, items: [] });
  assert.equal(item.id, 'food-order:order-2');
  assert.equal(item.title, 'Sammelbestellung „Drinks"');
  assert.match(item.sub, /Versand/);
  assert.equal(
    foodOrderAktuellItem({ id: 'order-1', title: 'Pizza', open: false, closedAt: 1_000, items: [{ playerId: 'alice', paid: false }] }),
    null,
  );
});

test('invitations no longer appear in Aktuell; Meine To-Dos answers them', () => {
  const previousInvitations = state.eventInvitations;
  state.eventInvitations = [{ id: 'event-1', name: 'Winter LAN' }];
  try {
    assert.equal(aktuellItems().some((item) => item.id.startsWith('event-invitation:')), false);
  } finally {
    state.eventInvitations = previousInvitations;
  }
});

test('votes and tournaments of an event whose period is over are no longer current', () => {
  const previous = { activeEvent: state.activeEvent, votes: state.votes };
  state.votes = { openRounds: [{ round: 7, title: 'Was jetzt?', totalVoters: 2 }] };
  try {
    state.activeEvent = { id: 'lan', endsAt: 10_000 };
    assert.deepEqual(aktuellItems(9_999).map((item) => item.id), ['vote:7']);
    assert.deepEqual(aktuellItems(10_000), []);
    // The permanent base workspace has no end.
    state.activeEvent = { id: 'base', endsAt: null };
    assert.equal(activeEventPeriodOver(state.activeEvent, Number.MAX_SAFE_INTEGER), false);
    assert.equal(activeEventPeriodOver({ id: 'done', endsAt: null, isEnded: true }), true);
  } finally {
    Object.assign(state, previous);
  }
});
