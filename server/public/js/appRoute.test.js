import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appHash, localRouteKey, parseAppHash } from './appRoute.js';

test('tournament create and detail routes survive hash round trips', () => {
  assert.deepEqual(parseAppHash('#tournaments/new'), {
    view: 'tournaments',
    localRoute: { kind: 'create' },
    searchTarget: null,
  });
  assert.deepEqual(parseAppHash('#tournaments/turnier%201'), {
    view: 'tournaments',
    localRoute: { kind: 'detail', id: 'turnier 1' },
    searchTarget: null,
  });
  assert.equal(appHash('tournaments', { kind: 'detail', id: 'turnier 1' }), '#tournaments/turnier%201');
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
