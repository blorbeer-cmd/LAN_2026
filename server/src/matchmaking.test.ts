import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTeamCount, balanceTeams, countSeatConflicts, type PlayerRating } from './matchmaking';

test('computeTeamCount defaults to 2 when nothing else forces more', () => {
  assert.equal(computeTeamCount(undefined, 6, 5), 2);
});

test('computeTeamCount respects an explicit value', () => {
  assert.equal(computeTeamCount(3, 6, 5), 3);
});

test('computeTeamCount grows beyond 2 when max team size can\'t fit everyone', () => {
  // 10 players, max team size 3 => need at least ceil(10/3) = 4 teams.
  assert.equal(computeTeamCount(undefined, 10, 3), 4);
});

test('balanceTeams splits an even group into equal-size teams', () => {
  const players: PlayerRating[] = [
    { id: 'a', rating: 8 },
    { id: 'b', rating: 8 },
    { id: 'c', rating: 3 },
    { id: 'd', rating: 3 },
  ];
  const teams = balanceTeams(players, 2);
  assert.equal(teams.length, 2);
  assert.equal(teams[0].length, 2);
  assert.equal(teams[1].length, 2);
  // Every player must appear exactly once across all teams.
  const allIds = teams.flat().sort();
  assert.deepEqual(allIds, ['a', 'b', 'c', 'd']);
});

test('balanceTeams keeps team skill sums close for a balanced input', () => {
  const players: PlayerRating[] = [
    { id: 'a', rating: 10 },
    { id: 'b', rating: 1 },
    { id: 'c', rating: 8 },
    { id: 'd', rating: 3 },
  ];
  const teams = balanceTeams(players, 2);
  const sum = (team: string[]) =>
    team.reduce((acc, id) => acc + players.find((p) => p.id === id)!.rating, 0);
  const sums = teams.map(sum);
  assert.ok(Math.abs(sums[0] - sums[1]) <= 2, `sums too far apart: ${sums}`);
});

test('balanceTeams never lets team sizes differ by more than one for an odd player count', () => {
  const players: PlayerRating[] = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    rating: 5,
  }));
  const teams = balanceTeams(players, 2);
  const sizes = teams.map((t) => t.length).sort();
  assert.deepEqual(sizes, [2, 3]);
});

test('balanceTeams handles more teams than the classic 2', () => {
  const players: PlayerRating[] = Array.from({ length: 9 }, (_, i) => ({
    id: `p${i}`,
    rating: (i % 10) + 1,
  }));
  const teams = balanceTeams(players, 3);
  assert.equal(teams.length, 3);
  const allIds = teams.flat().sort();
  assert.deepEqual(allIds, players.map((p) => p.id).sort());
  const sizes = teams.map((t) => t.length).sort();
  assert.deepEqual(sizes, [3, 3, 3]);
});

test('balanceTeams places every player exactly once even with many equal ratings (shuffle path)', () => {
  const players: PlayerRating[] = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    rating: 5, // all tied -> exercises the shuffle-within-rating-group code path
  }));
  const teams = balanceTeams(players, 2);
  const allIds = teams.flat().sort();
  assert.deepEqual(allIds, players.map((p) => p.id).sort());
});

test('countSeatConflicts counts pairs split across different teams', () => {
  const teams = [
    ['a', 'c'],
    ['b', 'd'],
  ];
  assert.equal(countSeatConflicts(teams, [['a', 'b']]), 1); // split -> conflict
  assert.equal(countSeatConflicts(teams, [['a', 'c']]), 0); // same team -> fine
});

test('countSeatConflicts ignores pairs where a player isn\'t actually in the draw', () => {
  const teams = [
    ['a', 'c'],
    ['b', 'd'],
  ];
  assert.equal(countSeatConflicts(teams, [['a', 'ghost']]), 0);
});

test('balanceTeams moves seat-neighbors onto the same team when that is affordable', () => {
  // Distinct ratings only, so orderForDraft's shuffle never kicks in and the
  // greedy draft is fully deterministic: a->team0, b->team1, c->team1,
  // d->team0 (team1 fills up first, forcing d onto team0), i.e. a and b
  // start out split. Swapping c<->a (both mid-pack ratings) reunites the
  // seat pair for only a small skill-balance cost.
  const players: PlayerRating[] = [
    { id: 'a', rating: 8 },
    { id: 'b', rating: 7 },
    { id: 'c', rating: 6 },
    { id: 'd', rating: 1 },
  ];
  const teams = balanceTeams(players, 2, [['a', 'b']]);
  assert.deepEqual(teams.map((t) => t.length).sort(), [2, 2]);
  assert.deepEqual(teams.flat().sort(), ['a', 'b', 'c', 'd']);
  assert.equal(countSeatConflicts(teams, [['a', 'b']]), 0, 'a and b should end up on the same team');
});

test('balanceTeams leaves a seat conflict unresolved when fixing it would badly hurt skill balance', () => {
  // Here a and b are the two strongest players by far; forcing them onto the
  // same team would blow the skill balance apart, so the conflict should be
  // left as-is rather than "fixed" at that cost.
  const players: PlayerRating[] = [
    { id: 'a', rating: 10 },
    { id: 'b', rating: 9 },
    { id: 'c', rating: 1 },
    { id: 'd', rating: 2 },
  ];
  const teams = balanceTeams(players, 2, [['a', 'b']]);
  assert.deepEqual(teams.map((t) => t.length).sort(), [2, 2]);
  assert.equal(countSeatConflicts(teams, [['a', 'b']]), 1);
});

test('balanceTeams with no avoidPairs behaves exactly as before (default param)', () => {
  const players: PlayerRating[] = [
    { id: 'a', rating: 10 },
    { id: 'b', rating: 1 },
    { id: 'c', rating: 8 },
    { id: 'd', rating: 3 },
  ];
  const teams = balanceTeams(players, 2);
  assert.deepEqual(teams.map((t) => t.length).sort(), [2, 2]);
  assert.deepEqual(teams.flat().sort(), ['a', 'b', 'c', 'd']);
});
