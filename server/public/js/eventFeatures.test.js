import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventHasFeature, viewIsEnabledForEvent } from './eventFeatures.js';

const generalEvent = {
  enabledFeatures: ['tasks', 'travel', 'food', 'costs', 'music', 'arcade'],
};

test('general events keep core and planning areas while hiding LAN-specific routes', () => {
  for (const view of ['home', 'profile', 'events', 'broadcast', 'foodOrders', 'checklist', 'arrivals', 'music', 'arcade', 'tetris']) {
    assert.equal(viewIsEnabledForEvent(view, generalEvent), true, view);
  }
  for (const view of ['matchmaking', 'tournaments', 'votes', 'gameCatalog', 'leaderboard', 'kiosk', 'seating']) {
    assert.equal(viewIsEnabledForEvent(view, generalEvent), false, view);
  }
});

test('missing snapshots preserve the historical all-features behavior', () => {
  assert.equal(eventHasFeature(null, 'tracking'), true);
  assert.equal(viewIsEnabledForEvent('arcade', {}), true);
});

test('groups expose game voting and competition while keeping LAN-only areas hidden', () => {
  const group = {
    eventType: 'group',
    enabledFeatures: ['tasks', 'food', 'music', 'games', 'competition', 'arcade'],
  };
  for (const view of ['matchmaking', 'tournaments', 'votes', 'gameCatalog']) {
    assert.equal(viewIsEnabledForEvent(view, group), true, view);
  }
  for (const view of ['arrivals', 'checklistPacking', 'leaderboard', 'kiosk', 'seating']) {
    assert.equal(viewIsEnabledForEvent(view, group), false, view);
  }
});
