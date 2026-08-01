// Integration tests for Durchsagen: validation, sender attribution, and the
// recent-history listing.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'socket.io';
import { createApp } from '../app';
import { db, DEFAULT_GROUP_ID } from '../db';
import { setPushMute } from '../push';
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

test('legacy event broadcasts enforce recipients and mutes while preserving a kiosk-only entry', async () => {
  const event = await request(app)
    .post('/api/events')
    .send({ name: 'Stumme Event-Durchsage', startsAt: Date.now(), endsAt: Date.now() + 60_000 });
  assert.equal(event.status, 201);
  const roster = await request(app)
    .put(`/api/events/${event.body.id}/participants`)
    .send({ playerIds: [playerId] });
  assert.equal(roster.status, 200);
  setPushMute(DEFAULT_GROUP_ID, playerId, event.body.id, true);
  emitted.length = 0;

  try {
    const sent = await request(app)
      .post('/api/broadcasts')
      .send({ playerId, eventId: event.body.id, message: 'Nur der Kiosk darf das zeigen' });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.ok(sent.body.pushLogId, 'an all-audience message keeps its kiosk log entry');
    assert.equal(emitted.filter((entry) => entry.event === Events.broadcastNew).length, 0);
    assert.equal(emitted.filter((entry) => entry.event === Events.pushSent).length, 1);
    const push = db.prepare('SELECT player_ids AS playerIds FROM push_log WHERE id = ?').get(sent.body.pushLogId) as {
      playerIds: string;
    };
    assert.deepEqual(JSON.parse(push.playerIds), [], 'muted players are absent from personal and Web Push delivery');
  } finally {
    setPushMute(DEFAULT_GROUP_ID, playerId, event.body.id, false);
  }
});

test('an event without participants still creates its kiosk banner', async () => {
  const event = await request(app)
    .post('/api/events')
    .send({ name: 'Leeres Event', startsAt: Date.now(), endsAt: Date.now() + 60_000 });
  assert.equal(event.status, 201);
  emitted.length = 0;

  const sent = await request(app)
    .post('/api/broadcasts')
    .send({ playerId, eventId: event.body.id, message: 'Kiosk ohne Teilnehmer' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.ok(sent.body.pushLogId);
  assert.equal(emitted.filter((entry) => entry.event === Events.broadcastNew).length, 0);
  assert.equal(emitted.filter((entry) => entry.event === Events.pushSent).length, 1);
  const push = db
    .prepare('SELECT event_id AS eventId, player_ids AS playerIds FROM push_log WHERE id = ?')
    .get(sent.body.pushLogId) as { eventId: string; playerIds: string };
  assert.equal(push.eventId, event.body.id);
  assert.deepEqual(JSON.parse(push.playerIds), []);
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
  assert.deepEqual(
    emitted.filter((entry) => entry.event === Events.pushChanged).map((entry) => entry.payload),
    [{ groupId: DEFAULT_GROUP_ID }],
  );

  const again = await request(app).post(`/api/broadcasts/${created.body.id}/end`).send({ playerId });
  assert.equal(again.status, 409);

  const list = await request(app).get('/api/broadcasts');
  const row = list.body.broadcasts.find((broadcast: { id: string }) => broadcast.id === created.body.id);
  assert.equal(row.active, false);
  assert.equal(row.endedAt, ended.body.endedAt);
});
