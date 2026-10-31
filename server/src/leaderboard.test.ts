import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, type MatchForScoring } from './leaderboard';

test('computeStandings gives each winner four total points and every other team member one point', () => {
  const matches: MatchForScoring[] = [
    {
      teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c', 'd'] }, { playerIds: ['e'] }, { playerIds: ['f'] }],
      winnerTeamIndex: 0,
    },
  ];
  const standings = computeStandings(matches);
  const byId = new Map(standings.map((s) => [s.playerId, s]));

  assert.equal(byId.get('a')!.points, 4);
  assert.equal(byId.get('b')!.points, 4);
  assert.equal(byId.get('a')!.wins, 1);
  assert.equal(byId.get('c')!.points, 1);
  assert.equal(byId.get('c')!.wins, 0);
  assert.equal(byId.get('e')!.points, 1);
  assert.equal(byId.get('f')!.points, 1);
});

test('computeStandings ignores missing results but counts explicit draws', () => {
  const teams = [{ playerIds: ['a'] }, { playerIds: ['b'] }];
  assert.deepEqual(computeStandings([{ teams, winnerTeamIndex: null }]), []);
  assert.deepEqual(computeStandings([{ teams, winnerTeamIndex: null, isDraw: false }]), []);
  assert.deepEqual(
    computeStandings([
      {
        teams: [
          { playerIds: ['a'], rank: 1 },
          { playerIds: ['b'], rank: null },
        ],
        winnerTeamIndex: null,
      },
    ]),
    [],
    'partial placements alone do not establish a complete result',
  );
  assert.deepEqual(computeStandings([{ teams, winnerTeamIndex: null, isDraw: true }]), [
    { playerId: 'a', points: 2, wins: 0, matchesPlayed: 1 },
    { playerId: 'b', points: 2, wins: 0, matchesPlayed: 1 },
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
  assert.equal(a.points, 9);
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
  const standings = computeStandings(
    [{ teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 }],
    [
      { playerIds: ['a', 'b'], place: 1 },
      { playerIds: ['c'], place: 2 },
      { playerIds: ['d'], place: 3 },
      { playerIds: ['e'], place: 4 },
    ],
  );
  assert.deepEqual(standings, [
    { playerId: 'a', points: 9, wins: 1, matchesPlayed: 1 },
    { playerId: 'b', points: 9, wins: 1, matchesPlayed: 1 },
    { playerId: 'c', points: 4, wins: 0, matchesPlayed: 1 },
    { playerId: 'd', points: 1, wins: 0, matchesPlayed: 0 },
  ]);
});

test('placements use occupied positions, last-place points and floored tie averages for every team member', () => {
  const cases = [
    { ranks: [1, 2], points: [4, 1] },
    { ranks: [1, 2, 3], points: [4, 3, 1] },
    { ranks: [1, 2, 3, 4], points: [4, 3, 2, 1] },
    { ranks: [1, 2, 3, 4, 5, 6, 7, 8], points: [4, 3, 2, 1, 1, 1, 1, 1] },
    { ranks: [1, 1], points: [2, 2] },
    { ranks: [1, 1, 3], points: [3, 3, 1] },
    { ranks: [1, 1, 3, 4], points: [3, 3, 2, 1] },
    { ranks: [1, 2, 3, 3], points: [4, 3, 1, 1] },
    { ranks: [2, 1, 2, 4], points: [2, 4, 2, 1], winnerTeamIndex: 0 },
  ];
  for (const { ranks, points, winnerTeamIndex = null } of cases) {
    const teams = ranks.map((rank, index) => ({ playerIds: [`${index}a`, `${index}b`], rank }));
    const standings = computeStandings([{ teams, winnerTeamIndex }]);
    const byId = new Map(standings.map((standing) => [standing.playerId, standing]));
    teams.forEach((team, index) => {
      for (const playerId of team.playerIds) {
        assert.deepEqual(
          byId.get(playerId),
          {
            playerId,
            points: points[index],
            wins: points[index] === 4 ? 1 : 0,
            matchesPlayed: 1,
          },
          `ranks ${ranks}, player ${playerId}`,
        );
      }
    });
  }
  const drawnTeams = Array.from({ length: 8 }, (_, index) => ({ playerIds: [String(index)] }));
  assert.deepEqual(
    computeStandings([{ teams: drawnTeams, winnerTeamIndex: null, isDraw: true }]).map((standing) => standing.points),
    [1, 1, 1, 1, 1, 1, 1, 1],
    'a complete draw shares all occupied places, including the last place',
  );
});
