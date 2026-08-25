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

      async function registerWithCode(code, name) {
        const response = await request(app).post('/api/auth/register').send({
          code,
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
        name: 'Invitation Event', startsAt: now, endsAt: now + 5 * 60_000,
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
      assert.equal(invitationPushes[0].url, '/#profile');
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
      assert.equal('acceptedParticipants' in invitedEvent, false);
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
      // This event already started, so the acceptance can no longer be
      // withdrawn: by then the participation is a fact, not an intention.
      const lateWithdrawal = await call(app, 'post', '/api/events/' + event.body.id + '/invitation/decline', bob);
      assert.equal(lateWithdrawal.status, 409, JSON.stringify(lateWithdrawal.body));
      assert.equal(lateWithdrawal.body.reason, 'started');
      assert.equal(lateWithdrawal.body.currentStatus, 'accepted');
      const runningParticipation = (await call(app, 'get', '/api/events/' + event.body.id, bob)).body.myParticipation;
      assert.equal(runningParticipation.canDecline, false);
      assert.equal(runningParticipation.lockReason, 'started');

      const acceptedEvent = (await call(app, 'get', '/api/events/' + event.body.id, bob)).body;
      assert.deepEqual(acceptedEvent.participantIds, [bob.account.id]);
      assert.equal('participants' in acceptedEvent, false);

      const removed = await call(app, 'delete', '/api/events/' + event.body.id + '/participants/' + bob.account.id, owner);
      assert.equal(removed.status, 204);
      // Removal is the only way the event disappears from the account's app
      // entirely, so someone who was still counting on it is told about it.
      function removalPushRow(eventId, playerId) {
        return db
          .prepare('SELECT event_id AS eventId, audience, player_ids AS playerIds FROM push_log WHERE topic_key = ?')
          .get('event-participation-removed:' + eventId + ':' + playerId);
      }
      const removalPush = removalPushRow(event.body.id, bob.account.id);
      assert.ok(removalPush, 'removing an accepted participant must notify them');
      assert.equal(removalPush.eventId, BASE_EVENT_ID);
      assert.equal(removalPush.audience, 'direct');
      assert.deepEqual(JSON.parse(removalPush.playerIds), [bob.account.id]);
      const acceptWithoutInvitation = await call(app, 'post', '/api/events/' + event.body.id + '/invitation/accept', bob);
      assert.equal(acceptWithoutInvitation.status, 409);
      assert.equal(acceptWithoutInvitation.body.reason, 'not_invited');
      assert.equal((await call(app, 'post', '/api/events/' + event.body.id + '/end', owner)).status, 200);
      const lateInvite = await call(app, 'post', '/api/events/' + event.body.id + '/invitations', owner)
        .send({ playerId: bob.account.id });
      assert.equal(lateInvite.status, 409);

      // Withdrawing an unanswered invitation is the third way it stops being
      // open. Its notification must retire with it, or the banner keeps
      // asking about an event the account can no longer see at all.
      const withdrawnEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Withdrawn Event', startsAt: now, endsAt: now + 5 * 60_000,
      });
      assert.equal(withdrawnEvent.status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + withdrawnEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      const withdrawnTopic = 'event-invitation:' + withdrawnEvent.body.id + ':' + bob.account.id;
      function withdrawnPushRow() {
        return db.prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?').get(withdrawnTopic);
      }
      assert.equal(withdrawnPushRow().resolvedAt, null, 'the invitation is an open item first');
      assert.equal((await call(app, 'delete', '/api/events/' + withdrawnEvent.body.id + '/participants/' + bob.account.id, owner)).status, 204);
      assert.notEqual(withdrawnPushRow().resolvedAt, null, 'withdrawing must resolve the invitation notification');

      const declineEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Decline Event', startsAt: now, endsAt: now + 5 * 60_000,
      });
      assert.equal(declineEvent.status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      // Saying no to a still-open invitation stays possible even while the
      // event runs — that is exactly the answer the organizer asked for.
      const firstDecline = await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob);
      assert.equal(firstDecline.status, 200, JSON.stringify(firstDecline.body));
      assert.equal(firstDecline.body.changed, true);
      const repeatedDecline = await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob);
      assert.equal(repeatedDecline.status, 200);
      assert.equal(repeatedDecline.body.changed, false, 'repeating the standing answer changes nothing');
      // The declined event keeps its teaser: findable, answerable again, and
      // still carrying no roster or event data at all.
      const declinedTeaser = await call(app, 'get', '/api/events/' + declineEvent.body.id, bob);
      assert.equal(declinedTeaser.status, 200, JSON.stringify(declinedTeaser.body));
      assert.equal(declinedTeaser.body.participationStatus, 'declined');
      assert.equal(declinedTeaser.body.myParticipation.canAccept, true);
      assert.equal(declinedTeaser.body.myParticipation.lockReason, null);
      for (const field of ['participantIds', 'participants', 'acceptedParticipants']) {
        assert.equal(field in declinedTeaser.body, false, field + ' must stay out of a teaser');
      }
      assert.equal((await call(app, 'get', '/api/seating?eventId=' + declineEvent.body.id, bob)).status, 404);
      const afterDecline = (await call(app, 'get', '/api/events', bob)).body;
      assert.ok(afterDecline.declinedEvents.some((entry) => entry.id === declineEvent.body.id));
      assert.ok(!afterDecline.availableEvents.some((entry) => entry.id === declineEvent.body.id));
      assert.ok(!afterDecline.invitations.some((entry) => entry.id === declineEvent.body.id));
      // ...and the way back is a normal answer, not an organizer's favour.
      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', bob)).status, 200);
      const afterReturn = (await call(app, 'get', '/api/events', bob)).body;
      assert.ok(afterReturn.availableEvents.some((entry) => entry.id === declineEvent.body.id));
      assert.ok(!afterReturn.declinedEvents.some((entry) => entry.id === declineEvent.body.id));

      // Two identical answers at once must produce exactly one change.
      db.prepare("UPDATE event_participants SET status = 'invited' WHERE event_id = ? AND player_id = ?")
        .run(declineEvent.body.id, bob.account.id);
      const race = await Promise.all([
        call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob),
        call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/decline', bob),
      ]);
      assert.equal(race.filter((response) => response.status === 200).length, 2, race.map((response) => response.status).join(','));
      assert.equal(race.filter((response) => response.body.changed === true).length, 1, 'exactly one request may perform the change');
      const finalEvent = (await call(app, 'get', '/api/events/' + declineEvent.body.id, owner)).body;
      const finalStatus = finalEvent.participants.find((entry) => entry.playerId === bob.account.id).status;
      assert.equal(finalStatus, 'declined');
      assert.equal(finalEvent.participantIds.includes(bob.account.id), false);
      // A removal after the person's own decline stays silent: it only tidies
      // up a decision they made themselves.
      assert.equal((await call(app, 'delete', '/api/events/' + declineEvent.body.id + '/participants/' + bob.account.id, owner)).status, 204);
      assert.equal(
        removalPushRow(declineEvent.body.id, bob.account.id),
        undefined,
        'removing an already declined participant must not notify them',
      );

      assert.equal((await call(app, 'post', '/api/events/' + declineEvent.body.id + '/invitation/accept', carol)).status, 409);
      assert.equal((await call(app, 'post', '/api/events/missing/invitation/accept', bob)).status, 404);

      // Withdrawing an acceptance from an event that has not started yet: the
      // normal case this whole flow exists for.
      const upcoming = now + 7 * 24 * 60 * 60_000;
      const futureEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Future Event', startsAt: upcoming, endsAt: upcoming + 5 * 60_000,
      });
      assert.equal(futureEvent.status, 201, JSON.stringify(futureEvent.body));
      assert.equal((await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitations', owner).send({ playerId: carol.account.id })).status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitation/accept', carol)).status, 200);
      const acceptedParticipation = (await call(app, 'get', '/api/events/' + futureEvent.body.id, carol)).body.myParticipation;
      assert.equal(acceptedParticipation.canDecline, true);
      assert.equal(acceptedParticipation.lockReason, null);
      // Working inside the event and then leaving it must not strand the
      // account in a workspace it may no longer select.
      assert.equal((await request(app).put('/api/me/active-event').set('Cookie', carol.cookie).set('x-group-id', DEFAULT_GROUP_ID).send({ eventId: futureEvent.body.id })).status, 200);
      const withdrawal = await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitation/decline', carol);
      assert.equal(withdrawal.status, 200, JSON.stringify(withdrawal.body));
      assert.equal(withdrawal.body.changed, true);
      assert.equal((await call(app, 'get', '/api/events/active', carol)).body.id, BASE_EVENT_ID);
      // The organizer hears about a withdrawn yes, because it changes what
      // they are planning with.
      const withdrawalTopic = 'event-withdrawn-acceptance:' + futureEvent.body.id + ':' + carol.account.id;
      function withdrawalPush() {
        return db
          .prepare('SELECT event_id AS eventId, player_ids AS playerIds, resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
          .get(withdrawalTopic);
      }
      assert.ok(withdrawalPush(), 'a withdrawn acceptance must reach the organizer');
      assert.equal(withdrawalPush().eventId, BASE_EVENT_ID);
      assert.deepEqual(JSON.parse(withdrawalPush().playerIds), [owner.account.id]);
      assert.equal(withdrawalPush().resolvedAt, null);
      // A plain no to a still-open invitation does not: that is the answer the
      // organizer just asked for, and the roster shows it either way.
      assert.equal((await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitation/decline', bob)).status, 200);
      assert.equal(
        db.prepare('SELECT 1 FROM push_log WHERE topic_key = ?').get('event-withdrawn-acceptance:' + futureEvent.body.id + ':' + bob.account.id),
        undefined,
        'declining an open invitation must not notify the organizer',
      );
      // Coming back retires that notice again.
      assert.equal((await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitation/accept', carol)).status, 200);
      assert.notEqual(withdrawalPush().resolvedAt, null, 're-accepting must resolve the withdrawal notice');

      // A recorded payment is the organizer's to reverse, exactly like the
      // removal guard on the same row.
      db.prepare('UPDATE event_participants SET paid = 1 WHERE event_id = ? AND player_id = ?')
        .run(futureEvent.body.id, carol.account.id);
      const paidDecline = await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitation/decline', carol);
      assert.equal(paidDecline.status, 409, JSON.stringify(paidDecline.body));
      assert.equal(paidDecline.body.reason, 'paid');
      assert.equal((await call(app, 'get', '/api/events/' + futureEvent.body.id, carol)).body.myParticipation.lockReason, 'paid');
      db.prepare('UPDATE event_participants SET paid = 0 WHERE event_id = ? AND player_id = ?')
        .run(futureEvent.body.id, carol.account.id);

      // Nothing left to answer once the event is over or called off.
      const closedEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Closed Event', startsAt: upcoming, endsAt: upcoming + 5 * 60_000,
      });
      assert.equal(closedEvent.status, 201);
      assert.equal((await call(app, 'post', '/api/events/' + closedEvent.body.id + '/invitations', owner).send({ playerId: bob.account.id })).status, 201);
      db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(closedEvent.body.id);
      const cancelledAnswer = await call(app, 'post', '/api/events/' + closedEvent.body.id + '/invitation/accept', bob);
      assert.equal(cancelledAnswer.status, 409, JSON.stringify(cancelledAnswer.body));
      assert.equal(cancelledAnswer.body.reason, 'cancelled');
      db.prepare("UPDATE events SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), closedEvent.body.id);
      const endedAnswer = await call(app, 'post', '/api/events/' + closedEvent.body.id + '/invitation/accept', bob);
      assert.equal(endedAnswer.status, 409, JSON.stringify(endedAnswer.body));
      assert.equal(endedAnswer.body.reason, 'ended');
      // Repeating the answer that already stands stays idempotent even then.
      assert.equal((await call(app, 'post', '/api/events/' + futureEvent.body.id + '/invitation/accept', carol)).status, 200);

      const linkedEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Direct Link Event', startsAt: now, endsAt: now + 5 * 60_000,
      });
      assert.equal(linkedEvent.status, 201, JSON.stringify(linkedEvent.body));
      const registrationLink = await request(app)
        .post('/api/auth/invites')
        .set('Cookie', owner.cookie)
        .send({ purpose: 'register', eventId: linkedEvent.body.id });
      assert.equal(registrationLink.status, 201, JSON.stringify(registrationLink.body));
      assert.equal(registrationLink.body.eventId, linkedEvent.body.id);
      assert.ok(registrationLink.body.expiresAt > Date.now());
      assert.equal(registrationLink.body.reusable, true);
      const linkedBob = await registerWithCode(registrationLink.body.code, 'Direct Link Bob');
      const linkedAlice = await registerWithCode(registrationLink.body.code, 'Direct Link Alice');
      for (const linkedAccount of [linkedAlice, linkedBob]) {
        const active = await call(app, 'get', '/api/events/active', linkedAccount);
        assert.equal(active.status, 200, JSON.stringify(active.body));
        assert.equal(active.body.id, linkedEvent.body.id);
      }
      const linkedEventForMember = await call(app, 'get', '/api/events/' + linkedEvent.body.id, linkedAlice);
      assert.equal(linkedEventForMember.status, 200, JSON.stringify(linkedEventForMember.body));
      assert.deepEqual(
        linkedEventForMember.body.acceptedParticipants.map((participant) => participant.name),
        ['Direct Link Alice', 'Direct Link Bob'],
      );

      const scopeEvent = await call(app, 'post', '/api/events', owner).send({
        name: 'Invitation Scope Event', startsAt: now, endsAt: now + 5 * 60_000, visibilityScope: 'participants',
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
