import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'event-invitations-recovery-code';

test('event invitation lifecycle enforces roles, identity, transitions and atomic races', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }
    function call(app, method, path, actor) {
      return request(app)[method](path).set('Cookie', actor.cookie).set('x-group-id', DEFAULT_GROUP_ID);
    }

    (async () => {
      const app = createApp();
      const ownerResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Invitation Owner',
        password: 'invitation owner secure passphrase',
      });
      assert.equal(ownerResponse.status, 201, JSON.stringify(ownerResponse.body));
      const owner = { account: ownerResponse.body, cookie: cookie(ownerResponse) };
      assert.equal(
        (await request(app)
          .post('/api/auth/reauth')
          .set('Cookie', owner.cookie)
          .send({ password: 'invitation owner secure passphrase' })).status,
        204,
      );

      async function register(name) {
        const invite = await request(app)
          .post('/api/auth/invites')
          .set('Cookie', owner.cookie)
          .send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({
          code: invite.body.code,
          name,
          password: name.toLowerCase().replace(/ /g, '-') + '-secure-passphrase',
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response) };
      }

      const bob = await register('Invitation Bob');
      const carol = await register('Invitation Carol');
      const disabled = await register('Invitation Disabled');
      const now = Date.now();
      const event = await call(app, 'post', '/api/events', owner).send({
        name: 'Invitation Event', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(event.status, 201, JSON.stringify(event.body));

      const memberCannotInvite = await call(app, 'post', '/api/events/' + event.body.id + '/invitations', carol)
        .send({ playerId: bob.account.id });
      assert.equal(memberCannotInvite.status, 403);
      assert.equal((await call(app, 'post', '/api/events/missing/invitations', owner).send({ playerId: bob.account.id })).status, 404);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitations', owner).send({ playerId: 'missing' })).status, 404);

      db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), disabled.account.id);
      const disabledInvite = await call(app, 'post', '/api/events/' + event.body.id + '/invitations', owner)
        .send({ playerId: disabled.account.id });
      assert.equal(disabledInvite.status, 404);

      const invited = await call(app, 'post', '/api/events/' + event.body.id + '/invitations', owner)
        .send({ playerId: bob.account.id });
      assert.equal(invited.status, 201, JSON.stringify(invited.body));
      assert.deepEqual(invited.body, { playerId: bob.account.id, status: 'invited' });
      const repeatedInvite = await call(app, 'post', '/api/events/' + event.body.id + '/invitations', owner)
        .send({ playerId: bob.account.id });
      assert.equal(repeatedInvite.status, 200);
      assert.equal(repeatedInvite.body.status, 'invited');

      const invitedList = await call(app, 'get', '/api/events', bob);
      const invitedEvent = invitedList.body.find((entry) => entry.id === event.body.id);
      assert.deepEqual(invitedEvent.participantIds, []);
      assert.deepEqual(invitedEvent.participants, [{ playerId: bob.account.id, status: 'invited' }]);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + event.body.id, bob)).status, 404);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + event.body.id, owner)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/tracking-consent', bob)).status, 409);

      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', carol)).status, 409);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', bob)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', bob)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/tracking-consent', bob)).status, 200);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + event.body.id, bob)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/decline', bob)).status, 409);

      const acceptedEvent = (await call(app, 'get', '/api/events/' + event.body.id, bob)).body;
      assert.deepEqual(acceptedEvent.participantIds, [bob.account.id]);
      assert.deepEqual(acceptedEvent.participants, [{ playerId: bob.account.id, status: 'accepted' }]);

      const removed = await call(app, 'delete', '/api/events/' + event.body.id + '/participants/' + bob.account.id, owner);
      assert.equal(removed.status, 204);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', bob)).status, 409);

      const declineEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Decline Event', startsAt: now, endsAt: now + 60_000,
      });
      assert.equal(declineEvent.status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', bob)).status, 409);
      const declined = (await call(app, 'get', '/api/events/' + declineEvent.body.id, bob)).body;
      assert.deepEqual(declined.participantIds, []);
      assert.equal(declined.participants[0].status, 'declined');
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + declineEvent.body.id, bob)).status, 404);

      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      const race = await Promise.all([
        call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', bob),
        call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob),
      ]);
      assert.equal(race.filter((response) => response.status === 200).length, 1, race.map((response) => response.status).join(','));
      assert.equal(race.filter((response) => response.status === 409).length, 1);
      const finalEvent = (await call(app, 'get', '/api/events/' + declineEvent.body.id, bob)).body;
      const finalStatus = finalEvent.participants.find((entry) => entry.playerId === bob.account.id).status;
      assert.ok(['accepted', 'declined'].includes(finalStatus));
      assert.equal(finalEvent.participantIds.includes(bob.account.id), finalStatus === 'accepted');

      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', carol)).status, 409);
      assert.equal((await call(app, 'post', '/api/events/missing/invitation/accept', bob)).status, 404);
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
      `event invitations child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
