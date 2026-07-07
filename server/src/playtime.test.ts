import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlaytime, formatDurationMs, type PlaySession } from './playtime';

test('computePlaytime sums a single closed session', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 1000, endedAt: 4000 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result.length, 1);
  assert.equal(result[0].totalMs, 3000);
});

test('computePlaytime counts an ongoing session (endedAt null) up to now', () => {
  const sessions: PlaySession[] = [{ playerId: 'p1', gameId: 'g1', startedAt: 1000, endedAt: null }];
  const result = computePlaytime(sessions, 5000);
  assert.equal(result[0].totalMs, 4000);
});

test('computePlaytime aggregates multiple sessions of the same player+game', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000 },
    { playerId: 'p1', gameId: 'g1', startedAt: 2000, endedAt: 5000 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result.length, 1);
  assert.equal(result[0].totalMs, 1000 + 3000);
});

test('computePlaytime keeps different players/games separate', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 2000 },
    { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 3000 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result.length, 3);
});

test('computePlaytime sorts descending by total time', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 5000 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result[0].playerId, 'p2');
});

test('computePlaytime returns an empty list for no sessions', () => {
  assert.deepEqual(computePlaytime([], 1234), []);
});

test('formatDurationMs formats minutes-only durations', () => {
  assert.equal(formatDurationMs(45 * 60000), '45m');
});

test('formatDurationMs formats hours+minutes', () => {
  assert.equal(formatDurationMs(135 * 60000), '2h 15m');
});

test('formatDurationMs rounds to the nearest minute', () => {
  assert.equal(formatDurationMs(59_500), '1m');
});
