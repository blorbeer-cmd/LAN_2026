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
import { config } from './config';

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

test('sweepOnce refreshes every group that carries live rows, each under its own scope', () => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const fakeIo = { emit: (event: string, payload: unknown) => emitted.push({ event, payload }) };
  setIo(fakeIo as any);

  const groupA = nanoid();
  const groupB = nanoid();
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(groupA, 'Sweep A', Date.now());
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(groupB, 'Sweep B', Date.now());
  const playerA = nanoid();
  const playerB = nanoid();
  db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    playerA,
    'Sweep Player A',
    '#abcdef',
    nanoid(),
    Date.now()
  );
  db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    playerB,
    'Sweep Player B',
    '#abcdef',
    nanoid(),
    Date.now()
  );
  const now = Date.now();
  db.prepare(
    'INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, activity_tracked) VALUES (?, ?, NULL, ?, 0)'
  ).run(playerA, groupA, now);
  db.prepare(
    'INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, activity_tracked) VALUES (?, ?, NULL, ?, 0)'
  ).run(playerB, groupB, now);

  try {
    sweepOnce(now);
    const liveEvents = emitted.filter((entry) => entry.event === 'live:changed');
    // One board per group with live rows plus the always-included default group.
    assert.equal(liveEvents.length, 3);
  } finally {
    db.prepare('DELETE FROM tracking_live_contexts WHERE player_id IN (?, ?)').run(playerA, playerB);
    setIo(null as any);
  }
});

test('sweepOnce isolates group boards by actual required-mode recipient', () => {
  const originalAuthMode = config.authMode;
  (config as { authMode: 'legacy' | 'required' }).authMode = 'required';
  const groupA = nanoid();
  const groupB = nanoid();
  const playerA = nanoid();
  const playerB = nanoid();
  const now = Date.now();
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(groupA, 'Sweep Recipient A', now);
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(groupB, 'Sweep Recipient B', now);
  const insertPlayer = db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)');
  insertPlayer.run(playerA, 'Sweep Recipient Player A', '#abcdef', nanoid(), now);
  insertPlayer.run(playerB, 'Sweep Recipient Player B', '#fedcba', nanoid(), now);
  const insertMembership = db.prepare(
    `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'member', 'active', ?, 1)`,
  );
  insertMembership.run(groupA, playerA, now);
  insertMembership.run(groupB, playerB, now);
  db.prepare(
    'INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, activity_tracked) VALUES (?, ?, NULL, ?, 0)',
  ).run(playerA, groupA, now);
  db.prepare(
    'INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, activity_tracked) VALUES (?, ?, NULL, ?, 0)',
  ).run(playerB, groupB, now);

  const received = new Map<string, unknown[]>([['groupA', []], ['groupB', []], ['unscoped', []]]);
  const fakeSocket = (label: string, data: Record<string, unknown>) => ({
    data,
    emit(event: string, payload: unknown) {
      if (event === 'live:changed') received.get(label)!.push(payload);
    },
  });
  const globalEmits: string[] = [];
  const fakeIo = {
    emit(event: string) { globalEmits.push(event); },
    sockets: { sockets: new Map([
      ['groupA', fakeSocket('groupA', { groupId: groupA, authPlayerId: playerA })],
      ['groupB', fakeSocket('groupB', { groupId: groupB, authPlayerId: playerB })],
      ['unscoped', fakeSocket('unscoped', { authPlayerId: playerA })],
    ]) },
  };
  setIo(fakeIo as any);

  try {
    sweepOnce(now);
    assert.deepEqual(globalEmits, [], 'required-mode sweeps never fall back to a global emit');
    assert.equal(received.get('groupA')!.length, 1, 'group A receives exactly its board refresh');
    assert.equal(received.get('groupB')!.length, 1, 'group B receives exactly its board refresh');
    assert.equal(received.get('unscoped')!.length, 0, 'an unscoped socket receives no board');
    const boardA = received.get('groupA')![0] as Array<{ player_id: string }>;
    const boardB = received.get('groupB')![0] as Array<{ player_id: string }>;
    assert.ok(boardA.some((entry) => entry.player_id === playerA));
    assert.ok(!boardA.some((entry) => entry.player_id === playerB), 'group A board excludes group B players');
    assert.ok(boardB.some((entry) => entry.player_id === playerB));
    assert.ok(!boardB.some((entry) => entry.player_id === playerA), 'group B board excludes group A players');
  } finally {
    setIo(null);
    (config as { authMode: 'legacy' | 'required' }).authMode = originalAuthMode;
  }
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
