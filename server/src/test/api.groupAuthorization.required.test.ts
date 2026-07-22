// Single-group tenant-boundary integration suite: role permissions, event
// resource ownership, audit isolation and last-owner protection inside the
// one group every account belongs to. Configuration is import-time, so this
// runs in an isolated required-auth child process.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'group-authorization-recovery-code';

test('group roles, event resources and audit stay isolated inside the one real group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }
    function scoped(app, method, path, sessionCookie) {
      return request(app)[method](path).set('Cookie', sessionCookie).set('x-group-id', DEFAULT_GROUP_ID);
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

      // Every account lands in the one and only group automatically
      // (ensureDefaultGroupMembership) - alice is its first real account and
      // becomes owner, bob and carol join as plain members, no invite step.
      const bob = await register('Matrix Bob', 'matrix bob secure passphrase');
      const carol = await register('Matrix Carol', 'matrix carol secure passphrase');

      // The instance's sole owner can never be deactivated - group_memberships
      // has no other active owner to fall back to. Alice is also still the
      // instance's last admin, so that guard reports first; the dedicated
      // group-owner guard is exercised further below once ownership moves.
      const deactivateSoleOwner = await request(app)
        .post('/api/players/' + alice.account.id + '/deactivate')
        .set('Cookie', alice.cookie);
      assert.equal(deactivateSoleOwner.status, 409);

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie).send({
        name: 'Event A', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventA.body.groupId, DEFAULT_GROUP_ID);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie).send({})).status, 200);

      const bobEventsA = await scoped(app, 'get', '/api/events', bob.cookie);
      assert.equal(bobEventsA.status, 200);
      assert.ok(bobEventsA.body.some((event) => event.id === eventA.body.id));
      const bobCreateDenied = await scoped(app, 'post', '/api/events', bob.cookie).send({
        name: 'Forbidden', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(bobCreateDenied.status, 403);
      assert.equal((await request(app).post('/api/groups/' + DEFAULT_GROUP_ID + '/test-users').set('Cookie', bob.cookie).send({ count: 1 })).status, 403);

      // A nonexistent player id can never be smuggled into the participant list.
      const foreignParticipant = await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie)
        .send({ playerIds: ['does-not-exist'] });
      assert.equal(foreignParticipant.status, 404);
      const ownParticipant = await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie)
        .send({ playerIds: [bob.account.id] });
      assert.equal(ownParticipant.status, 200, JSON.stringify(ownParticipant.body));

      const promoteBob = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'admin' });
      assert.equal(promoteBob.status, 200, JSON.stringify(promoteBob.body));
      // Required mode derives the instance-wide is_admin flag from the group
      // role (groups.ts, changeGroupMemberRole) so the two flags can no
      // longer silently diverge (docs/plans/reset-single-group.md §9.1).
      assert.equal(db.prepare('SELECT is_admin FROM players WHERE id = ?').get(bob.account.id).is_admin, 1);
      const testUsers = await request(app)
        .post('/api/groups/' + DEFAULT_GROUP_ID + '/test-users')
        .set('Cookie', bob.cookie)
        .send({ count: 1 });
      assert.equal(testUsers.status, 201, JSON.stringify(testUsers.body));
      const testPlayerId = testUsers.body.created[0].id;
      assert.deepEqual(
        db.prepare('SELECT test_owner_group_id FROM players WHERE id = ?').get(testPlayerId),
        { test_owner_group_id: DEFAULT_GROUP_ID },
      );
      assert.equal((await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + testPlayerId)
        .set('Cookie', alice.cookie)
        .send({ role: 'admin' })).status, 409);
      const bobCreatesImmediately = await scoped(app, 'post', '/api/events', bob.cookie).send({
        name: 'Bob Admin Event', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(bobCreatesImmediately.status, 201, JSON.stringify(bobCreatesImmediately.body));
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', bob.cookie).send({ password: bob.password })).status, 204);
      assert.equal((await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + bob.account.id)
        .set('Cookie', bob.cookie)
        .send({ role: 'owner' })).status, 403);

      const makeBobOwner = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'owner' });
      assert.equal(makeBobOwner.status, 200, JSON.stringify(makeBobOwner.body));
      db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), bob.account.id);
      const activeOwnerGuard = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + alice.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'member' });
      assert.equal(activeOwnerGuard.status, 409);
      db.prepare('UPDATE players SET deactivated_at = NULL WHERE id = ?').run(bob.account.id);
      const ownerRace = await Promise.all([
        request(app).patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + bob.account.id).set('Cookie', alice.cookie).send({ role: 'member' }),
        request(app).patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + alice.account.id).set('Cookie', bob.cookie).send({ role: 'member' }),
      ]);
      assert.equal(ownerRace.filter((response) => response.status === 200).length, 1);
      assert.ok(ownerRace.every((response) => [200, 403, 409].includes(response.status)));
      const owners = db.prepare(
        "SELECT player_id FROM group_memberships WHERE group_id = ? AND status = 'active' AND role = 'owner'"
      ).all(DEFAULT_GROUP_ID);
      assert.equal(owners.length, 1);
      // The demoted co-owner also loses the instance-wide is_admin flag; the
      // remaining owner keeps it. Confirms the sync stays correct even under
      // the concurrent role-change race above, not just for a solo change.
      const demotedOwnerId = owners[0].player_id === alice.account.id ? bob.account.id : alice.account.id;
      assert.equal(db.prepare('SELECT is_admin FROM players WHERE id = ?').get(demotedOwnerId).is_admin, 0);
      assert.equal(db.prepare('SELECT is_admin FROM players WHERE id = ?').get(owners[0].player_id).is_admin, 1);

      // The start group can never lose a member through the removal endpoint
      // (see routes/groups.ts) - deactivating the account is the sanctioned,
      // reversible path instead.
      const blockedRemoval = await request(app)
        .delete('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + carol.account.id)
        .set('Cookie', alice.cookie);
      assert.equal(blockedRemoval.status, 409);

      const groupAudit = await request(app).get('/api/groups/' + DEFAULT_GROUP_ID + '/audit').set('Cookie', alice.cookie);
      assert.equal(groupAudit.status, 200, JSON.stringify(groupAudit.body));
      assert.ok(groupAudit.body.some((entry) => entry.action === 'event_created' && entry.target_id === eventA.body.id));
      const carolForeignAudit = await request(app).get('/api/groups/' + DEFAULT_GROUP_ID + '/audit').set('Cookie', carol.cookie);
      assert.equal(carolForeignAudit.status, 403, 'a plain member has no audit access');
      const instanceAudit = await request(app).get('/api/admin/audit').set('Cookie', alice.cookie);
      assert.equal(instanceAudit.status, 200, JSON.stringify(instanceAudit.body));
      assert.equal(instanceAudit.body.some((entry) => entry.action === 'event_created'), false, 'group actions never leak into the instance-wide audit');

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice.cookie).send({})).status, 200);
      const cancelled = await scoped(app, 'delete', '/api/events/' + eventA.body.id, alice.cookie);
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.status, 'cancelled');
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
