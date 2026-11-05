import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCategoryStandings, type CategoryScoringInput } from './categoryScoring';

test('category places use the full N, shared competition ranks and only positive qualified raw scores', () => {
  const players: CategoryScoringInput[] = [20, 12, 12, 4, 0, -1, 0, 0].map((orga, index) => ({
    playerId: String(index), raw: { orga, playing: 0, betting: 0 }, bettingQualified: true,
  }));
  const scores = computeCategoryStandings(players);
  assert.deepEqual(scores.map((row) => row.categories.orga), [
    { raw: 20, rank: 1, placePoints: 8 },
    { raw: 12, rank: 2, placePoints: 7 },
    { raw: 12, rank: 2, placePoints: 7 },
    { raw: 4, rank: 4, placePoints: 5 },
    { raw: 0, rank: null, placePoints: 0 },
    { raw: -1, rank: null, placePoints: 0 },
    { raw: 0, rank: null, placePoints: 0 },
    { raw: 0, rank: null, placePoints: 0 },
  ]);
  assert.ok(scores.every((row) => row.categories.playing.rank === null));
  players[0].raw.betting = 100;
  players[0].bettingQualified = false;
  players[1].raw.betting = 5;
  const withBets = computeCategoryStandings(players);
  assert.deepEqual(withBets.find((row) => row.playerId === '0')!.categories.betting,
    { raw: 100, rank: null, placePoints: 0 });
  assert.deepEqual(withBets.find((row) => row.playerId === '1')!.categories.betting,
    { raw: 5, rank: 1, placePoints: 8 });
  assert.deepEqual(computeCategoryStandings([]), []);
});

test('overall scores sum category place points, preserve tied totals and never rescale inactive categories', () => {
  const players: CategoryScoringInput[] = [
    { playerId: 'a', raw: { orga: 8, playing: 4, betting: 0 }, bettingQualified: true },
    { playerId: 'b', raw: { orga: 4, playing: 8, betting: 0 }, bettingQualified: true },
    { playerId: 'c', raw: { orga: 1, playing: 1, betting: 0 }, bettingQualified: true },
  ];
  const scores = computeCategoryStandings(players);
  assert.deepEqual(scores.map(({ playerId, points, rank }) => ({ playerId, points, rank })), [
    { playerId: 'a', points: 5, rank: 1 }, { playerId: 'b', points: 5, rank: 1 },
    { playerId: 'c', points: 2, rank: 3 },
  ]);
  assert.deepEqual(computeCategoryStandings([...players].reverse()), scores);
  const leader = computeCategoryStandings([{ ...players[0], raw: { orga: 1, playing: 1, betting: 1 } }])[0];
  assert.equal(leader.points, 3, 'the maximum is three times N');
});
