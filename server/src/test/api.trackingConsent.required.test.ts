import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { nanoid } from 'nanoid';
import request from 'supertest';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import { config } from '../config';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from '../db';
import { createSocketAuthGuard, Events, registerArcadeKioskSockets, setIo } from '../realtime';
import { createSession, SESSION_COOKIE_NAME } from '../sessions';

const originalAuthMode = config.authMode;

before(() => {
  (config as { authMode: 'legacy' | 'required' }).authMode = 'required';
});

after(() => {
  (config as { authMode: 'legacy' | 'required' }).authMode = originalAuthMode;
});

function connect(baseUrl: string, sessionToken: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function subscribe(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit('scope:subscribe', { groupId: DEFAULT_GROUP_ID }, (result: { ok: boolean; error?: string }) => {
      if (result.ok) resolve();
      else reject(new Error(result.error));
    });
  });
}

function nextLiveChange(socket: ClientSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('live:changed was not delivered')), 2_000);
    socket.once(Events.liveStatusChanged, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

test('required-auth tracking consent is self-only, idempotent and revokes agent fan-out immediately', async () => {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard('', 'required'));
  registerArcadeKioskSockets(io);
  setIo(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const now = Date.now();
  const playerId = nanoid();
  const apiKey = nanoid(24);
  const eventId = nanoid();
  const gameId = nanoid();
  const processName = `${nanoid().toLowerCase()}.exe`;
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    `Consent ${playerId}`,
    apiKey,
    now,
  );
  db.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'member', 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, playerId, now);
  db.prepare(
    `INSERT INTO games (id, name, status, created_at, group_id)
     VALUES (?, ?, 'catalog', ?, ?)`,
  ).run(gameId, `Consent Game ${gameId}`, now, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO game_process_names (id, game_id, process_name, group_id)
     VALUES (?, ?, ?, ?)`,
  ).run(nanoid(), gameId, processName, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, 1, ?, 'published', 'participants')`,
  ).run(eventId, `Consent Event ${eventId}`, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    eventId,
    playerId,
  );

  const sessionToken = createSession(playerId);
  const cookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;
  const socket = await connect(baseUrl, sessionToken);
  await subscribe(socket);

  try {
    assert.equal(
      (await request(app).post(`/api/events/${eventId}/tracking-consent`).send({ granted: true })).status,
      401,
      'required auth ignores a body/header identity without a session',
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/events/${eventId}/tracking-consent`)
          .set('Cookie', cookie)
          .send({ granted: 'yes' })
      ).status,
      400,
    );

    const grant = await request(app)
      .post(`/api/events/${eventId}/tracking-consent`)
      .set('Cookie', cookie)
      .send({ granted: true });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.equal(
      (await request(app).post(`/api/events/${eventId}/tracking-consent`).set('Cookie', cookie).send({ granted: true }))
        .status,
      200,
    );

    // Simulate duplicate active Bestandsdaten. Resolution uses EXISTS and a
    // revoke closes every active row rather than leaving one consent alive.
    db.prepare(
      `INSERT INTO event_tracking_consents
         (id, event_id, group_id, player_id, accepted_at, source)
       VALUES (?, ?, ?, ?, ?, 'migration')`,
    ).run(nanoid(), eventId, DEFAULT_GROUP_ID, playerId, now + 1);

    const firstReport = await request(app)
      .post('/api/agent/report')
      .set('x-api-key', apiKey)
      .send({ processNames: [processName] });
    assert.equal(firstReport.status, 200);
    assert.equal(firstReport.body.tracked, true);
    assert.equal(
      (
        db.prepare('SELECT COUNT(*) AS count FROM tracking_live_contexts WHERE player_id = ?').get(playerId) as {
          count: number;
        }
      ).count,
      1,
    );

    const liveChanged = nextLiveChange(socket);
    const revoke = await request(app)
      .post(`/api/events/${eventId}/tracking-consent`)
      .set('Cookie', cookie)
      .send({ granted: false });
    assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
    assert.equal(revoke.body.accepted, false);
    await liveChanged;
    assert.equal(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM event_tracking_consents WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL',
          )
          .get(eventId, playerId) as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        db.prepare('SELECT COUNT(*) AS count FROM tracking_live_contexts WHERE player_id = ?').get(playerId) as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM play_sessions WHERE player_id = ? AND ended_at IS NULL')
          .get(playerId) as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/events/${eventId}/tracking-consent`)
          .set('Cookie', cookie)
          .send({ granted: false })
      ).status,
      200,
    );

    db.prepare("UPDATE event_participants SET status = 'invited' WHERE event_id = ? AND player_id = ?").run(
      eventId,
      playerId,
    );
    const invitedGrant = await request(app)
      .post(`/api/events/${eventId}/tracking-consent`)
      .set('Cookie', cookie)
      .send({ granted: true });
    assert.equal(invitedGrant.status, 409, JSON.stringify(invitedGrant.body));
    assert.equal(
      (
        db
          .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
          .get(eventId, playerId) as { status: string }
      ).status,
      'invited',
      'tracking consent cannot self-promote event participation',
    );

    db.prepare("UPDATE event_participants SET status = 'accepted' WHERE event_id = ? AND player_id = ?").run(
      eventId,
      playerId,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal(
        (
          await request(app)
            .post(`/api/events/${eventId}/tracking-consent`)
            .set('Cookie', cookie)
            .send({ granted: true })
        ).status,
        200,
      );
    }
    assert.equal(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM event_tracking_consents WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL',
          )
          .get(eventId, playerId) as { count: number }
      ).count,
      1,
    );
    assert.equal(
      (
        await request(app)
          .post('/api/agent/report')
          .set('x-api-key', apiKey)
          .send({ processNames: [processName] })
      ).body.tracked,
      true,
    );

    // Switching back to the group room keeps the older compatibility bit in
    // sync, and revocation closes the sentinel-backed outside session.
    db.prepare('UPDATE events SET tracking_enabled = 0 WHERE id = ?').run(eventId);
    assert.equal(
      (
        await request(app)
          .post(`/api/groups/${DEFAULT_GROUP_ID}/tracking-consent`)
          .set('Cookie', cookie)
          .send({ granted: true })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(app)
          .post('/api/agent/report')
          .set('x-api-key', apiKey)
          .send({ processNames: [processName] })
      ).body.tracked,
      true,
    );
    assert.equal(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM play_sessions WHERE player_id = ? AND event_id = ? AND ended_at IS NULL',
          )
          .get(playerId, OUTSIDE_EVENTS_ID) as { count: number }
      ).count,
      1,
    );

    const outsideLiveChanged = nextLiveChange(socket);
    assert.equal(
      (
        await request(app)
          .post(`/api/groups/${DEFAULT_GROUP_ID}/tracking-consent`)
          .set('Cookie', cookie)
          .send({ granted: false })
      ).status,
      200,
    );
    await outsideLiveChanged;
    assert.equal(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM play_sessions WHERE player_id = ? AND event_id = ? AND ended_at IS NULL',
          )
          .get(playerId, OUTSIDE_EVENTS_ID) as { count: number }
      ).count,
      0,
    );

    // A following report with no eligible context performs the same stale
    // reconciliation and never resurrects the revoked live state.
    const afterRevoke = await request(app)
      .post('/api/agent/report')
      .set('x-api-key', apiKey)
      .send({ processNames: [processName] });
    assert.equal(afterRevoke.body.tracked, false);
    assert.deepEqual(afterRevoke.body.gameIds, []);
  } finally {
    socket.close();
    setIo(null);
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
