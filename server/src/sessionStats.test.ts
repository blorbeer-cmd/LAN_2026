import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlaySession } from './playtime';
import {
  sessionDurations,
  longestSessionPerPlayerGame,
  longestSessionPerGame,
  longestSessionPerPlayer,
  computeSimultaneousGameTime,
  clipSessionsToRange,
  computeConcurrencyOverTime,
} from './sessionStats';

const NOW = 1_000_000;

test('sessionDurations sorts longest first and handles ongoing sessions', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: null, activeMs: 0 }, // ongoing, up to NOW
  ];
  const result = sessionDurations(sessions, NOW);
  assert.equal(result[0].playerId, 'p2');
  assert.equal(result[0].durationMs, NOW);
  assert.equal(result[1].durationMs, 1000);
});

test('longestSessionPerPlayerGame keeps only the top session per (player, game)', () => {
  const sorted = sessionDurations(
    [
      { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 5000, activeMs: 0 },
      { playerId: 'p1', gameId: 'g1', startedAt: 10_000, endedAt: 12_000, activeMs: 0 },
      { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 9000, activeMs: 0 },
    ],
    NOW
  );
  const result = longestSessionPerPlayerGame(sorted);
  assert.equal(result.length, 2);
  const g1Entry = result.find((r) => r.gameId === 'g1')!;
  assert.equal(g1Entry.durationMs, 5000);
});

test('longestSessionPerGame picks the record holder regardless of player', () => {
  const sorted = sessionDurations(
    [
      { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 3000, activeMs: 0 },
      { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 9000, activeMs: 0 },
    ],
    NOW
  );
  const result = longestSessionPerGame(sorted);
  assert.equal(result.length, 1);
  assert.equal(result[0].playerId, 'p2');
});

test('longestSessionPerPlayer picks each player\'s single best session across games', () => {
  const sorted = sessionDurations(
    [
      { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 3000, activeMs: 0 },
      { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 9000, activeMs: 0 },
    ],
    NOW
  );
  const result = longestSessionPerPlayer(sorted);
  assert.equal(result.length, 1);
  assert.equal(result[0].gameId, 'g2');
});

test('computeSimultaneousGameTime finds no overlap for sequential sessions', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 1000, endedAt: 2000, activeMs: 0 },
  ];
  const [result] = computeSimultaneousGameTime(sessions, NOW);
  assert.equal(result.multiGameMs, 0);
  assert.equal(result.maxSimultaneous, 1);
});

test('computeSimultaneousGameTime measures a partial overlap between two games', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 500, endedAt: 1500, activeMs: 0 },
  ];
  const [result] = computeSimultaneousGameTime(sessions, NOW);
  assert.equal(result.multiGameMs, 500); // overlap is [500, 1000]
  assert.equal(result.maxSimultaneous, 2);
});

test('computeSimultaneousGameTime detects a triple overlap', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 3000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 1000, endedAt: 3000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g3', startedAt: 2000, endedAt: 3000, activeMs: 0 },
  ];
  const [result] = computeSimultaneousGameTime(sessions, NOW);
  assert.equal(result.maxSimultaneous, 3);
  assert.equal(result.multiGameMs, 2000); // [1000,3000] has >=2 concurrent
});

test('computeSimultaneousGameTime keeps players separate', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
  ];
  const results = computeSimultaneousGameTime(sessions, NOW);
  assert.equal(results.length, 2);
  const p2 = results.find((r) => r.playerId === 'p2')!;
  assert.equal(p2.multiGameMs, 0);
});

test('clipSessionsToRange returns sessions unchanged when no range is given', () => {
  const sessions: PlaySession[] = [{ playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 100 }];
  assert.deepEqual(clipSessionsToRange(sessions, NOW), sessions);
});

test('clipSessionsToRange drops sessions entirely outside the range', () => {
  const sessions: PlaySession[] = [{ playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 100 }];
  assert.deepEqual(clipSessionsToRange(sessions, NOW, 2000, 3000), []);
});

test('clipSessionsToRange clips a session straddling the range boundary and prorates activeMs', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 1000 }, // fully active
  ];
  // Range covers only the second half [500, 1000].
  const [clipped] = clipSessionsToRange(sessions, NOW, 500, 1000);
  assert.equal(clipped.startedAt, 500);
  assert.equal(clipped.endedAt, 1000);
  assert.equal(clipped.activeMs, 500); // half the session -> half the active time
});

test('clipSessionsToRange handles an ongoing session against "to now"', () => {
  const sessions: PlaySession[] = [{ playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: null, activeMs: 0 }];
  const [clipped] = clipSessionsToRange(sessions, NOW, 0, 500);
  assert.equal(clipped.endedAt, 500);
});

test('computeConcurrencyOverTime buckets overlapping sessions correctly', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1500, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 1000, endedAt: 2500, activeMs: 0 },
  ];
  // Buckets: [0,1000) -> just p1 (1); [1000,2000) -> both (2); [2000,3000) -> just p2 (1)
  const buckets = computeConcurrencyOverTime(sessions, 0, 3000, 1000, NOW);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[0].count, 1);
  assert.equal(buckets[1].count, 2);
  assert.equal(buckets[2].count, 1);
});

test('computeConcurrencyOverTime returns 0 counts for buckets with nothing running', () => {
  const buckets = computeConcurrencyOverTime([], 0, 2000, 1000, NOW);
  assert.deepEqual(
    buckets.map((b) => b.count),
    [0, 0]
  );
});
