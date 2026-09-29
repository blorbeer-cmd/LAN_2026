import test from 'node:test';
import assert from 'node:assert/strict';

import { capTeamCountValue, defaultDrawTeamName, teamCountMax } from './matchmaking.js';

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

const players = (...names) => names.map((name, index) => ({ id: `p${index}`, name }));

test('a solo draw team is named after its player and follows later moves', () => {
  const draw = { source: 'balanced' };
  assert.equal(defaultDrawTeamName(draw, { players: players('Alice') }, 0), 'Alice');
  assert.equal(defaultDrawTeamName(draw, { players: players('Alice', 'Bob') }, 0), 'Team 1');
  assert.equal(defaultDrawTeamName(draw, { players: players('Bob') }, 1), 'Bob');
});

test('a drafted team keeps its captain name unless the captain plays alone', () => {
  const draw = { source: 'draft' };
  assert.equal(defaultDrawTeamName(draw, { players: players('Cara', 'Dan') }, 0), 'Team Cara');
  assert.equal(defaultDrawTeamName(draw, { players: players('Cara') }, 0), 'Cara');
});

test('derived team names fit the tournament team name limit', () => {
  const longName = `${'x'.repeat(29)} yz`;
  assert.equal(defaultDrawTeamName({ source: 'balanced' }, { players: players(longName) }, 0), 'x'.repeat(29));
  assert.equal(defaultDrawTeamName({ source: 'draft' }, { players: players('y'.repeat(60), 'Dan') }, 0).length, 30);
  const emojiCut = defaultDrawTeamName({ source: 'balanced' }, { players: players(`${'x'.repeat(29)}🔥`) }, 0);
  assert.equal(emojiCut, 'x'.repeat(29), 'a cut through an emoji drops its orphaned half');
  assert.equal(defaultDrawTeamName({ source: 'balanced' }, { players: players(`${'x'.repeat(28)}🔥`) }, 0), `${'x'.repeat(28)}🔥`);
});
