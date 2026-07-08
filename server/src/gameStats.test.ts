import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCountsByGame, biggestRivalry, bestDuo, biggestUnderdogWin, type MatchForStats, type MatchForUnderdog } from './gameStats';

test('matchCountsByGame tallies total/decided/undecided per game, sorted by total desc', () => {
  const matches: MatchForStats[] = [
    { gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: 0 },
    { gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: null },
    { gameId: 'g2', teams: [{ playerIds: ['c'] }, { playerIds: ['d'] }], winnerTeamIndex: 1 },
  ];
  const counts = matchCountsByGame(matches);
  assert.deepEqual(counts[0], { gameId: 'g1', count: 2, decided: 1, undecided: 1 });
  assert.deepEqual(counts[1], { gameId: 'g2', count: 1, decided: 1, undecided: 0 });
});

test('biggestRivalry finds the opponent pair with the most 2-team encounters', () => {
  const matches: MatchForStats[] = [
    { gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: 0 },
    { gameId: 'g1', teams: [{ playerIds: ['b'] }, { playerIds: ['a'] }], winnerTeamIndex: 0 }, // same pair, sides swapped
    { gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['c'] }], winnerTeamIndex: null },
  ];
  const rivalry = biggestRivalry(matches);
  assert.ok(rivalry);
  assert.equal(rivalry!.count, 2);
  assert.deepEqual([rivalry!.playerAId, rivalry!.playerBId].sort(), ['a', 'b']);
});

test('biggestRivalry skips matches with more than 2 teams', () => {
  const matches: MatchForStats[] = [
    { gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 },
  ];
  assert.equal(biggestRivalry(matches), null);
});

test('biggestRivalry returns null with no 2-team matches', () => {
  assert.equal(biggestRivalry([]), null);
});

test('bestDuo finds the teammate pair with the most shared matches, win rate as tiebreak', () => {
  const matches: MatchForStats[] = [
    { gameId: 'g1', teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 },
    { gameId: 'g1', teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['c'] }], winnerTeamIndex: 1 },
    { gameId: 'g1', teams: [{ playerIds: ['a', 'c'] }, { playerIds: ['b'] }], winnerTeamIndex: 0 },
  ];
  const duo = bestDuo(matches);
  assert.ok(duo);
  assert.deepEqual([duo!.playerAId, duo!.playerBId].sort(), ['a', 'b']);
  assert.equal(duo!.gamesTogether, 2);
  assert.equal(duo!.winsTogether, 1);
});

test('bestDuo breaks a tie in games-together by win rate', () => {
  const matches: MatchForStats[] = [
    // a+b: 1 game, 1 win (100%)
    { gameId: 'g1', teams: [{ playerIds: ['a', 'b'] }, { playerIds: ['x'] }], winnerTeamIndex: 0 },
    // c+d: 1 game, 0 wins (0%)
    { gameId: 'g1', teams: [{ playerIds: ['c', 'd'] }, { playerIds: ['y'] }], winnerTeamIndex: 1 },
  ];
  const duo = bestDuo(matches);
  assert.deepEqual([duo!.playerAId, duo!.playerBId].sort(), ['a', 'b']);
});

test('biggestUnderdogWin finds the largest rating gap a winner overcame', () => {
  const ratings: Record<string, number> = { strong: 9, weak: 2, mid: 5 };
  const ratingOf = (playerId: string) => ratings[playerId] ?? 5;
  const matches: MatchForUnderdog[] = [
    { id: 'm1', gameId: 'g1', teams: [{ playerIds: ['weak'] }, { playerIds: ['strong'] }], winnerTeamIndex: 0 }, // huge upset
    { id: 'm2', gameId: 'g1', teams: [{ playerIds: ['mid'] }, { playerIds: ['mid'] }], winnerTeamIndex: 0 }, // no gap
    { id: 'm3', gameId: 'g1', teams: [{ playerIds: ['strong'] }, { playerIds: ['weak'] }], winnerTeamIndex: 0 }, // favorite won, not an upset
  ];
  const result = biggestUnderdogWin(matches, ratingOf);
  assert.ok(result);
  assert.equal(result!.matchId, 'm1');
  assert.equal(result!.gap, 7);
});

test('biggestUnderdogWin ignores undecided and non-2-team matches', () => {
  const ratingOf = () => 5;
  const matches: MatchForUnderdog[] = [
    { id: 'm1', gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }], winnerTeamIndex: null },
    { id: 'm2', gameId: 'g1', teams: [{ playerIds: ['a'] }, { playerIds: ['b'] }, { playerIds: ['c'] }], winnerTeamIndex: 0 },
  ];
  assert.equal(biggestUnderdogWin(matches, ratingOf), null);
});
