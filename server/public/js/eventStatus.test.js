import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_STATUS,
  compareEventsByStartAscending,
  eventDisplayName,
  eventSelectOption,
  eventSelectOptions,
  eventStatus,
  eventStatusBadgeHtml,
  eventSwitcherLabel,
} from './eventStatus.js';

test('the permanent base workspace reports itself as the base state', () => {
  assert.equal(eventStatus({ isBase: true }).key, 'base');
  // Even while it tracks: "Allgemein" is what it is, not a lifecycle stage.
  assert.equal(eventStatus({ isBase: true, trackingEnabled: true }).key, 'base');
});

test('an ended event never reports as tracking', () => {
  assert.equal(eventStatus({ isEnded: true, startsAt: 1_000 }).key, 'ended');
  assert.equal(eventStatus({ isEnded: true, trackingEnabled: true, startsAt: 1_000 }).key, 'ended');
});

test('a tracking event is distinguished from a merely created one', () => {
  assert.equal(eventStatus({ trackingEnabled: true, startsAt: 1_000 }).key, 'tracking');
  assert.equal(eventStatus({ trackingEnabled: false, startsAt: 1_000 }).key, 'idle');
  assert.equal(eventStatus({ startsAt: 1_000 }).key, 'idle');
});

test('a missing event falls back to the neutral state instead of throwing', () => {
  assert.equal(eventStatus(undefined).key, 'idle');
  assert.equal(eventStatus(null).key, 'idle');
});

// A planning event (docs/plans/event-date-poll-concept.md) has no fixed
// date yet — neither "tracking" nor "idle" describes that, and ended/base
// still take priority the same way they always have.
test('an event without a fixed date reports as planning', () => {
  assert.equal(eventStatus({ startsAt: null }).key, 'planning');
  assert.equal(eventStatus({ startsAt: null, trackingEnabled: false }).key, 'planning');
  assert.equal(eventStatus({ startsAt: null, isBase: true }).key, 'base');
  assert.equal(eventStatus({ startsAt: null, isEnded: true }).key, 'planning');
});

test('every state carries a German label and an icon for accessible status output', () => {
  for (const status of Object.values(EVENT_STATUS)) {
    assert.ok(status.label.length > 0, `${status.key} needs an accessible label`);
    assert.ok(status.icon.length > 0, `${status.key} needs an icon`);
    assert.match(status.badge, /^badge-/, `${status.key} needs a badge variant`);
  }
});

test('the switcher label stays at the event name', () => {
  assert.equal(eventSwitcherLabel({ isBase: true, name: 'Interner Name' }), 'Allgemein');
  assert.equal(eventSwitcherLabel({ name: 'Sommer-LAN', trackingEnabled: true }), 'Sommer-LAN');
  assert.equal(eventSwitcherLabel({ name: 'Sommer-LAN' }), 'Sommer-LAN');
  assert.equal(eventSwitcherLabel({ name: 'Winter-LAN', isEnded: true }), 'Winter-LAN');
});

test('event status badges show only the icon while retaining an accessible label', () => {
  const badge = eventStatusBadgeHtml({ isEnded: true, startsAt: 1_000 });
  assert.match(badge, /aria-label="Beendet"/);
  assert.match(badge, /title="Beendet"/);
  assert.doesNotMatch(badge, />Beendet<\/span>/);
});

test('the base workspace shows its fixed visible name, never its stored one', () => {
  assert.equal(eventDisplayName({ isBase: true, name: 'instance base' }), 'Allgemein');
  assert.equal(eventDisplayName({ name: 'Sommer-LAN' }), 'Sommer-LAN');
  assert.equal(eventDisplayName(null), '');
});

test('a dropdown option is the event title plus its state as an icon', () => {
  const option = eventSelectOption({ id: 'e1', name: 'Sommer-LAN', trackingEnabled: true, startsAt: 1_000 });
  assert.deepEqual(option, {
    value: 'e1',
    label: 'Sommer-LAN',
    icon: EVENT_STATUS.tracking.icon,
    iconLabel: 'Trackt gerade',
    iconState: 'tracking',
  });
  // The title never repeats the state as text — the icon carries it, and its
  // accessible label keeps the meaning without duplicating it on screen.
  assert.doesNotMatch(option.label, /Trackt gerade/);
});

test('event dropdown options show the earliest fixed start first and undated events last', () => {
  const options = eventSelectOptions([
    { id: 'planning', name: 'Terminfindung', startsAt: null },
    { id: 'old', name: 'Winter-LAN', startsAt: 1_000, endsAt: 2_000, isEnded: true },
    { id: 'new', name: 'Sommer-LAN', startsAt: 9_000, endsAt: null, trackingEnabled: true },
  ]);
  assert.deepEqual(
    options.map((option) => option.value),
    ['old', 'new', 'planning'],
  );
  // The dates used to be appended in one filter only, which is exactly the
  // inconsistency this shared builder removes.
  assert.deepEqual(
    options.map((option) => option.label),
    ['Winter-LAN', 'Sommer-LAN', 'Terminfindung'],
  );
  assert.deepEqual(
    options.map((option) => option.iconState),
    ['ended', 'tracking', 'planning'],
  );
});

test('the shared event comparator keeps two undated planning events stable', () => {
  assert.equal(compareEventsByStartAscending({ startsAt: null }, { startsAt: undefined }), 0);
});

test('the optional all-events entry leads the list and claims no lifecycle state', () => {
  const options = eventSelectOptions([{ id: 'e1', name: 'Sommer-LAN', startsAt: 1 }], {
    allEntryLabel: 'Gesamt (alle Events)',
  });
  assert.equal(options[0].value, '');
  assert.equal(options[0].label, 'Gesamt (alle Events)');
  assert.equal(options[0].icon, undefined);
  assert.equal(options[1].value, 'e1');
});

test('building options leaves the caller list untouched', () => {
  const events = [
    { id: 'a', name: 'A', startsAt: 1 },
    { id: 'b', name: 'B', startsAt: 9 },
  ];
  eventSelectOptions(events);
  assert.deepEqual(
    events.map((event) => event.id),
    ['a', 'b'],
  );
});
