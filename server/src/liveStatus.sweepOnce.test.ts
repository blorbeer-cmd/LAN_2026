import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from './db';
import { setIo } from './realtime';
import { sweepOnce } from './liveStatus';
import { ensureAccountEventContext, setActiveEventForPlayer } from './eventContext';

function createScopedPlayer(name: string, eventId = BASE_EVENT_ID): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    '#abcdef',
    nanoid(),
    now,
  );
  db.prepare(
    `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'member', 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, id, now);
  ensureAccountEventContext(id);
  if (eventId !== BASE_EVENT_ID) {
    db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(eventId, id);
    assert.ok(setActiveEventForPlayer(id, eventId));
  }
  return id;
}

function createEvent(name: string): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, ?, 'published', 'participants')`,
  ).run(id, name, now, now + 60_000, DEFAULT_GROUP_ID);
  return id;
}

test('sweepOnce broadcasts the base-event board to a matching authenticated socket', () => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const playerId = createScopedPlayer('SweepOnce Player');
  const fakeIo = {
    emit() { throw new Error('event broadcasts must never use io.emit'); },
    sockets: { sockets: new Map([['player', {
      data: { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID, authPlayerId: playerId },
      emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    }]]) },
  };
  setIo(fakeIo as any);
  try {
    sweepOnce(Date.now());
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, 'live:changed');
    assert.ok((emitted[0].payload as Array<{ player_id: string }>).some((entry) => entry.player_id === playerId));
  } finally {
    setIo(null);
  }
});

test('sweepOnce isolates simultaneous personal event workspaces', () => {
  const eventA = createEvent('Sweep Event A');
  const eventB = createEvent('Sweep Event B');
  const playerA = createScopedPlayer('Sweep Player A', eventA);
  const playerB = createScopedPlayer('Sweep Player B', eventB);
  const receivedA: unknown[] = [];
  const receivedB: unknown[] = [];
  const fakeSocket = (playerId: string, eventId: string, target: unknown[]) => ({
    data: { groupId: DEFAULT_GROUP_ID, eventId, authPlayerId: playerId },
    emit(event: string, payload: unknown) {
      if (event === 'live:changed') target.push(payload);
    },
  });
  const fakeIo = {
    emit() { throw new Error('event broadcasts must never use io.emit'); },
    sockets: { sockets: new Map([
      ['a', fakeSocket(playerA, eventA, receivedA)],
      ['b', fakeSocket(playerB, eventB, receivedB)],
    ]) },
  };
  setIo(fakeIo as any);
  try {
    sweepOnce(Date.now());
    assert.equal(receivedA.length, 1);
    assert.equal(receivedB.length, 1);
    const boardA = receivedA[0] as Array<{ player_id: string }>;
    const boardB = receivedB[0] as Array<{ player_id: string }>;
    assert.ok(boardA.some((entry) => entry.player_id === playerA));
    assert.ok(!boardA.some((entry) => entry.player_id === playerB));
    assert.ok(boardB.some((entry) => entry.player_id === playerB));
    assert.ok(!boardB.some((entry) => entry.player_id === playerA));
  } finally {
    setIo(null);
  }
});

test('sweepOnce swallows and logs cleanup errors', () => {
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (() => { throw new Error('boom'); }) as typeof db.prepare;
  const originalConsoleError = console.error;
  let logged = false;
  console.error = () => { logged = true; };
  try {
    assert.doesNotThrow(() => sweepOnce(Date.now()));
    assert.equal(logged, true);
  } finally {
    db.prepare = originalPrepare;
    console.error = originalConsoleError;
  }
});
