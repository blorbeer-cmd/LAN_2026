// Tests the sweeper's per-tick behavior in isolation from the real timer:
// startOfflineSweeper() itself just wires sweepOnce() into setInterval, so
// exercising sweepOnce() directly proves the tick logic without waiting on
// wall-clock time. Two things matter here: it must actually broadcast the
// refreshed board, and a thrown error inside must never escape (an
// unhandled exception in a setInterval callback kills the whole process —
// exactly what must never happen on a friend's PC during a 3-day LAN).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { db } from './db';
import { setIo } from './realtime';
import { sweepOnce } from './liveStatus';

test('sweepOnce broadcasts the live board via io.emit', () => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const fakeIo = { emit: (event: string, payload: unknown) => emitted.push({ event, payload }) };
  setIo(fakeIo as any);

  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    playerId,
    'SweepOnce Player',
    '#abcdef',
    nanoid(),
    Date.now()
  );

  sweepOnce(Date.now());

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, 'live:changed');
  assert.ok(Array.isArray(emitted[0].payload));
  assert.ok((emitted[0].payload as unknown[]).some((e: any) => e.player_id === playerId));

  setIo(null as any);
});

test('sweepOnce swallows an error thrown while closing stale sessions', () => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const fakeIo = { emit: (event: string, payload: unknown) => emitted.push({ event, payload }) };
  setIo(fakeIo as any);

  // Shadow the instance method so the first query inside closeStaleSessions
  // throws, proving sweepOnce()'s try/catch actually catches — a silent
  // no-op (e.g. NaN just matching zero rows) wouldn't prove anything.
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (() => {
    throw new Error('boom');
  }) as typeof db.prepare;

  const originalConsoleError = console.error;
  let loggedError = false;
  console.error = () => {
    loggedError = true;
  };

  try {
    assert.doesNotThrow(() => sweepOnce(Date.now()));
    assert.equal(loggedError, true, 'the caught error should be logged');
    assert.equal(emitted.length, 0, 'broadcast must not fire after the query threw');
  } finally {
    db.prepare = originalPrepare;
    console.error = originalConsoleError;
    setIo(null as any);
  }
});
