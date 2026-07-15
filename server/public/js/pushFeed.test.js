import test from 'node:test';
import assert from 'node:assert/strict';

import { feedEntryIcon, feedEntryTitle } from './pushFeed.js';

test('legacy notification emoji are removed from persisted titles', () => {
  assert.equal(feedEntryTitle({ title: '🍕 Neue Sammelbestellung' }), 'Neue Sammelbestellung');
  assert.equal(feedEntryTitle({ title: '🏆 Neues Turnier' }), 'Neues Turnier');
  assert.equal(feedEntryTitle({ title: 'Normaler Titel' }), 'Normaler Titel');
});

test('notification categories use the shared UI icon set', () => {
  assert.equal(feedEntryIcon({ url: '/#foodOrders' }), 'hamburger');
  assert.equal(feedEntryIcon({ url: '/#tournaments' }), 'trophy');
  assert.equal(feedEntryIcon({ url: '/unbekannt' }), 'bell');
});
