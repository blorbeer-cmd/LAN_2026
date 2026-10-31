import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, type MatchForScoring } from './leaderboard';

test('computeStandings gives each winner three total points and each loser one point', () => {
  const matches: MatchForScoring[] = [
    { teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c', 'd'] }], winnerTeamIndex: 0 },
  ];
  const standings = computeStandings(matches);
  const byId = new Map(standings.map((s) => [s.playerId, s]));

  assert.equal(byId.get('a')!.points, 3);
  assert.equal(byId.get('a')!.wins, 1);
  assert.equal(byId.get('c')!.points, 1);
  assert.equal(byId.get('c')!.wins, 0);
});

test('computeStandings ignores missing results but counts explicit draws', () => {
  const teams = [{ playerIds: ['a'] }, { playerIds: ['b'] }];
  assert.deepEqual(computeStandings([{ teams, winnerTeamIndex: null }]), []);
  assert.deepEqual(computeStandings([{ teams, winnerTeamIndex: null, isDraw: false }]), []);
  assert.deepEqual(computeStandings([{ teams, winnerTeamIndex: null, isDraw: true }]), [
    { playerId: 'a', points: 1, wins: 0, matchesPlayed: 1 },
    { playerId: 'b', points: 1, wins: 0, matchesPlayed: 1 },
  ]);
});

test('computeStandings aggregates across several matches', () => {
  const matches: MatchForScoring[] = [
    { teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: 0 },
    { teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: 1 },
    { teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: 0 },
  ];
  const standings = computeStandings(matches);
  const a = standings.find((s) => s.playerId === 'a')!;
  const b = standings.find((s) => s.playerId === 'b')!;
  assert.equal(a.matchesPlayed, 3);
  assert.equal(a.wins, 2);
  assert.equal(a.points, 7);
  assert.equal(b.wins, 1);
});

test('computeStandings sorts by points desc, then wins desc', () => {
  const matches: MatchForScoring[] = [
    { teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 },
  ];
  const standings = computeStandings(matches);
  assert.equal(standings[0].playerId, 'a');
});

test('computeStandings returns an empty list for no matches', () => {
  assert.deepEqual(computeStandings([]), []);
});

test('tournament placements add bonuses per team member without adding matches or wins', () => {
  const standings = computeStandings([
    { teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 },
  ], [
    { playerIds: ['a', 'b'], place: 1 },
    { playerIds: ['c'], place: 2 },
    { playerIds: ['d'], place: 3 },
    { playerIds: ['e'], place: 4 },
  ]);
  assert.deepEqual(standings, [
    { playerId: 'a', points: 8, wins: 1, matchesPlayed: 1 },
    { playerId: 'b', points: 8, wins: 1, matchesPlayed: 1 },
    { playerId: 'c', points: 4, wins: 0, matchesPlayed: 1 },
    { playerId: 'd', points: 1, wins: 0, matchesPlayed: 0 },
  ]);
});
