import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventHasFeature, viewIsEnabledForEvent } from './eventFeatures.js';

const generalEvent = {
  enabledFeatures: ['tasks', 'travel', 'food', 'costs', 'music', 'arcade', 'seating'],
};

test('general events keep core and planning areas while hiding LAN-specific routes', () => {
  for (const view of ['home', 'profile', 'events', 'broadcast', 'foodOrders', 'checklist', 'arrivals', 'music', 'arcade', 'tetris', 'seating']) {
    assert.equal(viewIsEnabledForEvent(view, generalEvent), true, view);
  }
  for (const view of ['matchmaking', 'tournaments', 'votes', 'gameCatalog', 'leaderboard', 'kiosk']) {
    assert.equal(viewIsEnabledForEvent(view, generalEvent), false, view);
  }
});

test('missing snapshots preserve the historical all-features behavior', () => {
  assert.equal(eventHasFeature(null, 'tracking'), true);
  assert.equal(viewIsEnabledForEvent('arcade', {}), true);
});
