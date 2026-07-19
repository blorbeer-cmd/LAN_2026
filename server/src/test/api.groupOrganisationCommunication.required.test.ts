// Phase 5c organisation/communication tenant-boundary suite.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const PUSH_JS_PATH = path.join(__dirname, '..', 'push.js');
const RECOVERY_CODE = 'organisation-communication-recovery-code';

test('organisation communication isolates groups, events, roles, recipients, aggregates and exports', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});
    const { pushTransport } = require(${JSON.stringify(PUSH_JS_PATH)});

    function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
    function scoped(app, method, url, user, groupId) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', groupId);
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
      const carol = await register('Comms Carol', 'comms carol secure passphrase');
      const dave = await register('Comms Dave', 'comms dave secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie)
        .send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Comms Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Comms Group B' });
      assert.equal(groupAResponse.status, 201);
      assert.equal(groupBResponse.status, 201);
      const groupA = groupAResponse.body.id;
      const groupB = groupBResponse.body.id;

      async function addMember(owner, groupId, target) {
        const invite = await request(app).post('/api/groups/' + groupId + '/invites')
          .set('Cookie', owner.cookie).send({ targetPlayerId: target.account.id });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const accepted = await request(app).post('/api/groups/invites/' + invite.body.code + '/accept')
          .set('Cookie', target.cookie);
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      }
      await addMember(alice, groupA, bob);
      await addMember(carol, groupB, dave);
      await addMember(carol, groupB, alice);
      for (const user of [alice, carol]) {
        assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', user.cookie)
          .send({ password: user.password })).status, 204);
      }

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupA)
        .send({ name: 'Comms Event A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol, groupB)
        .send({ name: 'Comms Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201);
      assert.equal(eventB.status, 201);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice, groupA)
        .send({ playerIds: [alice.account.id] })).status, 200);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', carol, groupB)
        .send({ playerIds: [carol.account.id, dave.account.id] })).status, 200);

      // Info-board moderation is vertical: a group member and an instance
      // admin who is only a member in B cannot write there.
      assert.equal((await scoped(app, 'post', '/api/info', bob, groupA).send({ title: 'No', content: 'member' })).status, 403);
      assert.equal((await scoped(app, 'post', '/api/info', alice, groupB).send({ title: 'No', content: 'global admin' })).status, 403);
      const infoA = await scoped(app, 'post', '/api/info', alice, groupA)
        .send({ title: 'A room', content: 'A only' });
      const eventInfoA = await scoped(app, 'post', '/api/info', alice, groupA)
        .send({ title: 'A event', content: 'event only', eventId: eventA.body.id });
      const infoB = await scoped(app, 'post', '/api/info', carol, groupB)
        .send({ title: 'B room', content: 'B only' });
      assert.equal(infoA.status, 201);
      assert.equal(eventInfoA.status, 201);
      assert.equal(infoB.status, 201);
      assert.deepEqual((await scoped(app, 'get', '/api/info', alice, groupA)).body.entries.map((e) => e.title), ['A room']);
      assert.deepEqual((await scoped(app, 'get', '/api/info?eventId=' + eventA.body.id, alice, groupA)).body.entries.map((e) => e.title), ['A event']);
      assert.deepEqual((await scoped(app, 'get', '/api/info', carol, groupB)).body.entries.map((e) => e.title), ['B room']);
      assert.equal((await scoped(app, 'get', '/api/info?eventId=' + eventB.body.id, alice, groupA)).status, 404);
      assert.equal((await scoped(app, 'patch', '/api/info/' + infoB.body.id, alice, groupA).send({ content: 'leak' })).status, 404);

      // Group-room and event recipient definitions are durable snapshots.
      const groupBroadcastA = await scoped(app, 'post', '/api/broadcasts', bob, groupA)
        .send({ message: 'A group room' });
      const eventBroadcastA = await scoped(app, 'post', '/api/broadcasts', alice, groupA)
        .send({ message: 'A event only', eventId: eventA.body.id });
      const groupBroadcastB = await scoped(app, 'post', '/api/broadcasts', dave, groupB)
        .send({ message: 'B group room' });
      assert.equal(groupBroadcastA.status, 201, JSON.stringify(groupBroadcastA.body));
      assert.equal(eventBroadcastA.status, 201, JSON.stringify(eventBroadcastA.body));
      assert.equal(groupBroadcastB.status, 201, JSON.stringify(groupBroadcastB.body));
      assert.deepEqual(groupBroadcastA.body.recipientIds.sort(), [alice.account.id, bob.account.id].sort());
      assert.deepEqual(eventBroadcastA.body.recipientIds, [alice.account.id]);
      assert.equal(deliveries, 0, 'data-only broadcasts must not invoke Web Push transport');
      assert.deepEqual((await scoped(app, 'get', '/api/broadcasts', alice, groupA)).body.broadcasts.map((e) => e.message), ['A group room']);
      assert.deepEqual((await scoped(app, 'get', '/api/broadcasts', carol, groupB)).body.broadcasts.map((e) => e.message), ['B group room']);
      assert.equal((await scoped(app, 'get', '/api/broadcasts?eventId=' + eventB.body.id, alice, groupA)).status, 404);
      assert.equal((await scoped(app, 'post', '/api/broadcasts/' + groupBroadcastB.body.id + '/end', alice, groupA)
        .send({})).status, 404);

      const aliceEventPush = await scoped(app, 'get', '/api/push/log?playerId=' + alice.account.id + '&eventId=' + eventA.body.id, alice, groupA);
      const bobEventPush = await scoped(app, 'get', '/api/push/log?playerId=' + bob.account.id + '&eventId=' + eventA.body.id, bob, groupA);
      assert.equal(aliceEventPush.body.entries.length, 1);
      assert.equal(aliceEventPush.body.summary.groupWide, 1);
      assert.equal(bobEventPush.body.entries.length, 0);
      assert.equal((await scoped(app, 'get', '/api/push/log?playerId=' + alice.account.id, carol, groupB)).status, 200);
      const spoofedPlayer = await scoped(app, 'get', '/api/push/log?playerId=' + bob.account.id, carol, groupB);
      assert.equal(spoofedPlayer.status, 200);
      assert.deepEqual(spoofedPlayer.body.entries.map((entry) => entry.body), ['B group room'],
        'required mode must bind push history to the session player');

      const exportA = await scoped(app, 'get', '/api/export?eventId=' + eventA.body.id, alice, groupA);
      assert.equal(exportA.status, 200, JSON.stringify(exportA.body));
      assert.deepEqual(exportA.body.communications.broadcasts.map((e) => e.message), ['A event only']);
      assert.deepEqual(exportA.body.communications.infoEntries.map((e) => e.title), ['A event']);
      assert.equal(exportA.body.communications.pushHistory.total, 1);

      // Database constraints reject event and sender ownership drift.
      assert.throws(() => db.prepare(
        "INSERT INTO info_entries (id, group_id, event_id, title, content, created_at, updated_at) VALUES ('bad-info', ?, ?, 'x', 'x', ?, ?)"
      ).run(groupA, eventB.body.id, now, now), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO broadcasts (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, recipient_ids, created_at) VALUES ('bad-broadcast', ?, NULL, ?, 'Foreign', 'x', ?, '[]', ?)"
      ).run(groupA, carol.account.id, now + 1000, now), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, created_at) VALUES ('bad-push', ?, NULL, 'x', 'x', 'all', ?, ?)"
      ).run(groupA, JSON.stringify([carol.account.id]), now), /group mismatch/);
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
        MULTI_GROUPS_ENABLED: '1',
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
