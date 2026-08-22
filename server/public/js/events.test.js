import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedParticipantCount, parseEventCostCents, renderEventLocation } from './views/events.js';

test('event locations are clickable only when they contain an HTTP(S) link and never render a copy action', () => {
  const html = renderEventLocation('https://lan.example.test/location', 'Winter LAN');
  assert.match(html, /<a class="event-location-link"/);
  assert.doesNotMatch(html, /Kopieren|data-copy-event-location/);

  const plain = renderEventLocation('Bei Tim');
  assert.match(plain, /<span class="event-location-text">Bei Tim<\/span>/);
  assert.doesNotMatch(plain, /event-location-link/);
});

test('event costs parse German decimal input into positive cents', () => {
  assert.equal(parseEventCostCents('25,50'), 2550);
  assert.equal(parseEventCostCents('25.50 €'), 2550);
  assert.equal(parseEventCostCents(''), null);
  assert.ok(Number.isNaN(parseEventCostCents('0')));
  assert.ok(Number.isNaN(parseEventCostCents('10000,01')));
});

test('accepted participant count follows the visible accepted participant list', () => {
  assert.equal(
    acceptedParticipantCount({
      participantIds: ['active-player', 'deactivated-player'],
      acceptedParticipants: [{ name: 'Active Player' }],
    }),
    1,
  );
});
