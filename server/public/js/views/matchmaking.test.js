import test from 'node:test';
import assert from 'node:assert/strict';

import { capTeamCountValue, teamCountMax } from './matchmaking.js';

test('the team count is capped at the number of selected players', () => {
  assert.equal(capTeamCountValue('12', 10), '10');
  assert.equal(capTeamCountValue('10', 10), '10');
  assert.equal(capTeamCountValue('4', 10), '4');
});

test('deselecting players pulls a higher team count down with the selection', () => {
  let value = capTeamCountValue('12', 12);
  assert.equal(value, '12');
  value = capTeamCountValue(value, 10);
  assert.equal(value, '10');
});

test('the cap never drops below the field minimum and leaves an empty field alone', () => {
  assert.equal(teamCountMax(0), 2);
  assert.equal(teamCountMax(1), 2);
  assert.equal(capTeamCountValue('5', 1), '2');
  assert.equal(capTeamCountValue('', 3), '');
});
