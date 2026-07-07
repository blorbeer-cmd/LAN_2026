import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlaySession } from './playtime';
import {
  computeTimeInHourWindow,
  sessionCountByPlayer,
  distinctGamesByPlayer,
  computeAwards,
} from './awards';

// A fixed local midnight to build predictable test timestamps from.
const DAY = new Date(2026, 6, 7, 0, 0, 0, 0).getTime(); // 2026-07-07 00:00 local
const HOUR = 3_600_000;

test('computeTimeInHourWindow counts a session fully inside the window', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: DAY + 1 * HOUR, endedAt: DAY + 2 * HOUR, activeMs: 0 },
  ];
  const result = computeTimeInHourWindow(sessions, DAY + 24 * HOUR, 0, 6);
  assert.equal(result.get('p1'), HOUR);
});

test('computeTimeInHourWindow handles an overnight window (22-6) spanning midnight', () => {
  // Session from 23:00 to 01:00 the next day.
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: DAY + 23 * HOUR, endedAt: DAY + 25 * HOUR, activeMs: 0 },
  ];
  const result = computeTimeInHourWindow(sessions, DAY + 48 * HOUR, 22, 6);
  assert.equal(result.get('p1'), 2 * HOUR);
});

test('computeTimeInHourWindow ignores time outside the window', () => {
  // Session from 10:00 to 12:00 — entirely outside the 0-6 night window.
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: DAY + 10 * HOUR, endedAt: DAY + 12 * HOUR, activeMs: 0 },
  ];
  const result = computeTimeInHourWindow(sessions, DAY + 24 * HOUR, 0, 6);
  assert.equal(result.get('p1') ?? 0, 0);
});

test('computeTimeInHourWindow sums across multiple nights', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: DAY + 1 * HOUR, endedAt: DAY + 2 * HOUR, activeMs: 0 },
    { playerId: 'p1', gameId: 'g1', startedAt: DAY + 25 * HOUR, endedAt: DAY + 27 * HOUR, activeMs: 0 },
  ];
  const result = computeTimeInHourWindow(sessions, DAY + 48 * HOUR, 0, 6);
  assert.equal(result.get('p1'), 3 * HOUR);
});

test('sessionCountByPlayer counts sessions per player', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 1, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 1, activeMs: 0 },
  ];
  const result = sessionCountByPlayer(sessions);
  assert.equal(result.get('p1'), 2);
  assert.equal(result.get('p2'), 1);
});

test('distinctGamesByPlayer counts unique games, not sessions', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1, activeMs: 0 },
    { playerId: 'p1', gameId: 'g1', startedAt: 2, endedAt: 3, activeMs: 0 }, // same game again
    { playerId: 'p1', gameId: 'g2', startedAt: 0, endedAt: 1, activeMs: 0 },
  ];
  const result = distinctGamesByPlayer(sessions);
  assert.equal(result.get('p1'), 2);
});

test('computeAwards returns an empty list for no sessions', () => {
  assert.deepEqual(computeAwards([], DAY), []);
});

test('computeAwards awards Marathon-Zocker to the single longest session', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 5000, activeMs: 0 },
  ];
  const awards = computeAwards(sessions, 9999);
  const marathon = awards.find((a) => a.id === 'marathon');
  assert.ok(marathon);
  assert.equal(marathon!.playerId, 'p2');
  assert.equal(marathon!.valueMs, 5000);
});

test('computeAwards awards Multitasking-Meister only when someone actually overlapped games', () => {
  const noOverlap: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 1000, endedAt: 2000, activeMs: 0 },
  ];
  assert.equal(
    computeAwards(noOverlap, 9999).find((a) => a.id === 'multitasker'),
    undefined
  );

  const withOverlap: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 },
    { playerId: 'p1', gameId: 'g2', startedAt: 500, endedAt: 1500, activeMs: 0 },
  ];
  const multitasker = computeAwards(withOverlap, 9999).find((a) => a.id === 'multitasker');
  assert.ok(multitasker);
  assert.equal(multitasker!.playerId, 'p1');
});

test('computeAwards skips Zappelphilipp/Allrounder when everyone only has 1 session/game', () => {
  const sessions: PlaySession[] = [{ playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 1000, activeMs: 0 }];
  const awards = computeAwards(sessions, 9999);
  assert.equal(awards.find((a) => a.id === 'zappelphilipp'), undefined);
  assert.equal(awards.find((a) => a.id === 'allrounder'), undefined);
});

test('computeAwards skips focus/AFK awards when fewer than 2 players have enough tracked playtime', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 20 * 60_000, activeMs: 15 * 60_000 },
  ];
  const awards = computeAwards(sessions, 9999);
  assert.equal(awards.find((a) => a.id === 'fokus'), undefined);
  assert.equal(awards.find((a) => a.id === 'afk'), undefined);
});

test('computeAwards picks the highest and lowest activity ratio for focus/AFK awards', () => {
  const sessions: PlaySession[] = [
    { playerId: 'p1', gameId: 'g1', startedAt: 0, endedAt: 20 * 60_000, activeMs: 18 * 60_000 }, // 90%
    { playerId: 'p2', gameId: 'g1', startedAt: 0, endedAt: 20 * 60_000, activeMs: 2 * 60_000 }, // 10%
  ];
  const awards = computeAwards(sessions, 9999);
  const fokus = awards.find((a) => a.id === 'fokus');
  const afk = awards.find((a) => a.id === 'afk');
  assert.equal(fokus!.playerId, 'p1');
  assert.equal(afk!.playerId, 'p2');
});
