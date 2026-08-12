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
    const { db, DEFAULT_GROUP_ID, BASE_EVENT_ID } = require(${JSON.stringify(DB_JS_PATH)});

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

      // The invitation must reach the invitee as a notification. It has to be
      // recorded against the base event: the invitee is by definition not an
      // accepted participant of the event being offered, and notifyPlayers
      // only delivers inside its scope event's accepted set.
      const invitationTopic = 'event-invitation:' + event.body.id + ':' + bob.account.id;
      function invitationPushRows() {
        return db
          .prepare('SELECT event_id AS eventId, audience, player_ids AS playerIds, url, resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
          .all(invitationTopic);
      }
      const invitationPushes = invitationPushRows();
      assert.equal(invitationPushes.length, 1, 'a repeated invite must not notify a second time');
      assert.equal(invitationPushes[0].eventId, BASE_EVENT_ID);
      assert.equal(invitationPushes[0].audience, 'direct');
      assert.equal(invitationPushes[0].url, '/#settings');
      assert.deepEqual(JSON.parse(invitationPushes[0].playerIds), [bob.account.id]);
      assert.equal(invitationPushes[0].resolvedAt, null);
      // It is genuinely readable for the invitee, whatever workspace is
      // active for them — that is the whole point of notifying them about an
      // event they cannot see yet.
      const invitationFeed = await call(app, 'get', '/api/push/log', bob);
      assert.equal(invitationFeed.status, 200);
      assert.ok(
        invitationFeed.body.entries.some((entry) => entry.title === 'Event-Einladung' && entry.body.includes('Invitation Event')),
        'the invitee must see the invitation in their notification feed',
      );

      const invitedList = await call(app, 'get', '/api/events', bob);
      const invitedEvent = invitedList.body.invitations.find((entry) => entry.id === event.body.id);
      assert.equal(invitedEvent.participationStatus, 'invited');
      assert.equal('participantIds' in invitedEvent, false);
      assert.equal('participants' in invitedEvent, false);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + event.body.id, bob)).status, 404);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + event.body.id, owner)).status, 404);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/tracking-consent', bob)).status, 409);

      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', carol)).status, 409);
      const firstAccept = await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', bob);
      assert.equal(firstAccept.status, 200, JSON.stringify(firstAccept.body));
      const repeatedAccept = await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', bob);
      assert.equal(repeatedAccept.status, 200, JSON.stringify(repeatedAccept.body));
      // Answering the invitation retires its notification: it stays in the
      // history, but stops being an open item in banners.
      assert.notEqual(invitationPushRows()[0].resolvedAt, null, 'accepting must resolve the invitation notification');
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/tracking-consent', bob)).status, 200);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + event.body.id, bob)).status, 200);
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/invitation/decline', bob)).status, 409);

      const acceptedEvent = (await call(app, 'get', '/api/events/' + event.body.id, bob)).body;
      assert.deepEqual(acceptedEvent.participantIds, [bob.account.id]);
      assert.equal('participants' in acceptedEvent, false);

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
      assert.equal((await call(app, 'get', '/api/events/' + declineEvent.body.id, bob)).status, 404);
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + declineEvent.body.id, bob)).status, 404);

      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      const race = await Promise.all([
        call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', bob),
        call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob),
      ]);
      assert.equal(race.filter((response) => response.status === 200).length, 1, race.map((response) => response.status).join(','));
      assert.equal(race.filter((response) => response.status === 409).length, 1);
      const finalEvent = (await call(app, 'get', '/api/events/' + declineEvent.body.id, owner)).body;
      const finalStatus = finalEvent.participants.find((entry) => entry.playerId === bob.account.id).status;
      assert.ok(['accepted', 'declined'].includes(finalStatus));
      assert.equal(finalEvent.participantIds.includes(bob.account.id), finalStatus === 'accepted');

      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', carol)).status, 409);
      assert.equal((await call(app, 'post', '/api/events/missing/invitation/accept', bob)).status, 404);

      const scopeEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Invitation Scope Event', startsAt: now, endsAt: now + 60_000, visibilityScope: 'participants',
      });
      assert.equal(scopeEvent.status, 201, JSON.stringify(scopeEvent.body));
      db.prepare('UPDATE events SET tracking_enabled = 1 WHERE id = ?').run(scopeEvent.body.id);
      db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'invited')").run(scopeEvent.body.id, bob.account.id);
      db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'declined')").run(scopeEvent.body.id, carol.account.id);

      const bobEvents = (await call(app, 'get', '/api/events', bob)).body;
      const carolEvents = (await call(app, 'get', '/api/events', carol)).body;
      const ownerEvents = (await call(app, 'get', '/api/events', owner)).body;
      assert.ok(bobEvents.invitations.some((event) => event.id === scopeEvent.body.id));
      assert.ok(!carolEvents.availableEvents.some((event) => event.id === scopeEvent.body.id));
      assert.ok(!carolEvents.invitations.some((event) => event.id === scopeEvent.body.id));
      assert.ok(ownerEvents.managedEvents.some((event) => event.id === scopeEvent.body.id));
      assert.ok(bobEvents.availableEvents.some((event) => event.isBase));

      const explicitScopedRoutes = (actor) => [
        ['/api/broadcasts?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/info?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/players/' + actor.account.id + '/neighbors?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/players/' + actor.account.id + '/stats?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/push/last?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/analytics/arcade?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/arcade/stats?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/seating?eventId=' + scopeEvent.body.id, 'get'],
        ['/api/votes/history?eventId=' + scopeEvent.body.id, 'get'],
      ];
      for (const actor of [bob, carol]) {
        for (const [path, method] of explicitScopedRoutes(actor)) {
          assert.equal((await call(app, method, path, actor)).status, 404, method.toUpperCase() + ' ' + path + ' must reject ' + actor.account.name);
        }
      }

      const implicitActiveEventRoutes = (actor) => [
        '/api/arrivals',
        '/api/food-orders',
        '/api/broadcasts',
        '/api/info',
        '/api/players/' + actor.account.id + '/neighbors',
        '/api/players/' + actor.account.id + '/stats',
        '/api/push/last',
        '/api/push/current?playerId=' + actor.account.id,
        '/api/push/log?playerId=' + actor.account.id,
        '/api/seating',
        '/api/seating/layout',
        '/api/pings',
        '/api/votes/history',
        '/api/checklist/items?playerId=' + actor.account.id,
        '/api/checklist/tasks',
        '/api/arcade/lobbies',
      ];
      for (const actor of [bob, carol]) {
        for (const path of implicitActiveEventRoutes(actor)) {
          const response = await call(app, 'get', path, actor);
          assert.equal(response.status, 200, 'GET ' + path + ' must use the active base event for ' + actor.account.name + ': ' + JSON.stringify(response.body));
        }
      }

      db.prepare("UPDATE event_participants SET status = 'accepted' WHERE event_id = ? AND player_id = ?").run(scopeEvent.body.id, bob.account.id);
      const acceptedEvents = (await call(app, 'get', '/api/events', bob)).body;
      assert.ok(acceptedEvents.availableEvents.some((event) => event.id === scopeEvent.body.id));
      for (const [path, method] of explicitScopedRoutes(bob)) {
        assert.equal((await call(app, method, path, bob)).status, 200, method.toUpperCase() + ' ' + path + ' must admit accepted participants');
      }
      for (const [path, method] of explicitScopedRoutes(owner)) {
        assert.equal((await call(app, method, path, owner)).status, 404, method.toUpperCase() + ' ' + path + ' must not bypass event participation');
      }
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  try {
    execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
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
