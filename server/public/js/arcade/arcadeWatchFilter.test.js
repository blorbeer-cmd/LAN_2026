import test from 'node:test';
import assert from 'node:assert/strict';

import { isOwnFinishedMatch } from './arcadeWatchFilter.js';

test('a still-running match is never filtered, regardless of participants', () => {
  assert.equal(isOwnFinishedMatch({ phase: 'playing', players: [{ id: 'me' }] }, 'me'), false);
  assert.equal(isOwnFinishedMatch({ phase: 'countdown', scores: [{ playerId: 'me' }] }, 'me'), false);
});

test('an ended match the viewer played in is filtered, via players or scores', () => {
  assert.equal(isOwnFinishedMatch({ phase: 'ended', players: [{ id: 'me' }, { id: 'other' }] }, 'me'), true);
  assert.equal(isOwnFinishedMatch({ phase: 'ended', scores: [{ playerId: 'me' }, { playerId: 'other' }] }, 'me'), true);
});

test('an ended match with only a nested ref id still matches the viewer', () => {
  assert.equal(isOwnFinishedMatch({ phase: 'ended', players: [{ ref: { id: 'me' } }] }, 'me'), true);
});

test('an ended match the viewer did not play in stays visible to them', () => {
  assert.equal(isOwnFinishedMatch({ phase: 'ended', players: [{ id: 'someone-else' }] }, 'me'), false);
});

test('without a known identity nothing is filtered', () => {
  assert.equal(isOwnFinishedMatch({ phase: 'ended', players: [{ id: 'me' }] }, ''), false);
  assert.equal(isOwnFinishedMatch({ phase: 'ended', players: [{ id: 'me' }] }, undefined), false);
});
