import assert from 'node:assert/strict';
import test from 'node:test';
import { realtimeEventAffectsView } from './realtimeRefreshPolicy.js';

test('unrelated event lifecycle changes do not redraw interactive catalog views', () => {
  assert.equal(realtimeEventAffectsView('events:changed', 'gameCatalog'), false);
  assert.equal(realtimeEventAffectsView('events:changed', 'foodOrders'), false);
  assert.equal(realtimeEventAffectsView('events:changed', 'events'), true);
  assert.equal(realtimeEventAffectsView('events:changed', 'hallOfFame'), true);
});

test('shared entity changes redraw only views that consume them', () => {
  assert.equal(realtimeEventAffectsView('skills:changed', 'gameCatalog'), true);
  assert.equal(realtimeEventAffectsView('skills:changed', 'broadcast'), false);
  assert.equal(realtimeEventAffectsView('leaderboard:changed', 'hallOfFame'), true);
  assert.equal(realtimeEventAffectsView('leaderboard:changed', 'gameCatalog'), true);
  assert.equal(realtimeEventAffectsView('unknown:changed', 'home'), false);
});
