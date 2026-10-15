import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventScheduleLabel } from './eventPresentation.js';
import { state } from './state.js';
import { getMyId, lockMyIdToSession } from './whoami.js';
import {
  acceptedParticipantCount,
  eventDateRange,
  eventSettlement,
  parseEventAccommodationCostCents,
  parseEventCostCents,
  renderEventCalendarActions,
  renderEventLocation,
  renderInvitationRow,
  renderInvitationCard,
  renderDeclinedEventCard,
  renderEventCard,
  renderEventSection,
  renderOwnParticipationActions,
} from './views/events.js';

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

  // The three ways sit behind one named "Kalender" menu.
  assert.match(html, /<summary class="btn btn-sm" aria-label="Kalender für Kalender LAN">Kalender /);
  assert.match(html, />Google</);
  assert.match(html, />Outlook</);
  assert.match(html, />Download ics file</);

  // The own acknowledgement is a visible "Eingetragen" checkbox, not a hidden
  // button with a help tooltip.
  const unconfirmed = renderEventCalendarActions({
    ...event,
    myParticipation: { status: 'accepted', calendarConfirmed: false },
  });
  assert.match(unconfirmed, /data-confirm-event-calendar="calendar-event"[^>]*aria-pressed="false"/);
  assert.match(unconfirmed, /<span>Eingetragen<\/span>/);
  assert.doesNotMatch(unconfirmed, /info-tooltip/);

  const confirmed = renderEventCalendarActions({
    ...event,
    myParticipation: { status: 'accepted', calendarConfirmed: true },
  });
  assert.match(confirmed, /data-event-calendar-confirmed="calendar-event"[^>]*aria-pressed="true"/);
  assert.match(confirmed, /title="Im Kalender eingetragen"/);
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

test('a pending invitation is one row: shortened name, meta line and only "Annehmen"', () => {
  const html = renderInvitationRow({
    id: 'invited-event',
    name: 'Silvester-LAN im Gemeindehaus Oberhausen mit Übernachtung',
    eventType: 'lan',
    startsAt: new Date(2026, 11, 29, 16, 0).getTime(),
    endsAt: new Date(2027, 0, 1, 12, 0).getTime(),
    location: 'Gemeindehaus Oberhausen',
  });
  // The full name stays reachable: it names the row's detail button.
  assert.match(html, /aria-label="Silvester-LAN im Gemeindehaus Oberhausen mit Übernachtung anzeigen"/);
  assert.match(html, /<span class="profile-row-title">Silvester-LAN im Gemeindehaus Oberhause…<\/span>/);
  assert.match(html, /29\.12\.2026 bis 1\.1\.2027 · Gemeindehaus Oberhausen/);
  assert.match(html, /data-open-invitation="invited-event"/);
  assert.match(html, /data-accept-invitation="invited-event"/);
  // Declining, the excuse generator and the calendar live in the dialog.
  assert.doesNotMatch(html, /data-decline-invitation=|data-event-excuse=|data-event-calendar=/);
  assert.doesNotMatch(html, / – /);
});

test('an accepted member card offers the withdrawal, or names why it is blocked', () => {
  const event = { id: 'member-event', name: 'Winter LAN' };
  const open = renderOwnParticipationActions({
    ...event,
    myParticipation: { status: 'accepted', canDecline: true, lockReason: null },
  });
  // "Absagen" bundles the plain decline and the decline with an excuse.
  assert.match(open, /<summary class="btn btn-sm" aria-label="Absagen: Teilnahme an Winter LAN">Absagen /);
  assert.match(open, /data-decline-participation="member-event"/);
  assert.match(open, /data-decline-with-excuse="member-event">Mit Ausrede absagen/);
  // A group or an ended event has no clashing appointment to excuse.
  const groupOpen = renderOwnParticipationActions({
    ...event,
    eventType: 'group',
    myParticipation: { status: 'accepted', canDecline: true, lockReason: null },
  });
  assert.match(groupOpen, /data-decline-participation="member-event"/);
  assert.doesNotMatch(groupOpen, /data-decline-with-excuse|action-menu/);

  const locked = renderOwnParticipationActions({
    ...event,
    myParticipation: { status: 'accepted', canDecline: false, lockReason: 'paid' },
  });
  assert.doesNotMatch(locked, /data-decline-participation/);
  assert.match(locked, /Zahlung ist bereits erfasst/);

  const invited = renderOwnParticipationActions({
    ...event, myParticipation: { status: 'invited', canDecline: true, canAccept: true },
  });
  assert.match(invited, /data-accept-invitation="member-event">Zusagen/);
  assert.match(invited, /data-decline-invitation="member-event">Absagen/);
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

  const invited = renderEventCard({
    ...event, myParticipation: { status: 'invited', canAccept: true, canDecline: true },
  });
  assert.match(invited, />Eingeladen</);
  assert.match(invited, /data-accept-invitation="managed-event"/);
  assert.match(invited, /data-decline-invitation="managed-event"/);
});

test('invited and declined event cards keep planning facts and only personal answer actions', () => {
  const event = {
    id: 'declined-event',
    name: 'Sommer LAN',
    startsAt: Date.UTC(2026, 8, 8, 16, 0),
    endsAt: Date.UTC(2026, 8, 10, 10, 0),
    location: 'Gemeindehaus <West>',
    description: 'Essen & Übernachtung',
    costCents: 2550,
    paymentDueAt: Date.UTC(2026, 8, 1),
    myParticipation: { status: 'declined', canAccept: true, lockReason: null },
  };
  const html = renderDeclinedEventCard(event);
  assert.match(html, /data-accept-participation="declined-event">Zusagen</);
  assert.match(html, /Abgesagt/);
  assert.match(html, /Gemeindehaus &lt;West&gt;/);
  assert.match(html, /Essen &amp; Übernachtung/);
  assert.match(html, /25,50/);
  assert.match(html, /bis /);
  // Teaser rules: no roster, and no calendar handoff before acceptance.
  assert.doesNotMatch(html, /event-participant-list|data-event-calendar=|data-pay-event=|data-toggle-event-paid=/);

  const pending = renderInvitationCard({
    ...event,
    myParticipation: { status: 'invited', canAccept: true, canDecline: true },
  });
  assert.match(pending, /data-pending-invitation="declined-event"/);
  assert.match(pending, />Eingeladen</);
  assert.match(pending, /25,50/);
  assert.match(pending, /data-accept-invitation=/);
  assert.match(pending, /data-decline-invitation=/);
  assert.doesNotMatch(pending, /event-participant-list|data-event-calendar=|data-pay-event=|data-toggle-event-paid=/);

  const cancelled = renderInvitationCard({
    ...event, status: 'cancelled',
    myParticipation: { status: 'invited', canAccept: false, canDecline: false, lockReason: 'cancelled' },
  });
  assert.match(cancelled, /Das Event wurde abgesagt/);
  assert.doesNotMatch(cancelled, /data-pending-invitation=|data-accept-invitation=|data-decline-invitation=/);

  const locked = renderDeclinedEventCard({
    ...event,
    myParticipation: { status: 'declined', canAccept: false, lockReason: 'ended' },
  });
  assert.doesNotMatch(locked, /data-accept-participation/);
  assert.match(locked, /Das Event ist beendet/);
});

// A group card must not offer what a group cannot do. Everything that needs a
// period or money is dropped from the card entirely, not rendered disabled:
// a control you cannot use is noise, and a disabled one still reads as a
// promise the workspace never keeps.
test('a group card drops every dated and paid control instead of disabling it', () => {
  const group = {
    id: 'skatrunde',
    name: 'Skatrunde',
    eventType: 'group',
    startsAt: null,
    endsAt: null,
    costCents: null,
    enabledFeatures: ['tasks', 'food', 'music', 'games', 'arcade'],
    acceptedParticipants: [],
  };
  const html = renderEventCard(group);

  assert.match(html, /<span class="muted event-card-meta">Gruppe · 0 Mitglieder<\/span>/);
  // "Beenden" stays: it is how a group that was created by mistake is retired.
  assert.match(html, /data-end-event="skatrunde"/);
  for (const absent of [
    /data-start-tracking/,
    /data-stop-tracking/,
    /data-event-calendar=/,
    /Termin wird noch abgestimmt/,
    /Zeitraum/,
    // An excuse answers a clashing appointment; a group has none.
    /data-decline-with-excuse/,
  ]) {
    assert.doesNotMatch(html, absent, String(absent));
  }
  // Management always sits behind the one "Aktion" menu.
  assert.match(html, /data-edit-event="skatrunde"/);
  assert.match(html, /<details class="action-menu" data-action-menu="event-manage-skatrunde">/);
  // Without location and note the Infos section is dropped entirely.
  assert.doesNotMatch(html, /<h4 class="event-card-section-title">Infos/);
  const documented = renderEventCard({ ...group, location: 'Bei Tim', description: 'Jeden Donnerstag' });
  assert.match(documented, /<h4 class="event-card-section-title">Infos/);
  assert.match(documented, /Jeden Donnerstag/);
  assert.match(documented, /maps\/search\/\?api=1&amp;query=Bei%20Tim/);
  assert.doesNotMatch(documented, /data-copy-event-value|In Google Maps öffnen/);
  // A circle has members, not attendees.
  assert.match(html, /<h4 class="event-card-section-title">Mitglieder /);
  assert.doesNotMatch(html, /Teilnehmende/);

  // The same event as a LAN keeps all of it, so the difference is the type and
  // not a missing field in this fixture.
  const lan = renderEventCard({
    ...group,
    eventType: 'lan',
    startsAt: Date.UTC(2026, 8, 8, 16, 0),
    endsAt: Date.UTC(2026, 8, 10, 10, 0),
    enabledFeatures: ['tracking'],
  });
  assert.match(lan, /data-start-tracking/);
  assert.match(lan, /btn-danger" data-end-event/);
  assert.match(lan, /Teilnehmende/);
  assert.match(lan, /Zeitraum/);

  // An ended group offers nothing further to close.
  const endedGroup = renderEventCard({ ...group, isEnded: true });
  assert.doesNotMatch(endedGroup, /data-end-event/);
  assert.match(endedGroup, /data-edit-event="skatrunde"/);

  // An event whose date is still open drops the same dated controls, but it is
  // abandoned the same way a group is, so "Beenden" is not a dated control.
  const undatedEvent = renderEventCard({
    ...group,
    id: 'termin-offen',
    eventType: 'lan',
    enabledFeatures: ['tracking'],
  });
  assert.match(undatedEvent, /data-end-event="termin-offen"/);
  assert.match(undatedEvent, /Termin wird noch abgestimmt/);
  assert.doesNotMatch(undatedEvent, /data-start-tracking/);
});

test('the Infos period names weekdays and times and joins with "bis"', () => {
  const startsAt = new Date(2026, 9, 9, 18, 0).getTime();
  const endsAt = new Date(2026, 9, 11, 14, 30).getTime();
  assert.equal(eventScheduleLabel({ startsAt, endsAt }), 'Fr 09.10., 18:00 bis So 11.10.2026, 14:30');
  const sameDay = new Date(2026, 9, 9, 22, 0).getTime();
  assert.equal(eventScheduleLabel({ startsAt, endsAt: sameDay }), 'Fr 09.10.2026, 18:00 bis 22:00');
  assert.equal(eventScheduleLabel({ eventType: 'group', startsAt: null }), '');
});

test('a group has no period text', () => {
  assert.equal(eventDateRange({ eventType: 'group', startsAt: null }), 'Dauerhaft geöffnet');
  // The permanent base workspace is not a group and keeps its own wording.
  assert.equal(eventDateRange({ eventType: 'group', isBase: true, startsAt: 1, endsAt: null }), 'Dauerhaft geöffnet');
  assert.equal(eventDateRange({ eventType: 'general', startsAt: null }), 'Termin wird noch abgestimmt');
});

test('cancelled event cards retain payment evidence without offering new payments', () => {
  const previous = { document: globalThis.document, window: globalThis.window, playerId: getMyId() };
  globalThis.document = { querySelector: () => null };
  globalThis.window = new EventTarget();
  try {
    lockMyIdToSession('payment-member');
    const own = { playerId: 'payment-member', name: 'Payment Member', status: 'accepted', paid: false };
    const event = {
      id: 'cancelled-payment', name: 'Bezahlte LAN', status: 'published',
      canManagePayments: false, costCents: 2550, paypalLink: 'https://paypal.me/test',
      acceptedParticipants: [own],
    };
    const active = renderEventCard(event);
    assert.match(active, /data-pay-event="cancelled-payment"/);
    assert.match(active, /data-toggle-event-paid="cancelled-payment"/);
    for (const paid of [false, true]) {
      const html = renderEventCard({
        ...event, status: 'cancelled',
        myParticipation: { status: 'accepted', canDecline: false, lockReason: 'cancelled' },
        acceptedParticipants: [{ ...own, paid, paidByName: 'Orga', paidAmountCents: 2550 }],
      });
      assert.match(html, /25,50/);
      assert.doesNotMatch(html, /data-pay-event=|data-toggle-event-paid=/);
      assert.match(html, paid ? /Bezahlt von Orga/ : /Das Event wurde abgesagt/);
    }
    const participants = [
      { ...own, paid: true },
      { playerId: 'unpaid-member', name: 'Unpaid Member', status: 'accepted', paid: false },
    ];
    const managed = renderEventCard({
      ...event, status: 'cancelled', canManagePayments: true,
      acceptedParticipants: participants, participants,
    });
    assert.match(managed, /data-toggle-event-paid="cancelled-payment" data-payment-player="payment-member"/);
    assert.doesNotMatch(managed, /data-toggle-event-paid="cancelled-payment" data-payment-player="unpaid-member"/);
  } finally {
    lockMyIdToSession(previous.playerId);
    globalThis.document = previous.document;
    globalThis.window = previous.window;
  }
});

test('only active invitations lead the overview while Historie stays chronological', () => {
  const previous = { ...state };
  const event = (name, startsAt, status, closed = false) => ({
    id: name, name, startsAt, endsAt: startsAt + 1,
    status: closed ? 'ended' : 'published', isEnded: closed,
    myParticipation: { status, canAccept: !closed, canDecline: !closed },
  });
  try {
    Object.assign(state, {
      managedEvents: null, plannedEvents: [], declinedEvents: [],
      availableEvents: [event('active-accepted', 100, 'accepted')],
      eventInvitations: [event('active-invited', 900, 'invited')],
      endedEvents: [
        event('past-invited', 3000, 'invited', true),
        event('past-declined', 2000, 'declined', true),
        event('past-accepted', 1000, 'accepted', true),
      ],
    });
    const html = renderEventSection();
    assert.ok(html.indexOf('active-invited') < html.indexOf('active-accepted'));
    assert.ok(html.indexOf('past-accepted') < html.indexOf('past-declined'));
    assert.ok(html.indexOf('past-declined') < html.indexOf('past-invited'));
  } finally {
    Object.assign(state, previous);
  }
});
