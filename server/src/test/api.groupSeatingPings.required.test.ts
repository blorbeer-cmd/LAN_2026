import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'seating-pings-recovery-code';

test('seating and pings are roles-gated and event-scoped inside the one real group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
    function scoped(app, method, url, user, groupId) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', groupId);
    }

    (async () => {
      const app = createApp();
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)}, name: 'Seating Alice', password: 'seating alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'seating alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }
      const bob = await register('Seating Bob', 'seating bob secure passphrase');

      const groupsResponse = await request(app).get('/api/groups').set('Cookie', alice.cookie);
      const groupId = groupsResponse.body[0].id;

      const gameA = await scoped(app, 'post', '/api/games', alice, groupId).send({ name: 'Seating Ping Game A', status: 'catalog' });
      assert.equal(gameA.status, 201);

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupId)
        .send({ name: 'Seating Event A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201);

      // Layout moderation is vertical: members can read but only a group
      // Admin/Owner may replace the shared seating plan.
      const memberLayout = await scoped(app, 'put', '/api/seating/layout', bob, groupId).send({
        topSeats: 2, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [{ side: 'top', seat: 0, playerId: bob.account.id }],
      });
      assert.equal(memberLayout.status, 403);
      const layoutA = await scoped(app, 'put', '/api/seating/layout', alice, groupId).send({
        topSeats: 2, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [
          { side: 'top', seat: 0, playerId: alice.account.id },
          { side: 'top', seat: 1, playerId: bob.account.id },
        ],
      });
      assert.equal(layoutA.status, 200, JSON.stringify(layoutA.body));
      assert.deepEqual(layoutA.body.layout.assignments.map((entry) => entry.playerId).sort(),
        [alice.account.id, bob.account.id].sort());
      const eventLayoutA = await scoped(app, 'put', '/api/seating/layout', alice, groupId).send({
        eventId: eventA.body.id,
        topSeats: 1, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [{ side: 'top', seat: 0, playerId: alice.account.id }],
      });
      assert.equal(eventLayoutA.status, 200);
      assert.deepEqual((await scoped(app, 'get', '/api/seating/layout?eventId=' + eventA.body.id, alice, groupId))
        .body.layout.assignments.map((entry) => entry.playerId), [alice.account.id]);
      assert.equal((await scoped(app, 'get', '/api/seating/layout', alice, groupId))
        .body.layout.assignments.length, 2, 'event history must not replace the group-room layout');

      // A player id with no active membership can never be smuggled into a
      // seat or a neighbor preference.
      const foreignAssignment = await scoped(app, 'put', '/api/seating/layout', alice, groupId).send({
        topSeats: 2, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [{ side: 'top', seat: 0, playerId: 'does-not-exist' }],
      });
      assert.equal(foreignAssignment.status, 404);
      assert.equal((await scoped(app, 'put', '/api/players/' + bob.account.id + '/neighbors', bob, groupId)
        .send({ neighborIds: ['does-not-exist'] })).status, 404);
      assert.equal((await scoped(app, 'put', '/api/players/' + bob.account.id + '/neighbors', bob, groupId)
        .send({ neighborIds: [alice.account.id] })).status, 200);
      assert.throws(() => db.prepare(
        "UPDATE seating_layouts SET assignments = ? WHERE group_id = ? AND event_id IS NULL"
      ).run(JSON.stringify([{ side: 'top', seat: 0, playerId: 'does-not-exist' }]), groupId), /group mismatch/);

      // Active pings and durable history remain group/event scoped; a
      // nonexistent game or event id 404s instead of silently creating one.
      const pingA = await scoped(app, 'post', '/api/pings', bob, groupId)
        .send({ gameId: gameA.body.id, message: 'group room' });
      assert.equal(pingA.status, 201, JSON.stringify(pingA.body));
      assert.deepEqual((await scoped(app, 'get', '/api/pings', alice, groupId)).body.pings.map((ping) => ping.id),
        [pingA.body.pings[0].id]);
      assert.equal((await scoped(app, 'post', '/api/pings', bob, groupId)
        .send({ gameId: 'does-not-exist' })).status, 404);
      assert.equal((await scoped(app, 'post', '/api/pings', bob, groupId)
        .send({ gameId: gameA.body.id, eventId: 'does-not-exist' })).status, 404);

      // Only the creator or a group Admin/Owner may cancel a ping - not any
      // other member.
      const secondPinger = await register('Seating Dave', 'seating dave secure passphrase');
      assert.equal((await scoped(app, 'delete', '/api/pings/' + pingA.body.pings[0].id, secondPinger, groupId)).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/pings/' + pingA.body.pings[0].id, alice, groupId)).status, 204);
      const historyA = await scoped(app, 'get', '/api/pings/history', alice, groupId);
      assert.equal(historyA.body.pings[0].id, pingA.body.pings[0].id);
      assert.equal(historyA.body.pings[0].active, false);

      const eventPingA = await scoped(app, 'post', '/api/pings', bob, groupId)
        .send({ gameId: gameA.body.id, eventId: eventA.body.id });
      assert.equal(eventPingA.status, 201);
      const eventHistoryA = await scoped(app, 'get', '/api/pings/history?eventId=' + eventA.body.id, alice, groupId);
      assert.deepEqual(eventHistoryA.body.pings.map((ping) => ping.id), [eventPingA.body.pings[0].id]);
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
      `group seating/pings child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
