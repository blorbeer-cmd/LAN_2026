// KIOSK_TOKEN is read at module import time, so the read-only kiosk REST
// boundary is exercised in a child process with the environment
// configured before app.ts and its routers load. Covers the token-only
// dashboard load (/push/last must be reachable), the env-token archived-group
// rejection, and the group-kiosk banner union that mirrors the socket rules.

import { test } from 'node:test';
import { execFileSync } from 'child_process';
import path from 'path';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');

test('a token-only kiosk loads one exact event and honours archival', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createHash } = require('crypto');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { BASE_EVENT_ID, db } = require(${JSON.stringify(DB_JS_PATH)});
    const { createEvent } = require(${JSON.stringify(path.join(__dirname, '..', 'events.js'))});

    const KIOSK = 'required-kiosk-token';
    const GROUP = 'default-group';

    function kioskGet(app, pathname) {
      return request(app).get(pathname).set('x-kiosk-mode', '1').set('x-access-token', KIOSK);
    }
    function eventKioskGet(app, pathname) {
      return request(app).get(pathname).set('x-kiosk-mode', '1').set('x-access-token', 'event-kiosk-token');
    }

    // Direct group-wide push rows: an empty player_ids array satisfies the
    // NOT NULL column and the recipient trigger (json_each('[]') is empty),
    // and the kiosk banner query filters on audience/scope, never player_ids.
    let seq = 0;
    function pushRow(title, eventId, createdAt = Date.now() + seq) {
      db.prepare(
        "INSERT INTO push_log (id, group_id, event_id, title, body, url, audience, player_ids, topic_key, expires_at, resolved_at, created_at) " +
        "VALUES (?, ?, ?, ?, '', NULL, 'all', '[]', NULL, NULL, NULL, ?)"
      ).run('push-' + seq, GROUP, eventId, title, createdAt);
      seq += 1;
    }

    (async () => {
      const app = createApp();

      // Every real LAN gets a separate identity, while a general meeting
      // does not. The identity is not a player and its password login only
      // returns an event-scoped kiosk token — never a browser session.
      const now = Date.now();
      const lanEvent = createEvent('Automatisches Kiosk-LAN', {
        startsAt: now,
        endsAt: now + 3600000,
        eventTypeKey: 'lan',
      });
      const generalEvent = createEvent('Allgemeines Treffen', {
        startsAt: now,
        endsAt: now + 3600000,
        eventTypeKey: 'general',
      });
      const kioskAccount = db.prepare(
        'SELECT username FROM kiosk_accounts WHERE event_id = ?'
      ).get(lanEvent.id);
      assert.equal(kioskAccount.username, 'kiosk-' + lanEvent.id);
      assert.equal(db.prepare('SELECT 1 FROM kiosk_accounts WHERE event_id = ?').get(generalEvent.id), undefined);
      assert.equal(db.prepare('SELECT 1 FROM players WHERE name = ?').get(kioskAccount.username), undefined);

      const badLogin = await request(app).post('/api/kiosk/login').send({
        username: kioskAccount.username,
        password: 'wrong',
      });
      assert.equal(badLogin.status, 401);
      const login = await request(app).post('/api/kiosk/login').send({
        username: kioskAccount.username,
        password: 'shared-kiosk-password',
      });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      assert.equal(login.body.eventId, lanEvent.id);
      assert.ok(login.body.token);
      assert.equal(
        (await request(app).get('/api/live').set('x-kiosk-mode', '1').set('x-access-token', login.body.token)).status,
        200,
      );
      assert.equal(
        (await request(app).get('/api/players').set('x-kiosk-mode', '1').set('x-access-token', login.body.token)).status,
        401,
      );
      pushRow('Kiosk-Konto Durchsage', lanEvent.id);
      const accountPush = await request(app)
        .get('/api/push/last')
        .set('x-kiosk-mode', '1')
        .set('x-access-token', login.body.token);
      assert.equal(accountPush.status, 200);
      assert.equal(accountPush.body.entry.title, 'Kiosk-Konto Durchsage');
      assert.equal(
        (await request(app).post('/api/auth/login').send({ name: kioskAccount.username, password: 'shared-kiosk-password' })).status,
        401,
      );

      // #1 — /push/last must be a read-only kiosk path; before the fix a
      // token-only kiosk 401s here and its whole Promise.all refresh fails.
      const lastEmpty = await kioskGet(app, '/api/push/last');
      assert.equal(lastEmpty.status, 200, JSON.stringify(lastEmpty.body));
      assert.equal(lastEmpty.body.entry, null);
      for (const p of ['/api/live', '/api/votes', '/api/leaderboard', '/api/food-orders']) {
        assert.equal((await kioskGet(app, p)).status, 200, 'kiosk GET ' + p);
      }

      // #4 — a group kiosk unions its group room with its current tracking
      // event and returns the newest active 'all' entry across both.
      pushRow('Allgemein', BASE_EVENT_ID);
      const afterBase = await kioskGet(app, '/api/push/last');
      assert.equal(afterBase.body.entry.title, 'Allgemein');

      db.prepare("INSERT INTO events (id, name, starts_at, group_id, tracking_enabled) VALUES ('kiosk-evt', 'Kiosk Evt', ?, ?, 1)").run(Date.now(), GROUP);
      db.prepare(
        "INSERT INTO kiosk_tokens (id, token_hash, group_id, event_id, label, created_by, created_at, revoked_at) " +
        "VALUES ('event-kiosk', ?, ?, 'kiosk-evt', 'Test', NULL, ?, NULL)"
      ).run(createHash('sha256').update('event-kiosk-token').digest('hex'), GROUP, Date.now());
      assert.equal((await eventKioskGet(app, '/api/push/last')).body.entry, null);
      pushRow('Aktuelles Event', 'kiosk-evt');
      const afterEvent = await eventKioskGet(app, '/api/push/last');
      assert.equal(afterEvent.body.entry.title, 'Aktuelles Event');
      assert.equal((await kioskGet(app, '/api/push/last')).body.entry.title, 'Allgemein');

      // SQLite timestamps have millisecond precision. Two pushes created in
      // one millisecond still have a deterministic newest entry: the row
      // inserted last, rather than whichever tie the query planner returns.
      const sameTimestamp = Date.now() + 100;
      pushRow('Gleichstand alt', 'kiosk-evt', sameTimestamp);
      pushRow('Gleichstand neu', 'kiosk-evt', sameTimestamp);
      assert.equal((await eventKioskGet(app, '/api/push/last')).body.entry.title, 'Gleichstand neu');

      // #2 — the env token keeps reading until the resolved group is archived,
      // then every kiosk GET is rejected (parity with the socket delivery).
      const beforeArchive = await kioskGet(app, '/api/live');
      assert.equal(beforeArchive.status, 200);
      db.prepare('UPDATE groups SET archived_at = ? WHERE id = ?').run(Date.now(), GROUP);
      const afterArchive = await kioskGet(app, '/api/live');
      assert.equal(afterArchive.status, 404, 'an archived group must reject the env-token kiosk');
      const lastAfterArchive = await kioskGet(app, '/api/push/last');
      assert.equal(lastAfterArchive.status, 404, 'and the banner endpoint too');
      assert.equal((await eventKioskGet(app, '/api/live')).status, 401, 'archival invalidates stored event tokens');

      console.log('KIOSK_REST_OK');
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      DB_FILE: ':memory:',
      COOKIE_SECURE: '0',
      KIOSK_TOKEN: 'required-kiosk-token',
      KIOSK_PASSWORD: 'shared-kiosk-password',
      ADMIN_RECOVERY_CODE: 'kiosk-rest-recovery-code',
    },
    encoding: 'utf8',
  });
  if (!out.includes('KIOSK_REST_OK')) throw new Error('kiosk REST assertions did not complete:\n' + out);
});

test('an unconfigured installation generates and persists its own kiosk password', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});
    const { createEvent } = require(${JSON.stringify(path.join(__dirname, '..', 'events.js'))});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }

    (async () => {
      const app = createApp();

      const now = Date.now();
      const lanEvent = createEvent('Auto-Generated-Kiosk-LAN', {
        startsAt: now,
        endsAt: now + 3600000,
        eventTypeKey: 'lan',
      });
      const kioskAccount = db.prepare('SELECT username FROM kiosk_accounts WHERE event_id = ?').get(lanEvent.id);

      const generatedRow = db.prepare("SELECT value FROM app_state WHERE key = 'generated_kiosk_password'").get();
      assert.ok(generatedRow, 'a password must be generated and persisted when no env var is configured');
      assert.match(generatedRow.value, /^[0-9a-f]{64}$/, 'the generated password should be a strong random hex string');

      const badLogin = await request(app).post('/api/kiosk/login').send({
        username: kioskAccount.username,
        password: 'not-the-generated-password',
      });
      assert.equal(badLogin.status, 401);

      const goodLogin = await request(app).post('/api/kiosk/login').send({
        username: kioskAccount.username,
        password: generatedRow.value,
      });
      assert.equal(goodLogin.status, 200, JSON.stringify(goodLogin.body));
      assert.ok(goodLogin.body.token);

      // Admin-only: exposes the exact same live credential, never to an
      // unauthenticated caller.
      const anonAttempt = await request(app).get('/api/admin/kiosk-password');
      assert.equal(anonAttempt.status, 401);

      const adminResponse = await request(app).post('/api/auth/register').send({
        code: 'unconfigured-kiosk-admin-recovery-code',
        name: 'Kiosk Admin',
        password: 'unconfigured kiosk admin passphrase',
      });
      assert.equal(adminResponse.status, 201, JSON.stringify(adminResponse.body));
      const adminCookie = cookie(adminResponse);

      const passwordResponse = await request(app).get('/api/admin/kiosk-password').set('Cookie', adminCookie);
      assert.equal(passwordResponse.status, 200);
      assert.equal(passwordResponse.body.password, generatedRow.value);

      console.log('KIOSK_AUTOGEN_OK');
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      DB_FILE: ':memory:',
      COOKIE_SECURE: '0',
      KIOSK_TOKEN: '',
      KIOSK_PASSWORD: '',
      ADMIN_RECOVERY_CODE: 'unconfigured-kiosk-admin-recovery-code',
    },
    encoding: 'utf8',
  });
  if (!out.includes('KIOSK_AUTOGEN_OK')) throw new Error('kiosk auto-generated password assertions did not complete:\n' + out);
});
