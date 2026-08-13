import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_STATUS, eventDisplayName, eventStatus, eventStatusBadgeHtml, eventSwitcherLabel } from './eventStatus.js';

test('the permanent base workspace reports itself as the base state', () => {
  assert.equal(eventStatus({ isBase: true }).key, 'base');
  // Even while it tracks: "Allgemein" is what it is, not a lifecycle stage.
  assert.equal(eventStatus({ isBase: true, trackingEnabled: true }).key, 'base');
});

test('an ended event never reports as tracking', () => {
  assert.equal(eventStatus({ isEnded: true }).key, 'ended');
  assert.equal(eventStatus({ isEnded: true, trackingEnabled: true }).key, 'ended');
});

test('a tracking event is distinguished from a merely created one', () => {
  assert.equal(eventStatus({ trackingEnabled: true }).key, 'tracking');
  assert.equal(eventStatus({ trackingEnabled: false }).key, 'idle');
  assert.equal(eventStatus({}).key, 'idle');
});

test('a missing event falls back to the neutral state instead of throwing', () => {
  assert.equal(eventStatus(undefined).key, 'idle');
  assert.equal(eventStatus(null).key, 'idle');
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
  const badge = eventStatusBadgeHtml({ isEnded: true });
  assert.match(badge, /aria-label="Beendet"/);
  assert.match(badge, /title="Beendet"/);
  assert.doesNotMatch(badge, />Beendet<\/span>/);
});

test('the base workspace shows its fixed visible name, never its stored one', () => {
  assert.equal(eventDisplayName({ isBase: true, name: 'instance base' }), 'Allgemein');
  assert.equal(eventDisplayName({ name: 'Sommer-LAN' }), 'Sommer-LAN');
  assert.equal(eventDisplayName(null), '');
});
