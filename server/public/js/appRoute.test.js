import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appHash, localRouteKey, parseAppHash } from './appRoute.js';

test('tournament detail routes survive hash round trips and a legacy create link opens the list', () => {
  assert.deepEqual(parseAppHash('#tournaments/new'), {
    view: 'tournaments',
    localRoute: null,
    searchTarget: null,
  });
  assert.deepEqual(parseAppHash('#tournaments/turnier%201'), {
    view: 'tournaments',
    localRoute: { kind: 'detail', id: 'turnier 1' },
    searchTarget: null,
  });
  assert.equal(appHash('tournaments', { kind: 'detail', id: 'turnier 1' }), '#tournaments/turnier%201');
  // The start push's Teams link targets the own team once; the stored hash
  // drops the suffix so a reload does not replay the highlight.
  const teamsLink = parseAppHash('#tournaments/cup/teams');
  assert.deepEqual(teamsLink.localRoute, { kind: 'detail', id: 'cup' });
  assert.deepEqual(teamsLink.searchTarget, { type: 'tournament-team', id: 'cup' });
  assert.equal(appHash('tournaments', teamsLink.localRoute, teamsLink.searchTarget), '#tournaments/cup');
});

test('arcade game routes and existing targeted hashes stay distinct', () => {
  assert.deepEqual(parseAppHash('#arcade/challenge-rush').localRoute, {
    kind: 'game',
    id: 'challenge-rush',
  });
  assert.equal(appHash('arcade', { kind: 'game', id: 'snake' }), '#arcade/snake');
  assert.deepEqual(parseAppHash('#eventPolls/poll%2F1').searchTarget, {
    type: 'poll',
    id: 'poll/1',
  });
  assert.equal(
    appHash('eventPolls', null, { type: 'poll', id: 'poll/1' }),
    '#eventPolls/poll%2F1',
  );
  assert.equal(
    appHash('foodOrders', null, { type: 'order', id: 'order 1' }),
    '#foodOrders/order%201',
  );
  assert.deepEqual(parseAppHash('#events/lan%201').searchTarget, { type: 'event', id: 'lan 1' });
  assert.equal(appHash('events', null, { type: 'event', id: 'lan 1' }), '#events/lan%201');
});

test('invalid encoded segments fall back to their parent view', () => {
  assert.deepEqual(parseAppHash('#tournaments/%E0%A4%A'), {
    view: 'tournaments',
    localRoute: null,
    searchTarget: null,
  });
  assert.equal(localRouteKey({ kind: 'detail', id: 'abc' }), 'detail:abc');
  assert.equal(localRouteKey(null), '');
});
