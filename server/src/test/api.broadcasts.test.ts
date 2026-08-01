// Integration tests for Durchsagen: validation, sender attribution, and the
// recent-history listing.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'socket.io';
import { createApp } from '../app';
import { Events, setIo } from '../realtime';

const app = createApp();
let playerId: string;
let otherPlayerId: string;
const emitted: Array<{ event: string; payload: unknown }> = [];

setIo({
  emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
  sockets: { sockets: new Map() },
} as unknown as Server);

after(() => setIo(null));

test('setup: a player', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Ansager' });
  playerId = res.body.id;
  const other = await request(app).post('/api/players').send({ name: 'Zuhörer' });
  otherPlayerId = other.body.id;
});

test('POST /api/broadcasts validates player and message', async () => {
  const noPlayer = await request(app).post('/api/broadcasts').send({ message: 'Hallo' });
  assert.equal(noPlayer.status, 400);

  const ghost = await request(app).post('/api/broadcasts').send({ playerId: 'ghost', message: 'Hallo' });
  assert.equal(ghost.status, 404);

  const empty = await request(app).post('/api/broadcasts').send({ playerId, message: '   ' });
  assert.equal(empty.status, 400);

  const tooLong = await request(app).post('/api/broadcasts').send({ playerId, message: 'x'.repeat(201) });
  assert.equal(tooLong.status, 400);

  const pastEnd = await request(app)
    .post('/api/broadcasts')
    .send({ playerId, message: 'Zu spät', endsAt: Date.now() - 1 });
  assert.equal(pastEnd.status, 400);

  const malformedEnd = await request(app)
    .post('/api/broadcasts')
    .send({ playerId, message: 'Kaputt', endsAt: 'morgen' });
  assert.equal(malformedEnd.status, 400);
});

test('POST /api/broadcasts defaults to one hour, stores the deadline, and lists newest first', async () => {
  emitted.length = 0;
  const before = Date.now();
  const first = await request(app).post('/api/broadcasts').send({ playerId, message: 'Essen ist da!' });
  const after = Date.now();
  assert.equal(first.status, 201);
  assert.equal(first.body.playerName, 'Ansager');
  assert.equal(first.body.message, 'Essen ist da!');
  assert.ok(first.body.endsAt >= before + 60 * 60 * 1000);
  assert.ok(first.body.endsAt <= after + 60 * 60 * 1000);
  assert.equal(first.body.active, true);
  assert.ok(first.body.pushLogId);
  assert.deepEqual(
    emitted.filter((entry) => entry.event === Events.broadcastNew).map((entry) => entry.payload),
    [{
      id: first.body.id,
      playerId,
      playerName: 'Ansager',
      message: 'Essen ist da!',
      endsAt: first.body.endsAt,
      createdAt: first.body.createdAt,
    }],
  );
  assert.equal(emitted.filter((entry) => entry.event === Events.pushSent).length, 1);

  const customEndsAt = Date.now() + 2 * 60 * 60 * 1000;
  await request(app)
    .post('/api/broadcasts')
    .send({ playerId, message: 'Turnier startet gleich', endsAt: customEndsAt });

  const list = await request(app).get('/api/broadcasts');
  assert.equal(list.status, 200);
  assert.ok(list.body.broadcasts.length >= 2);
  assert.equal(list.body.broadcasts[0].message, 'Turnier startet gleich');
  assert.equal(list.body.broadcasts[1].message, 'Essen ist da!');
  assert.equal(list.body.broadcasts[0].playerName, 'Ansager');
  assert.equal(list.body.broadcasts[0].endsAt, customEndsAt);
  assert.equal(list.body.broadcasts[0].active, true);
});

test('only the creator can end an active broadcast and ending is idempotently guarded', async () => {
  const created = await request(app).post('/api/broadcasts').send({ playerId, message: 'Nur kurz sichtbar' });
  assert.equal(created.status, 201);
  emitted.length = 0;

  const foreign = await request(app).post(`/api/broadcasts/${created.body.id}/end`).send({ playerId: otherPlayerId });
  assert.equal(foreign.status, 403);

  const ended = await request(app).post(`/api/broadcasts/${created.body.id}/end`).send({ playerId });
  assert.equal(ended.status, 200);
  assert.ok(ended.body.endedAt > 0);
  assert.deepEqual(
    emitted.filter((entry) => entry.event === Events.broadcastsChanged).map((entry) => entry.payload),
    [{ id: created.body.id, endedAt: ended.body.endedAt }],
  );

  const again = await request(app).post(`/api/broadcasts/${created.body.id}/end`).send({ playerId });
  assert.equal(again.status, 409);

  const list = await request(app).get('/api/broadcasts');
  const row = list.body.broadcasts.find((broadcast: { id: string }) => broadcast.id === created.body.id);
  assert.equal(row.active, false);
  assert.equal(row.endedAt, ended.body.endedAt);
});
