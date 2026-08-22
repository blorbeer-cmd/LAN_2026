import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedParticipantCount, renderEventLocation } from './views/events.js';

test('event location copy buttons are named for their event', () => {
  const html = renderEventLocation('https://lan.example.test/location', 'Winter LAN');
  assert.match(html, /aria-label="Ort von Winter LAN kopieren"/);
  assert.match(html, /title="Ort von Winter LAN kopieren"/);
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
