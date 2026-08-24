import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedParticipantCount,
  eventDateRange,
  eventPdfExportAvailable,
  eventSettlement,
  parseEventAccommodationCostCents,
  parseEventCostCents,
  renderEventLocation,
} from './views/events.js';

test('the LAN keepsake PDF stays available only for LAN-compatible events', () => {
  assert.equal(eventPdfExportAvailable({ eventType: 'lan' }), true);
  assert.equal(eventPdfExportAvailable({ eventType: 'general' }), false);
  assert.equal(eventPdfExportAvailable({}), true);
});

test('event date ranges keep a regular midnight end on its selected calendar day', () => {
  const startsAt = new Date(2026, 8, 8, 18, 0).getTime();
  const endsAt = new Date(2026, 8, 10, 0, 0).getTime();
  assert.equal(eventDateRange({ startsAt, endsAt }), '8.9.2026 – 10.9.2026');
});

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

test('event accommodation totals allow larger invoices while rejecting invalid values', () => {
  assert.equal(parseEventAccommodationCostCents('1.200,00'), 120000);
  assert.equal(parseEventAccommodationCostCents('1.200'), 120000);
  assert.equal(parseEventAccommodationCostCents(''), null);
  assert.ok(Number.isNaN(parseEventAccommodationCostCents('0')));
  assert.ok(Number.isNaN(parseEventAccommodationCostCents('1.2345')));
  assert.ok(Number.isNaN(parseEventAccommodationCostCents('1.234.567')));
  assert.ok(Number.isNaN(parseEventAccommodationCostCents('100000,01')));
});

test('event settlement compares snapshotted payments with the accommodation invoice', () => {
  assert.deepEqual(
    eventSettlement({
      costCents: 3000,
      accommodationCostCents: 10000,
      acceptedParticipants: [
        { playerId: 'paid-before-price-change', paid: true, paidAmountCents: 2500 },
        { playerId: 'paid-now', paid: true, paidAmountCents: 3000 },
        { playerId: 'open', paid: false },
      ],
    }),
    {
      participantCount: 3,
      paidCount: 2,
      unpaidCount: 1,
      paidCents: 5500,
      missingAmountCount: 0,
      expectedCents: 8500,
      accommodationCents: 10000,
      perHeadCents: 3333,
      balanceCents: -4500,
      expectedBalanceCents: -1500,
    },
  );
});

test('event settlement keeps historical payments separate from the current accepted roster', () => {
  assert.deepEqual(
    eventSettlement({
      costCents: 5000,
      accommodationCostCents: 10000,
      settlementPaidCents: 10000,
      settlementPaidCount: 2,
      acceptedParticipants: [
        { playerId: 'still-attending', paid: true, paidAmountCents: 5000 },
        { playerId: 'open', paid: false },
      ],
    }),
    {
      participantCount: 2,
      paidCount: 2,
      unpaidCount: 1,
      paidCents: 10000,
      missingAmountCount: 0,
      expectedCents: 15000,
      accommodationCents: 10000,
      perHeadCents: 5000,
      balanceCents: 0,
      expectedBalanceCents: 5000,
    },
  );
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
