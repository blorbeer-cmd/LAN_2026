import test from 'node:test';
import assert from 'node:assert/strict';

import { bannerContentHtml, feedEntryIcon, feedLinkTarget, feedEntryTitle } from './pushFeed.js';

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
