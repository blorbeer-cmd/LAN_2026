import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctPlayersFromMatchResults, distinctPlayersFromTeamRosters } from './featureUsage';

test('distinctPlayersFromMatchResults collects unique player ids across teams and matches', () => {
  const results = [
    JSON.stringify({ teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 }),
    JSON.stringify({ teams: [{ playerIds: ['a'] }, { playerIds: ['d'] }], winnerTeamIndex: null }),
  ];
  const ids = distinctPlayersFromMatchResults(results);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd']);
});

test('distinctPlayersFromMatchResults skips malformed rows instead of throwing', () => {
  const ids = distinctPlayersFromMatchResults(['not json', JSON.stringify({ teams: [{ playerIds: ['a'] }] })]);
  assert.deepEqual([...ids], ['a']);
});

test('distinctPlayersFromMatchResults returns an empty set for no rows', () => {
  assert.equal(distinctPlayersFromMatchResults([]).size, 0);
});

test('distinctPlayersFromTeamRosters collects unique player ids across team rosters', () => {
  const rosters = [JSON.stringify(['a', 'b']), JSON.stringify(['b', 'c'])];
  const ids = distinctPlayersFromTeamRosters(rosters);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
});

test('distinctPlayersFromTeamRosters skips malformed or non-array rows', () => {
  const ids = distinctPlayersFromTeamRosters(['not json', JSON.stringify({ not: 'an array' }), JSON.stringify(['a'])]);
  assert.deepEqual([...ids], ['a']);
});
