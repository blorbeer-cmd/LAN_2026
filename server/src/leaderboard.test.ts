import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, WIN_POINTS, PARTICIPATION_POINTS, type MatchForScoring } from './leaderboard';

test('computeStandings gives participation points to everyone and win points to the winning team', () => {
  const matches: MatchForScoring[] = [
    { teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c', 'd'] }], winnerTeamIndex: 0 },
  ];
  const standings = computeStandings(matches);
  const byId = new Map(standings.map((s) => [s.playerId, s]));

  assert.equal(byId.get('a')!.points, WIN_POINTS + PARTICIPATION_POINTS);
  assert.equal(byId.get('a')!.wins, 1);
  assert.equal(byId.get('c')!.points, PARTICIPATION_POINTS);
  assert.equal(byId.get('c')!.wins, 0);
});

test('computeStandings handles a match with no winner (draw / not decided)', () => {
  const matches: MatchForScoring[] = [
    { teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: null },
  ];
  const standings = computeStandings(matches);
  for (const s of standings) {
    assert.equal(s.points, PARTICIPATION_POINTS);
    assert.equal(s.wins, 0);
  }
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
  assert.equal(a.points, 2 * WIN_POINTS + 3 * PARTICIPATION_POINTS);
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
