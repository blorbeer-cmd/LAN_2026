import test from 'node:test';
import assert from 'node:assert/strict';

import { bannerContentHtml, feedEntryIcon, feedLinkTarget, feedEntryTitle, isFeedEntryObsolete } from './pushFeed.js';

test('legacy notification emoji are removed from persisted titles', () => {
  assert.equal(feedEntryTitle({ title: '🍕 Neue Sammelbestellung' }), 'Neue Sammelbestellung');
  assert.equal(feedEntryTitle({ title: '🏆 Neues Turnier' }), 'Neues Turnier');
  assert.equal(feedEntryTitle({ title: 'Normaler Titel' }), 'Normaler Titel');
});

test('notification categories use the shared UI icon set', () => {
  assert.equal(feedEntryIcon({ url: '/#foodOrders' }), 'hamburger');
  assert.deepEqual(feedLinkTarget('/#foodOrders/order-123'), { type: 'order', id: 'order-123' });
  assert.equal(feedEntryIcon({ url: '/#tournaments' }), 'swords');
  assert.equal(feedEntryIcon({ url: '/unbekannt' }), 'bell');
});

test('push banners visibly distinguish otherwise identical messages by event', () => {
  const first = bannerContentHtml({
    eventName: 'Sommer-LAN',
    title: 'Abstimmung gestartet',
    body: 'Jetzt abstimmen',
    url: '/#votes',
  });
  const second = bannerContentHtml({
    eventName: 'Winter-LAN',
    title: 'Abstimmung gestartet',
    body: 'Jetzt abstimmen',
    url: '/#votes',
  });

  assert.match(first, /Sommer-LAN · Abstimmung gestartet/);
  assert.match(second, /Winter-LAN · Abstimmung gestartet/);
  assert.notEqual(first, second);
});

test('an entry is obsolete once its workflow resolved, or once it expired, but not while still open', () => {
  const now = 1_000_000;
  assert.equal(isFeedEntryObsolete({ resolvedAt: null, expiresAt: null }, now), false);
  assert.equal(isFeedEntryObsolete({ resolvedAt: null, expiresAt: now + 1 }, now), false, 'not yet expired');
  assert.equal(isFeedEntryObsolete({ resolvedAt: null, expiresAt: now }, now), true, 'expiry passed');
  assert.equal(isFeedEntryObsolete({ resolvedAt: 999, expiresAt: null }, now), true, 'resolved outranks a missing expiry');
  assert.equal(isFeedEntryObsolete({ resolvedAt: 999, expiresAt: now + 1 }, now), true, 'resolved even before its own expiry');
});
