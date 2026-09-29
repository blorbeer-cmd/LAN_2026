import test from 'node:test';
import assert from 'node:assert/strict';

import { matchSelectionFromVote, runoffSourceRound } from './votes.js';

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

// Round 1 tied cs2 and aoe; round 2 is its runoff. Round 0 is older and
// round 3 is a later points round, so neither may count as the source.
const tiedRound = {
  round: 1,
  mode: 'points',
  totalVoters: 3,
  winnerGameIds: ['cs2', 'aoe'],
  results: [{ gameId: 'cs2' }, { gameId: 'aoe' }, { gameId: 'rl' }],
  ballots: [
    ballot('alice', { cs2: 5, aoe: 0, rl: 0 }),
    ballot('bob', { cs2: 0, aoe: 5, rl: 0 }),
    ballot('carol', { cs2: 3, aoe: 3, rl: 1 }),
  ],
};
const runoff = {
  round: 2,
  mode: 'single',
  winnerGameIds: ['cs2'],
  results: [{ gameId: 'cs2' }, { gameId: 'aoe' }],
  ballots: [ballot('alice', { cs2: null }), ballot('bob', { cs2: null }), ballot('carol', { aoe: null }), ballot('dave', { aoe: null })],
};

test('a runoff finds the points round whose tie it resolves', () => {
  const older = { ...tiedRound, round: 0 };
  const later = { ...tiedRound, round: 3 };
  const empty = { ...tiedRound, round: 1.5, totalVoters: 0 };
  assert.equal(runoffSourceRound([later, runoff, empty, tiedRound, older], runoff), tiedRound);
  assert.equal(runoffSourceRound([later, empty, tiedRound, older], { round: 2, results: runoff.results }), tiedRound, 'open runoff');
  assert.equal(runoffSourceRound([{ ...tiedRound, results: [{ gameId: 'cs2' }] }], runoff), null, 'games must match');
});

test('after a runoff every participant plays except those who gave the winner 0 before', () => {
  // Bob declined cs2 in round 1; Dave only joined for the runoff.
  assert.deepEqual(matchSelectionFromVote(runoff, catalog, tiedRound), { gameId: 'cs2', playerIds: ['alice', 'carol', 'dave'] });
  assert.deepEqual(
    matchSelectionFromVote({ ...runoff, winnerGameIds: ['aoe'] }, catalog, tiedRound),
    { gameId: 'aoe', playerIds: ['bob', 'carol', 'dave'] }
  );
  assert.deepEqual(
    matchSelectionFromVote(runoff, catalog, null).playerIds,
    ['alice', 'bob', 'carol', 'dave'],
    'without its source round every participant stays'
  );
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
