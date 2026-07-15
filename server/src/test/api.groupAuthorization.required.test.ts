// Phase 5b tenant-boundary integration suite. Configuration is import-time,
// so the two-group matrix runs in an isolated required-auth child process.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'group-authorization-recovery-code';

test('group roles, event resources and audit remain isolated across two groups', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }
    function scoped(app, method, path, sessionCookie, groupId) {
      return request(app)[method](path).set('Cookie', sessionCookie).set('x-group-id', groupId);
    }

    (async () => {
      const app = createApp();
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Matrix Alice',
        password: 'matrix alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'matrix alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }

      const bob = await register('Matrix Bob', 'matrix bob secure passphrase');
      const carol = await register('Matrix Carol', 'matrix carol secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie).send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Matrix Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Matrix Group B' });
      assert.equal(groupAResponse.status, 201, JSON.stringify(groupAResponse.body));
      assert.equal(groupBResponse.status, 201, JSON.stringify(groupBResponse.body));
      const groupA = groupAResponse.body.id;
      const groupB = groupBResponse.body.id;

      async function addMember(owner, groupId, target) {
        const invite = await request(app)
          .post('/api/groups/' + groupId + '/invites')
          .set('Cookie', owner.cookie)
          .send({ targetPlayerId: target.account.id });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const accepted = await request(app)
          .post('/api/groups/invites/' + invite.body.code + '/accept')
          .set('Cookie', target.cookie);
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      }

      await addMember(alice, groupA, bob);
      await addMember(carol, groupB, alice);

      const deactivateSoleOwner = await request(app)
        .post('/api/players/' + carol.account.id + '/deactivate')
        .set('Cookie', alice.cookie);
      assert.equal(deactivateSoleOwner.status, 409);
      assert.match(deactivateSoleOwner.body.error, /Owner/);

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie, groupA).send({
        name: 'Event A', startsAt: now, endsAt: now + 60_000,
      });
      const eventB = await scoped(app, 'post', '/api/events', carol.cookie, groupB).send({
        name: 'Event B', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal(eventA.body.groupId, groupA);
      assert.equal(eventB.body.groupId, groupB);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie, groupA).send({})).status, 200);
      const archiveWhileTracking = await request(app).delete('/api/groups/' + groupA).set('Cookie', alice.cookie);
      assert.equal(archiveWhileTracking.status, 409);
      const hiddenTrackingConflict = await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol.cookie, groupB).send({});
      assert.equal(hiddenTrackingConflict.status, 409);
      assert.equal(hiddenTrackingConflict.body.conflictEventId, undefined);
      assert.equal(JSON.stringify(hiddenTrackingConflict.body).includes('Event A'), false);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice.cookie, groupA).send({})).status, 200);

      const bobEventsA = await scoped(app, 'get', '/api/events', bob.cookie, groupA);
      assert.equal(bobEventsA.status, 200);
      assert.ok(bobEventsA.body.some((event) => event.id === eventA.body.id));
      assert.equal(bobEventsA.body.some((event) => event.id === eventB.body.id), false);
      const bobCreateDenied = await scoped(app, 'post', '/api/events', bob.cookie, groupA).send({
        name: 'Forbidden', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(bobCreateDenied.status, 403);
      assert.equal((await request(app).post('/api/groups/' + groupA + '/test-users').set('Cookie', bob.cookie).send({ count: 1 })).status, 403);

      assert.equal((await scoped(app, 'get', '/api/events/' + eventB.body.id, bob.cookie, groupA)).status, 404);
      assert.equal((await scoped(app, 'get', '/api/events/' + eventB.body.id, alice.cookie, groupA)).status, 404);
      assert.equal((await scoped(app, 'get', '/api/events/' + eventB.body.id, alice.cookie, groupB)).status, 200);

      const foreignParticipant = await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie, groupA)
        .send({ playerIds: [carol.account.id] });
      assert.equal(foreignParticipant.status, 404);
      const ownParticipant = await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie, groupA)
        .send({ playerIds: [bob.account.id] });
      assert.equal(ownParticipant.status, 200, JSON.stringify(ownParticipant.body));

      const promoteBob = await request(app)
        .patch('/api/groups/' + groupA + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'admin' });
      assert.equal(promoteBob.status, 200, JSON.stringify(promoteBob.body));
      const testUsers = await request(app)
        .post('/api/groups/' + groupA + '/test-users')
        .set('Cookie', bob.cookie)
        .send({ count: 1 });
      assert.equal(testUsers.status, 201, JSON.stringify(testUsers.body));
      const testPlayerId = testUsers.body.created[0].id;
      assert.deepEqual(
        db.prepare('SELECT test_owner_group_id FROM players WHERE id = ?').get(testPlayerId),
        { test_owner_group_id: groupA },
      );
      assert.equal((await request(app)
        .patch('/api/groups/' + groupA + '/members/' + testPlayerId)
        .set('Cookie', alice.cookie)
        .send({ role: 'admin' })).status, 409);
      const bobCreatesImmediately = await scoped(app, 'post', '/api/events', bob.cookie, groupA).send({
        name: 'Bob Admin Event', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(bobCreatesImmediately.status, 201, JSON.stringify(bobCreatesImmediately.body));
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', bob.cookie).send({ password: bob.password })).status, 204);
      assert.equal((await request(app)
        .patch('/api/groups/' + groupA + '/members/' + bob.account.id)
        .set('Cookie', bob.cookie)
        .send({ role: 'owner' })).status, 403);

      const makeBobOwner = await request(app)
        .patch('/api/groups/' + groupA + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'owner' });
      assert.equal(makeBobOwner.status, 200, JSON.stringify(makeBobOwner.body));
      db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), bob.account.id);
      const activeOwnerGuard = await request(app)
        .patch('/api/groups/' + groupA + '/members/' + alice.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'member' });
      assert.equal(activeOwnerGuard.status, 409);
      db.prepare('UPDATE players SET deactivated_at = NULL WHERE id = ?').run(bob.account.id);
      const ownerRace = await Promise.all([
        request(app).patch('/api/groups/' + groupA + '/members/' + bob.account.id).set('Cookie', alice.cookie).send({ role: 'member' }),
        request(app).patch('/api/groups/' + groupA + '/members/' + alice.account.id).set('Cookie', bob.cookie).send({ role: 'member' }),
      ]);
      assert.equal(ownerRace.filter((response) => response.status === 200).length, 1);
      assert.ok(ownerRace.every((response) => [200, 403, 409].includes(response.status)));
      const owners = db.prepare(
        "SELECT player_id FROM group_memberships WHERE group_id = ? AND status = 'active' AND role = 'owner'"
      ).all(groupA);
      assert.equal(owners.length, 1);
      const owner = owners[0].player_id === alice.account.id ? alice : bob;
      const lastOwnerLeaves = await request(app).post('/api/groups/' + groupA + '/leave').set('Cookie', owner.cookie).send({});
      assert.equal(lastOwnerLeaves.status, 409);

      const removeAlice = await request(app)
        .delete('/api/groups/' + groupB + '/members/' + alice.account.id)
        .set('Cookie', carol.cookie);
      assert.equal(removeAlice.status, 204, JSON.stringify(removeAlice.body));
      assert.equal((await scoped(app, 'get', '/api/events/' + eventB.body.id, alice.cookie, groupB)).status, 404);
      assert.equal((await request(app).get('/api/me').set('Cookie', alice.cookie)).status, 200);

      const bobForeignAudit = await request(app).get('/api/groups/' + groupB + '/audit').set('Cookie', bob.cookie);
      assert.equal(bobForeignAudit.status, 404);
      const groupBAudit = await request(app).get('/api/groups/' + groupB + '/audit').set('Cookie', carol.cookie);
      assert.equal(groupBAudit.status, 200, JSON.stringify(groupBAudit.body));
      assert.ok(groupBAudit.body.some((entry) => entry.action === 'event_created' && entry.target_id === eventB.body.id));
      assert.equal(groupBAudit.body.some((entry) => entry.target_id === eventA.body.id), false);
      const instanceAudit = await request(app).get('/api/admin/audit').set('Cookie', alice.cookie);
      assert.equal(instanceAudit.status, 200, JSON.stringify(instanceAudit.body));
      assert.equal(instanceAudit.body.some((entry) => entry.action === 'event_created'), false);

      const cancelled = await scoped(app, 'delete', '/api/events/' + eventB.body.id, carol.cookie, groupB);
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.status, 'cancelled');
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol.cookie, groupB).send({})).status, 400);

      const archived = await request(app).delete('/api/groups/' + groupB).set('Cookie', carol.cookie);
      assert.equal(archived.status, 204, JSON.stringify(archived.body));
      assert.equal((await scoped(app, 'get', '/api/events/' + eventB.body.id, carol.cookie, groupB)).status, 404);
      const carolGroups = await request(app).get('/api/groups').set('Cookie', carol.cookie);
      assert.equal(carolGroups.body.some((group) => group.id === groupB), false);
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
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
      `group authorization child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
