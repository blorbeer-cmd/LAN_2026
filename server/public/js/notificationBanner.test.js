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

test('a resolved entry never reads as unread, even before it was opened', () => {
  const html = entryHtml({ ...baseEntry, seen: false, resolvedAt: Date.now() - 1000 });

  assert.doesNotMatch(html, /is-unread/);
  assert.match(html, /is-obsolete/);
  assert.match(html, /badge-neutral">Obsolet</);
  assert.doesNotMatch(html, /notification-center-seen/, 'the redundant "mark as seen" action is hidden once obsolete');
});

test('an expired-but-unresolved entry is labeled distinctly from a resolved one', () => {
  const html = entryHtml({ ...baseEntry, seen: false, resolvedAt: null, expiresAt: Date.now() - 1000 });

  assert.match(html, /is-obsolete/);
  assert.match(html, /badge-neutral">Abgelaufen</);
});

test('an obsolete entry keeps its navigate action and remove button', () => {
  const html = entryHtml({ ...baseEntry, url: '/#votes', seen: false, resolvedAt: Date.now() - 1000 });

  assert.match(html, /data-notification-navigate="votes"/, 'still one click away, e.g. to see a poll result');
  assert.match(html, /data-notification-hide=/);
});

test('a still-open entry with a future expiry is unaffected', () => {
  const html = entryHtml({ ...baseEntry, seen: false, resolvedAt: null, expiresAt: Date.now() + 60_000 });

  assert.match(html, /is-unread/);
  assert.doesNotMatch(html, /is-obsolete/);
  assert.doesNotMatch(html, /badge-neutral/);
});
