import test from 'node:test';
import assert from 'node:assert/strict';
import { entryHtml } from './notificationBanner.js';

const baseEntry = {
  id: 'entry-1',
  url: '/#checklist',
  body: 'Neue Aufgabe',
  createdAt: 0,
  seen: true,
};

test('a notification link carries its event id so the deep link can switch workspaces', () => {
  const html = entryHtml({ ...baseEntry, eventId: 'lan-2026' });

  assert.match(html, /data-notification-event-id="lan-2026"/);
});

test('a food-order notification carries its order target', () => {
  const html = entryHtml({ ...baseEntry, url: '/#foodOrders/order-42' });

  assert.match(html, /data-notification-navigate="foodOrders"/);
  assert.match(html, /data-notification-target="order-42"/);
});

test('a notification without an event id yields an empty attribute, never the string "undefined"', () => {
  // The attribute is read back as control.dataset.notificationEventId and
  // handed to activateEvent(), which skips the workspace switch for a falsy
  // eventId. The literal string "undefined" is truthy and would pass that
  // check — the app would then try to activate a non-existent event.
  const html = entryHtml(baseEntry);

  assert.match(html, /data-notification-event-id=""/);
  assert.doesNotMatch(html, /data-notification-event-id="undefined"/);
});

test('a notification event id is escaped before it reaches the markup', () => {
  const html = entryHtml({ ...baseEntry, eventId: '"><script>alert(1)</script>' });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-notification-event-id="&quot;&gt;/);
});
