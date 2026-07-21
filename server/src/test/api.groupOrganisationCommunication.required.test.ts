// Single-group organisation/communication suite: roles, group-room vs.
// event-scoped info/broadcasts (two sequential events in the one real
// group), push-log binding to the session player, aggregates and exports.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const PUSH_JS_PATH = path.join(__dirname, '..', 'push.js');
const RECOVERY_CODE = 'organisation-communication-recovery-code';

test('organisation communication is roles-gated and event-scoped inside the one real group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});
    const { pushTransport } = require(${JSON.stringify(PUSH_JS_PATH)});

    function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
    function scoped(app, method, url, user) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', DEFAULT_GROUP_ID);
    }

    (async () => {
      const app = createApp();
      let deliveries = 0;
      pushTransport.send = async () => { deliveries += 1; };
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)}, name: 'Comms Alice', password: 'comms alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'comms alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie)
        .send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }
      const bob = await register('Comms Bob', 'comms bob secure passphrase');

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice)
        .send({ name: 'Comms Event A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice)
        .send({ playerIds: [alice.account.id] })).status, 200);

      // Info-board moderation is vertical: a plain member cannot write there.
      assert.equal((await scoped(app, 'post', '/api/info', bob).send({ title: 'No', content: 'member' })).status, 403);
      const infoRoom = await scoped(app, 'post', '/api/info', alice)
        .send({ title: 'Room entry', content: 'group room' });
      const infoEventA = await scoped(app, 'post', '/api/info', alice)
        .send({ title: 'Event A entry', content: 'event only', eventId: eventA.body.id });
      assert.equal(infoRoom.status, 201);
      assert.equal(infoEventA.status, 201);
      assert.deepEqual((await scoped(app, 'get', '/api/info', alice)).body.entries.map((e) => e.title), ['Room entry']);
      assert.deepEqual((await scoped(app, 'get', '/api/info?eventId=' + eventA.body.id, alice)).body.entries.map((e) => e.title), ['Event A entry']);

      // Group-room and event recipient definitions are durable snapshots.
      const groupBroadcast = await scoped(app, 'post', '/api/broadcasts', bob)
        .send({ message: 'group room' });
      const eventBroadcastA = await scoped(app, 'post', '/api/broadcasts', alice)
        .send({ message: 'event A only', eventId: eventA.body.id });
      assert.equal(groupBroadcast.status, 201, JSON.stringify(groupBroadcast.body));
      assert.equal(eventBroadcastA.status, 201, JSON.stringify(eventBroadcastA.body));
      assert.deepEqual(groupBroadcast.body.recipientIds.sort(), [alice.account.id, bob.account.id].sort());
      assert.deepEqual(eventBroadcastA.body.recipientIds, [alice.account.id]);
      assert.equal(deliveries, 0, 'data-only broadcasts must not invoke Web Push transport');
      assert.deepEqual((await scoped(app, 'get', '/api/broadcasts', alice)).body.broadcasts.map((e) => e.message), ['group room']);

      const aliceEventPush = await scoped(app, 'get', '/api/push/log?playerId=' + alice.account.id + '&eventId=' + eventA.body.id, alice);
      const bobEventPush = await scoped(app, 'get', '/api/push/log?playerId=' + bob.account.id + '&eventId=' + eventA.body.id, bob);
      assert.equal(aliceEventPush.body.entries.length, 1);
      assert.equal(aliceEventPush.body.summary.groupWide, 1);
      assert.equal(bobEventPush.status, 404, 'a non-participant cannot read participant-scoped event push data');
      // required mode binds push history to the session player, regardless
      // of what playerId is spoofed on the query string.
      const spoofedPlayer = await scoped(app, 'get', '/api/push/log?playerId=' + alice.account.id, bob);
      assert.equal(spoofedPlayer.status, 200);
      assert.deepEqual(spoofedPlayer.body.entries.map((entry) => entry.body), ['group room'],
        'required mode must bind push history to the session player, not the query string');

      const exportA = await scoped(app, 'get', '/api/export?eventId=' + eventA.body.id, alice);
      assert.equal(exportA.status, 200, JSON.stringify(exportA.body));
      assert.deepEqual(exportA.body.communications.broadcasts.map((e) => e.message), ['event A only']);
      assert.deepEqual(exportA.body.communications.infoEntries.map((e) => e.title), ['Event A entry']);
      assert.equal(exportA.body.communications.pushHistory.total, 1);

      // Switching the group's tracked event to a second event keeps event A's
      // entries untouched and filters event B's own writes separately.
      const eventB = await scoped(app, 'post', '/api/events', alice)
        .send({ name: 'Comms Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventB.status, 201);
      const infoEventB = await scoped(app, 'post', '/api/info', alice)
        .send({ title: 'Event B entry', content: 'event only', eventId: eventB.body.id });
      assert.equal(infoEventB.status, 201);
      assert.deepEqual((await scoped(app, 'get', '/api/info?eventId=' + eventA.body.id, alice)).body.entries.map((e) => e.title), ['Event A entry']);
      assert.deepEqual((await scoped(app, 'get', '/api/info?eventId=' + eventB.body.id, alice)).body.entries.map((e) => e.title), ['Event B entry']);
      assert.equal((await scoped(app, 'patch', '/api/info/' + infoEventB.body.id, alice).send({ content: 'still A? no' })).status, 200);

      // Database constraints reject event/sender ownership drift.
      assert.throws(() => db.prepare(
        "INSERT INTO info_entries (id, group_id, event_id, title, content, created_at, updated_at) VALUES ('bad-info', ?, ?, 'x', 'x', ?, ?)"
      ).run(DEFAULT_GROUP_ID, 'does-not-exist', now, now), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO broadcasts (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, recipient_ids, created_at) VALUES ('bad-broadcast', ?, NULL, ?, 'Foreign', 'x', ?, '[]', ?)"
      ).run(DEFAULT_GROUP_ID, 'does-not-exist', now + 1000, now), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, created_at) VALUES ('bad-push', ?, NULL, 'x', 'x', 'all', ?, ?)"
      ).run(DEFAULT_GROUP_ID, JSON.stringify(['does-not-exist']), now), /group mismatch/);
    })().catch((error) => { console.error(error); process.exit(1); });
  `;

  try {
    execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        AUTH_MODE: 'required',
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `group organisation/communication child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
