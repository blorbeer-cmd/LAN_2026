import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedParticipantCount,
  eventDateRange,
  eventPdfExportAvailable,
  eventSettlement,
  parseEventAccommodationCostCents,
  parseEventCostCents,
  renderEventCalendarActions,
  renderEventExcuseActions,
  renderEventLocation,
  renderInvitationCard,
  renderDeclinedEventCard,
  renderEventCard,
  renderOwnParticipationActions,
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

test('scheduled event cards offer Google, Outlook and an ICS calendar file', () => {
  const event = {
    id: 'calendar-event',
    name: 'Kalender LAN',
    startsAt: Date.UTC(2026, 8, 8, 16, 0),
    endsAt: Date.UTC(2026, 8, 10, 10, 0),
  };
  const html = renderEventCalendarActions(event);
  assert.match(html, /data-event-calendar="google"/);
  assert.match(html, /data-event-calendar="outlook"/);
  assert.match(html, /data-download-event-calendar="calendar-event"/);
  assert.doesNotMatch(html, /data-confirm-event-calendar/);

  const unconfirmed = renderEventCalendarActions({
    ...event,
    myParticipation: { status: 'accepted', calendarConfirmed: false },
  });
  assert.match(unconfirmed, /data-confirm-event-calendar="calendar-event"/);
  assert.match(unconfirmed, /Beendet die Kalender-Erinnerungen/);

  const confirmed = renderEventCalendarActions({
    ...event,
    myParticipation: { status: 'accepted', calendarConfirmed: true },
  });
  assert.match(confirmed, /data-event-calendar-confirmed="calendar-event"/);
  assert.match(confirmed, /Im Kalender eingetragen/);
  assert.doesNotMatch(confirmed, /data-confirm-event-calendar/);

  assert.doesNotMatch(renderEventCalendarActions({ startsAt: null, endsAt: null }), /Kalender/);
  assert.doesNotMatch(renderEventCalendarActions({
    startsAt: Date.UTC(2026, 8, 8),
    endsAt: Date.UTC(2026, 8, 9),
    isEnded: true,
  }), /Kalender/);
  assert.doesNotMatch(renderEventCalendarActions({
    startsAt: Date.UTC(2026, 8, 8),
    endsAt: Date.UTC(2026, 8, 9),
  }, { invitation: true }), /Kalender/);
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

test('every upcoming event card offers the excuse generator, ended ones do not', () => {
  const event = { id: 'excuse-event', name: 'Winter LAN' };
  const html = renderEventExcuseActions(event);
  assert.match(html, /data-event-excuse="excuse-event"/);
  assert.match(html, /Ausrede generieren/);
  assert.equal(renderEventExcuseActions({ ...event, isEnded: true }), '');
});

test('a pending invitation carries the excuse action but no calendar handoff', () => {
  const html = renderInvitationCard({
    id: 'invited-event',
    name: 'Sommer LAN',
    startsAt: Date.UTC(2026, 8, 8, 16, 0),
    endsAt: Date.UTC(2026, 8, 10, 10, 0),
  });
  assert.match(html, /data-event-excuse="invited-event"/);
  assert.doesNotMatch(html, /data-event-calendar=/);
});

test('an accepted member card offers the withdrawal, or names why it is blocked', () => {
  const event = { id: 'member-event', name: 'Winter LAN' };
  const open = renderOwnParticipationActions({
    ...event,
    myParticipation: { status: 'accepted', canDecline: true, lockReason: null },
  });
  assert.match(open, /data-decline-participation="member-event"/);
  assert.match(open, /Teilnahme absagen/);

  const locked = renderOwnParticipationActions({
    ...event,
    myParticipation: { status: 'accepted', canDecline: false, lockReason: 'paid' },
  });
  assert.doesNotMatch(locked, /data-decline-participation/);
  assert.match(locked, /Zahlung ist bereits erfasst/);

  // A still-open invitation is answered on its own invitation card, not here.
  assert.equal(
    renderOwnParticipationActions({ ...event, myParticipation: { status: 'invited', canDecline: true } }),
    '',
  );
});

test('an organizer answers their own participation on the management card', () => {
  const event = {
    id: 'managed-event',
    name: 'Winter LAN',
    startsAt: Date.UTC(2026, 8, 8, 16, 0),
    endsAt: Date.UTC(2026, 8, 10, 10, 0),
    myParticipation: { status: 'accepted', canDecline: true, lockReason: null },
  };
  const accepted = renderEventCard(event);
  assert.match(accepted, /data-decline-participation="managed-event"/);
  assert.doesNotMatch(accepted, /Du: Abgesagt/);

  // Their declined events never move into the member "Abgesagt" section, so
  // both the state and the way back have to live on this card.
  const declined = renderEventCard({
    ...event,
    myParticipation: { status: 'declined', canAccept: true, lockReason: null },
  });
  assert.match(declined, /badge-offline">Du: Abgesagt</);
  assert.match(declined, /data-accept-participation="managed-event"/);
  // The management footer keeps its own primary actions to itself.
  assert.doesNotMatch(declined, /btn-primary btn-sm" data-accept-participation/);

  // Organizing an event one is not part of offers nothing to answer.
  assert.doesNotMatch(renderEventCard({ ...event, myParticipation: null }), /data-(accept|decline)-participation/);
});

test('a declined event stays a teaser with the way back', () => {
  const event = {
    id: 'declined-event',
    name: 'Sommer LAN',
    startsAt: Date.UTC(2026, 8, 8, 16, 0),
    endsAt: Date.UTC(2026, 8, 10, 10, 0),
    myParticipation: { status: 'declined', canAccept: true, lockReason: null },
  };
  const html = renderDeclinedEventCard(event);
  assert.match(html, /badge-offline">Abgesagt</);
  assert.match(html, /data-accept-participation="declined-event"/);
  // Teaser rules: no roster, and no calendar handoff before acceptance.
  assert.doesNotMatch(html, /event-participant-list|data-event-calendar=/);

  const locked = renderDeclinedEventCard({
    ...event,
    myParticipation: { status: 'declined', canAccept: false, lockReason: 'ended' },
  });
  assert.doesNotMatch(locked, /data-accept-participation/);
  assert.match(locked, /Das Event ist beendet/);
});
