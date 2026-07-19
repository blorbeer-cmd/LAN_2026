import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'seating-pings-recovery-code';

test('seating and pings isolate two groups, player references, events, history and roles', () => {
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
      const carol = await register('Seating Carol', 'seating carol secure passphrase');
      const dave = await register('Seating Dave', 'seating dave secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie).send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Seating Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Seating Group B' });
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

      const gameA = await scoped(app, 'post', '/api/games', alice, groupA).send({ name: 'Seating Ping Game A', status: 'catalog' });
      const gameB = await scoped(app, 'post', '/api/games', carol, groupB).send({ name: 'Seating Ping Game B', status: 'catalog' });
      assert.equal(gameA.status, 201);
      assert.equal(gameB.status, 201);

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupA)
        .send({ name: 'Seating Event A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol, groupB)
        .send({ name: 'Seating Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201);
      assert.equal(eventB.status, 201);

      // Layout moderation is vertical: members can read but only a group
      // Admin/Owner may replace the shared seating plan.
      const memberLayout = await scoped(app, 'put', '/api/seating/layout', bob, groupA).send({
        topSeats: 2, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [{ side: 'top', seat: 0, playerId: bob.account.id }],
      });
      assert.equal(memberLayout.status, 403);
      const layoutA = await scoped(app, 'put', '/api/seating/layout', alice, groupA).send({
        topSeats: 2, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [
          { side: 'top', seat: 0, playerId: alice.account.id },
          { side: 'top', seat: 1, playerId: bob.account.id },
        ],
      });
      assert.equal(layoutA.status, 200, JSON.stringify(layoutA.body));
      assert.deepEqual(layoutA.body.layout.assignments.map((entry) => entry.playerId).sort(),
        [alice.account.id, bob.account.id].sort());
      const eventLayoutA = await scoped(app, 'put', '/api/seating/layout', alice, groupA).send({
        eventId: eventA.body.id,
        topSeats: 1, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [{ side: 'top', seat: 0, playerId: alice.account.id }],
      });
      assert.equal(eventLayoutA.status, 200);
      assert.deepEqual((await scoped(app, 'get', '/api/seating/layout?eventId=' + eventA.body.id, alice, groupA))
        .body.layout.assignments.map((entry) => entry.playerId), [alice.account.id]);
      assert.equal((await scoped(app, 'get', '/api/seating/layout', alice, groupA))
        .body.layout.assignments.length, 2, 'event history must not replace the group-room layout');
      const layoutB = await scoped(app, 'get', '/api/seating/layout', carol, groupB);
      assert.deepEqual(layoutB.body.layout.assignments, []);
      assert.equal(layoutB.body.players.some((player) => player.id === bob.account.id), false);

      const foreignAssignment = await scoped(app, 'put', '/api/seating/layout', alice, groupA).send({
        topSeats: 2, rightSeats: 0, bottomSeats: 0, leftSeats: 0,
        assignments: [{ side: 'top', seat: 0, playerId: carol.account.id }],
      });
      assert.equal(foreignAssignment.status, 404);
      assert.equal((await scoped(app, 'get', '/api/seating/layout?eventId=' + eventB.body.id, alice, groupA)).status, 404);
      assert.equal((await scoped(app, 'put', '/api/players/' + bob.account.id + '/neighbors', bob, groupA)
        .send({ neighborIds: [carol.account.id] })).status, 404);
      assert.equal((await scoped(app, 'put', '/api/players/' + bob.account.id + '/neighbors', bob, groupA)
        .send({ neighborIds: [alice.account.id] })).status, 200);
      assert.throws(() => db.prepare(
        "UPDATE seating_layouts SET assignments = ? WHERE group_id = ? AND event_id IS NULL"
      ).run(JSON.stringify([{ side: 'top', seat: 0, playerId: carol.account.id }]), groupA), /group mismatch/);

      // Active pings and durable history remain group/event scoped.
      const pingA = await scoped(app, 'post', '/api/pings', bob, groupA)
        .send({ gameId: gameA.body.id, message: 'A group room', groupId: groupB });
      const pingB = await scoped(app, 'post', '/api/pings', carol, groupB)
        .send({ gameId: gameB.body.id, message: 'B group room' });
      assert.equal(pingA.status, 201, JSON.stringify(pingA.body));
      assert.equal(pingB.status, 201, JSON.stringify(pingB.body));
      assert.equal(pingA.body.groupId, groupA, 'body groupId must never override the authorized header context');
      assert.deepEqual((await scoped(app, 'get', '/api/pings', alice, groupA)).body.pings.map((ping) => ping.id),
        [pingA.body.pings[0].id]);
      assert.deepEqual((await scoped(app, 'get', '/api/pings', carol, groupB)).body.pings.map((ping) => ping.id),
        [pingB.body.pings[0].id]);
      assert.equal((await scoped(app, 'post', '/api/pings', bob, groupA)
        .send({ gameId: gameB.body.id })).status, 404);
      assert.equal((await scoped(app, 'post', '/api/pings', bob, groupA)
        .send({ gameId: gameA.body.id, eventId: eventB.body.id })).status, 404);
      assert.equal((await scoped(app, 'post', '/api/pings/' + pingB.body.pings[0].id + '/interested', bob, groupA)
        .send({})).status, 404);

      // Dave is only a member; Alice is an instance admin but also only a
      // member in B. Neither may cancel Carol's ping through global power.
      assert.equal((await scoped(app, 'delete', '/api/pings/' + pingB.body.pings[0].id, dave, groupB)).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/pings/' + pingB.body.pings[0].id, alice, groupB)).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/pings/' + pingB.body.pings[0].id, carol, groupB)).status, 204);
      const historyB = await scoped(app, 'get', '/api/pings/history', carol, groupB);
      assert.equal(historyB.body.pings[0].id, pingB.body.pings[0].id);
      assert.equal(historyB.body.pings[0].active, false);
      assert.equal((await scoped(app, 'get', '/api/pings/history?eventId=' + eventA.body.id, carol, groupB)).status, 404);

      const eventPingA = await scoped(app, 'post', '/api/pings', bob, groupA)
        .send({ gameId: gameA.body.id, eventId: eventA.body.id });
      assert.equal(eventPingA.status, 201);
      const eventHistoryA = await scoped(app, 'get', '/api/pings/history?eventId=' + eventA.body.id, alice, groupA);
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
        MULTI_GROUPS_ENABLED: '1',
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
