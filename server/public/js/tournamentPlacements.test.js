import test from 'node:test';
import assert from 'node:assert/strict';
import { isMainBracketMatch, placementMatchLabel } from './tournamentPlacements.js';

test('placementMatchLabel names the place a match decides directly, else the range', () => {
  assert.equal(placementMatchLabel({ round: 3, placeRange: { from: 3, to: 4 } }, 3), 'Spiel um Platz 3');
  assert.equal(placementMatchLabel({ round: 2, placeRange: { from: 5, to: 8 } }, 3), 'Platz 5–8');
  // Byes can shrink an early placement bracket to two real teams.
  assert.equal(placementMatchLabel({ round: 2, placeRange: { from: 5, to: 6 } }, 3), 'Spiel um Platz 5');
  assert.equal(placementMatchLabel({ round: 2, placeRange: null }, 2), '');
});

test('isMainBracketMatch treats matches without placeFrom as the main bracket', () => {
  assert.equal(isMainBracketMatch({}), true);
  assert.equal(isMainBracketMatch({ placeFrom: 1 }), true);
  assert.equal(isMainBracketMatch({ placeFrom: 3 }), false);
});
