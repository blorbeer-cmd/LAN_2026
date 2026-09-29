import test from 'node:test';
import assert from 'node:assert/strict';

import { matchSelectionFromVote } from './votes.js';

const catalog = new Set(['cs2', 'aoe', 'rl']);

function ballot(playerId, points) {
  return { playerId, name: playerId, entries: Object.entries(points).map(([gameId, value]) => ({ gameId, points: value })) };
}

test('a points round hands its winner and everyone who gave it points to Match', () => {
  const round = {
    mode: 'points',
    winnerGameIds: ['cs2'],
    ballots: [
      ballot('alice', { cs2: 5, aoe: 0 }),
      ballot('bob', { cs2: 0, aoe: 4 }),
      ballot('carol', { cs2: 1, aoe: 2 }),
    ],
  };
  assert.deepEqual(matchSelectionFromVote(round, catalog), { gameId: 'cs2', playerIds: ['alice', 'carol'] });
});

test('a runoff decides only the game, so every participant joins the draw', () => {
  const round = {
    mode: 'single',
    winnerGameIds: ['aoe'],
    ballots: [ballot('alice', { aoe: null }), ballot('bob', { rl: null })],
  };
  assert.deepEqual(matchSelectionFromVote(round, catalog), { gameId: 'aoe', playerIds: ['alice', 'bob'] });
});

test('no Match is offered without one drawable winner and at least one player', () => {
  const ballots = [ballot('alice', { cs2: 3, aoe: 3 })];
  assert.equal(matchSelectionFromVote({ mode: 'points', winnerGameIds: ['cs2', 'aoe'], ballots }, catalog), null, 'tie');
  assert.equal(matchSelectionFromVote({ mode: 'points', winnerGameIds: ['gone'], ballots }, catalog), null, 'not in catalog');
  assert.equal(
    matchSelectionFromVote({ mode: 'points', winnerGameIds: ['rl'], ballots: [ballot('alice', { rl: 0 })] }, catalog),
    null,
    'nobody wants to play the winner'
  );
  assert.equal(matchSelectionFromVote(undefined, catalog), null, 'no closed round yet');
});
