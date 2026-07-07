import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBracket,
  applyBracketResult,
  bracketIsComplete,
  generateRoundRobin,
  computeRoundRobinStandings,
  type BracketMatchSlot,
} from './tournament';

test('generateBracket with a power-of-two team count has no byes', () => {
  const matches = generateBracket(['a', 'b', 'c', 'd']);
  const round1 = matches.filter((m) => m.round === 1);
  assert.equal(round1.length, 2);
  assert.ok(round1.every((m) => !m.isBye));
  const round2 = matches.filter((m) => m.round === 2);
  assert.equal(round2.length, 1);
  assert.equal(round2[0].teamAId, null);
  assert.equal(round2[0].teamBId, null);
});

test('generateBracket pads to the next power of two and auto-resolves byes', () => {
  const matches = generateBracket(['a', 'b', 'c']); // -> bracket size 4, one bye
  const round1 = matches.filter((m) => m.round === 1);
  assert.equal(round1.length, 2);
  const byes = round1.filter((m) => m.isBye);
  assert.equal(byes.length, 1);
  assert.ok(byes[0].winnerTeamId); // bye auto-resolves to whichever team was present

  // The bye's winner should already be sitting in the final, waiting.
  const final = matches.find((m) => m.round === 2)!;
  const byeWinner = byes[0].winnerTeamId;
  assert.ok(final.teamAId === byeWinner || final.teamBId === byeWinner);
});

test('generateBracket with 5 teams pads to 8 and gives exactly 3 byes', () => {
  const matches = generateBracket(['a', 'b', 'c', 'd', 'e']);
  const round1 = matches.filter((m) => m.round === 1);
  assert.equal(round1.length, 4);
  assert.equal(round1.filter((m) => m.isBye).length, 3);
  // 3 rounds total for a size-8 bracket (quarter, semi, final).
  assert.deepEqual([...new Set(matches.map((m) => m.round))].sort(), [1, 2, 3]);
});

test('generateBracket rejects fewer than 2 teams', () => {
  assert.throws(() => generateBracket(['solo']));
});

test('applyBracketResult advances the winner into the correct next-round slot', () => {
  // Standard balanced seeding for 4 teams pairs slot0 = seed1 v seed4 (a v
  // d) and slot1 = seed2 v seed3 (b v c) — verified by the round1 contents
  // below rather than assumed, so this stays correct if the seeding scheme
  // ever changes.
  let matches = generateBracket(['a', 'b', 'c', 'd']);
  const [m0, m1] = matches.filter((m) => m.round === 1).sort((x, y) => x.slot - y.slot);
  const winner0 = m0.teamAId!;
  const winner1 = m1.teamBId!;
  matches = applyBracketResult(matches, 1, m0.slot, winner0);
  matches = applyBracketResult(matches, 1, m1.slot, winner1);

  const final = matches.find((m) => m.round === 2)!;
  assert.equal(final.teamAId, winner0); // slot0 winner -> teamA
  assert.equal(final.teamBId, winner1); // slot1 winner -> teamB
});

test('applyBracketResult rejects a winner that is not actually in the match', () => {
  const matches = generateBracket(['a', 'b', 'c', 'd']);
  assert.throws(() => applyBracketResult(matches, 1, 0, 'z'));
});

test('applyBracketResult rejects recording a result before both teams are known', () => {
  const matches = generateBracket(['a', 'b', 'c', 'd']);
  // Round 2's teams aren't determined yet.
  assert.throws(() => applyBracketResult(matches, 2, 0, 'a'));
});

test('applyBracketResult rejects recording a result for a bye', () => {
  const matches = generateBracket(['a', 'b', 'c']);
  const bye = matches.find((m) => m.round === 1 && m.isBye)!;
  assert.throws(() => applyBracketResult(matches, bye.round, bye.slot, bye.winnerTeamId!));
});

test('bracketIsComplete is false until the final has a winner', () => {
  let matches = generateBracket(['a', 'b', 'c', 'd']);
  assert.equal(bracketIsComplete(matches), false);
  const [m0, m1] = matches.filter((m) => m.round === 1).sort((x, y) => x.slot - y.slot);
  const winner0 = m0.teamAId!;
  const winner1 = m1.teamBId!;
  matches = applyBracketResult(matches, 1, m0.slot, winner0);
  matches = applyBracketResult(matches, 1, m1.slot, winner1);
  assert.equal(bracketIsComplete(matches), false);
  matches = applyBracketResult(matches, 2, 0, winner0);
  assert.equal(bracketIsComplete(matches), true);
});

test('generateRoundRobin (single leg) has every pair meet exactly once', () => {
  const teams = ['a', 'b', 'c', 'd'];
  const fixtures = generateRoundRobin(teams, false);
  assert.equal(fixtures.length, 6); // C(4,2)
  const pairKey = (f: { teamAId: string; teamBId: string }) => [f.teamAId, f.teamBId].sort().join('-');
  const keys = fixtures.map(pairKey);
  assert.equal(new Set(keys).size, 6); // all unique pairs
  // Each round should have exactly n/2 matches and no repeated team.
  const byRound = new Map<number, typeof fixtures>();
  for (const f of fixtures) byRound.set(f.round, [...(byRound.get(f.round) ?? []), f]);
  for (const [, roundFixtures] of byRound) {
    const teamsThisRound = roundFixtures.flatMap((f) => [f.teamAId, f.teamBId]);
    assert.equal(new Set(teamsThisRound).size, teamsThisRound.length);
  }
});

test('generateRoundRobin handles an odd team count via a bye round for each team', () => {
  const teams = ['a', 'b', 'c'];
  const fixtures = generateRoundRobin(teams, false);
  assert.equal(fixtures.length, 3); // C(3,2)
  const pairKey = (f: { teamAId: string; teamBId: string }) => [f.teamAId, f.teamBId].sort().join('-');
  assert.equal(new Set(fixtures.map(pairKey)).size, 3);
});

test('generateRoundRobin twoLegged doubles the fixtures with swapped sides', () => {
  const teams = ['a', 'b', 'c', 'd'];
  const single = generateRoundRobin(teams, false);
  const double = generateRoundRobin(teams, true);
  assert.equal(double.length, single.length * 2);

  const secondLeg = double.slice(single.length);
  for (let i = 0; i < single.length; i++) {
    assert.equal(secondLeg[i].teamAId, single[i].teamBId);
    assert.equal(secondLeg[i].teamBId, single[i].teamAId);
  }
});

test('generateRoundRobin rejects fewer than 2 teams', () => {
  assert.throws(() => generateRoundRobin(['solo'], false));
});

test('computeRoundRobinStandings tallies wins, draws, losses and points', () => {
  const standings = computeRoundRobinStandings(['a', 'b', 'c'], [
    { teamAId: 'a', teamBId: 'b', winnerTeamId: 'a' },
    { teamAId: 'a', teamBId: 'c', winnerTeamId: null }, // draw
    { teamAId: 'b', teamBId: 'c', winnerTeamId: 'c' },
  ]);

  const byId = new Map(standings.map((s) => [s.teamId, s]));
  assert.equal(byId.get('a')!.points, 4); // win(3) + draw(1)
  assert.equal(byId.get('a')!.wins, 1);
  assert.equal(byId.get('a')!.draws, 1);
  assert.equal(byId.get('b')!.points, 0); // loss + loss
  assert.equal(byId.get('b')!.losses, 2);
  assert.equal(byId.get('c')!.points, 4); // draw(1) + win(3)

  // Sorted by points desc.
  assert.deepEqual(standings.map((s) => s.teamId).slice(0, 2).sort(), ['a', 'c']);
});

test('computeRoundRobinStandings includes teams with zero games played', () => {
  const standings = computeRoundRobinStandings(['a', 'b'], []);
  assert.equal(standings.length, 2);
  assert.ok(standings.every((s) => s.played === 0 && s.points === 0));
});

// Sanity check that the two pure modules agree on shape when chained: a
// fully-played 4-team bracket ends with exactly one champion.
test('a fully played bracket has exactly one team with no losses recorded against them in the final', () => {
  let matches: BracketMatchSlot[] = generateBracket(['a', 'b', 'c', 'd']);
  matches = applyBracketResult(matches, 1, 0, 'a');
  matches = applyBracketResult(matches, 1, 1, 'c');
  matches = applyBracketResult(matches, 2, 0, 'a');
  assert.equal(bracketIsComplete(matches), true);
  const champion = matches.find((m) => m.round === 2)!.winnerTeamId;
  assert.equal(champion, 'a');
});
