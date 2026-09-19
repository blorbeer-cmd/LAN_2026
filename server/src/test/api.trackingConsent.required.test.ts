import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { nanoid } from 'nanoid';
import request from 'supertest';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import { db, DEFAULT_GROUP_ID } from '../db';
import { createSocketAuthGuard, Events, registerScopedSockets, setIo } from '../realtime';
import { registerArcadeSockets } from '../arcade/realtime';
import { createSession, SESSION_COOKIE_NAME } from '../sessions';
import { ensureAccountEventContext } from '../eventContext';
import { TRACKING_CONSENT_PURPOSE, TRACKING_CONSENT_TEXT_VERSION } from '../privacyPolicy';

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

test('tracking consent is self-only, idempotent and revokes agent fan-out immediately', async () => {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard());
  registerScopedSockets(io);
  registerArcadeSockets(io);
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
  ensureAccountEventContext(playerId, eventId);

  const sessionToken = createSession(playerId);
  const cookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;
  const adminId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, is_admin, created_at) VALUES (?, ?, ?, 1, ?)').run(
    adminId,
    `Consent Admin ${adminId}`,
    nanoid(24),
    now,
  );
  db.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'owner', 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, adminId, now);
  const adminCookie = `${SESSION_COOKIE_NAME}=${createSession(adminId)}`;
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
    db.prepare(
      `INSERT INTO event_tracking_consents
         (id, event_id, group_id, player_id, accepted_at, source)
       VALUES (?, ?, ?, ?, ?, 'migration')`,
    ).run(nanoid(), eventId, DEFAULT_GROUP_ID, playerId, now);
    const legacyPrivacy = await request(app).get('/api/privacy').set('Cookie', cookie);
    assert.equal(legacyPrivacy.status, 200);
    assert.equal(
      legacyPrivacy.body.trackingConsent.events.find((event: { eventId: string }) => event.eventId === eventId).consentId,
      null,
      'an unversioned legacy row is shown as inactive until the current text is confirmed',
    );
    assert.deepEqual(
      (await request(app).get('/api/agent/process-names').set('x-api-key', apiKey)).body.processNames,
      [],
      'an unversioned legacy consent never activates the process allow-list',
    );
    const staleText = await request(app)
      .post(`/api/events/${eventId}/tracking-consent`)
      .set('Cookie', cookie)
      .send({ granted: true });
    assert.equal(staleText.status, 409);
    assert.equal(staleText.body.code, 'consent_text_changed');

    const grant = await request(app)
      .post(`/api/events/${eventId}/tracking-consent`)
      .set('Cookie', cookie)
      .send({ granted: true, textVersion: TRACKING_CONSENT_TEXT_VERSION });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.deepEqual(
      db.prepare(
        'SELECT purpose, text_version AS textVersion FROM event_tracking_consents WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL',
      ).get(eventId, playerId),
      { purpose: TRACKING_CONSENT_PURPOSE, textVersion: TRACKING_CONSENT_TEXT_VERSION },
    );
    assert.equal(
      (await request(app).post(`/api/events/${eventId}/tracking-consent`).set('Cookie', cookie).send({ granted: true, textVersion: TRACKING_CONSENT_TEXT_VERSION }))
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
    assert.equal(
      (
        await request(app)
          .post(`/api/events/${eventId}/tracking-consent`)
          .set('Cookie', cookie)
          .send({ granted: true, textVersion: TRACKING_CONSENT_TEXT_VERSION })
      ).status,
      200,
    );
    assert.equal(
      (
        db.prepare(
          'SELECT COUNT(*) AS count FROM event_tracking_consents WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL',
        ).get(eventId, playerId) as { count: number }
      ).count,
      1,
      'reconfirming one current text version closes duplicate legacy active rows',
    );

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
      .send({ granted: true, textVersion: TRACKING_CONSENT_TEXT_VERSION });
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
            .send({ granted: true, textVersion: TRACKING_CONSENT_TEXT_VERSION })
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

    const finalLiveChange = nextLiveChange(socket);
    assert.equal(
      (
        await request(app)
          .post(`/api/events/${eventId}/tracking-consent`)
          .set('Cookie', cookie)
          .send({ granted: false })
      ).status,
      200,
    );
    await finalLiveChange;

    // A following report with no eligible event context never resurrects the
    // revoked live state or writes an eventless replacement.
    const afterRevoke = await request(app)
      .post('/api/agent/report')
      .set('x-api-key', apiKey)
      .send({ processNames: [processName] });
    assert.equal(afterRevoke.body.tracked, false);
    assert.deepEqual(afterRevoke.body.gameIds, []);
    assert.deepEqual(
      JSON.parse((db.prepare('SELECT process_names FROM agent_diagnostics WHERE player_id = ?').get(playerId) as { process_names: string }).process_names),
      [],
    );
    const diagnostics = await request(app).get('/api/admin/agent-diagnostics').set('Cookie', adminCookie);
    assert.equal(diagnostics.status, 200);
    assert.deepEqual(diagnostics.body.find((row: { playerId: string }) => row.playerId === playerId).processNames, []);
  } finally {
    socket.close();
    setIo(null);
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
