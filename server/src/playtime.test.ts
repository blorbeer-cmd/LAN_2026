import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePlaytime,
  aggregateByGame,
  formatDurationMs,
  type PlaySession,
  type PlaytimeEntry,
} from './playtime';

test('computePlaytime sums a single closed session', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 1000, endedAt: 4000, activeMs: 0 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result.length, 1);
  assert.equal(result[0].totalMs, 3000);
});

test('computePlaytime counts an ongoing session (endedAt null) up to now', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 1000, endedAt: null, activeMs: 0 },
  ];
  const result = computePlaytime(sessions, 5000);
  assert.equal(result[0].totalMs, 4000);
});

test('computePlaytime aggregates multiple sessions of the same player+game', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g1', startedAt: 2000, endedAt: 5000, activeMs: 0 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result.length, 1);
  assert.equal(result[0].totalMs, 1000 + 3000);
});

test('computePlaytime keeps different players/games separate', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 2000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 3000, activeMs: 0 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result.length, 3);
});

test('computePlaytime sorts descending by total time', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 5000, activeMs: 0 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result[0].playerId, 'p2');
});

test('computePlaytime returns an empty list for no sessions', () => {
  assert.deepEqual(computePlaytime([], 1234), []);
});

test('computePlaytime sums activeMs alongside totalMs', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 10_000, activeMs: 3000 },
    { playerId: 'p1', gameId: 'g1', startedAt: 20_000, endedAt: 30_000, activeMs: 4000 },
  ];
  const result = computePlaytime(sessions, 99_999);
  assert.equal(result[0].totalMs, 20_000);
  assert.equal(result[0].activeMs, 7000);
});

test('computePlaytime clamps activeMs so it never exceeds totalMs', () => {
  // Defensive: activeMs should never legitimately exceed the session's own
  // duration, but clamp anyway in case of clock/rounding quirks upstream.
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 5000 },
  ];
  const result = computePlaytime(sessions, 9999);
  assert.equal(result[0].activeMs, 1000);
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

test('aggregateByGame sums across all players for the same game', () => {
  const entries: PlaytimeEntry[] = [
    { playerId: 'p1', gameId: 'g1', totalMs: 1000, activeMs: 500 },
    { playerId: 'p2', gameId: 'g1', totalMs: 2000, activeMs: 1000 },
    { playerId: 'p1', gameId: 'g2', totalMs: 500, activeMs: 0 },
  ];
  const result = aggregateByGame(entries);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.find((r) => r.gameId === 'g1'),
    { gameId: 'g1', totalMs: 3000, activeMs: 1500 }
  );
});

test('aggregateByGame sorts descending by total time', () => {
  const entries: PlaytimeEntry[] = [
    { playerId: 'p1', gameId: 'g1', totalMs: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', totalMs: 5000, activeMs: 0 },
  ];
  const result = aggregateByGame(entries);
  assert.equal(result[0].gameId, 'g2');
});

test('aggregateByGame returns an empty list for no entries', () => {
  assert.deepEqual(aggregateByGame([]), []);
});
