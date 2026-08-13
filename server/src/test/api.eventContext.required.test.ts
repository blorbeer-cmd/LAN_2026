import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db } from '../db';
import { cancelEvent, createEvent, endEvent, removeEventParticipant } from '../events';
import { createInvite } from '../invites';
import { SESSION_COOKIE_NAME } from '../sessions';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { historicallyParticipatedEventIds } from '../eventContext';

const app = createTestApp();

function responseCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(cookie, 'response should set a session cookie');
  return cookie.split(';')[0];
}

function participantStatus(eventId: string, playerId: string): string | undefined {
  return (
    db.prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?').get(eventId, playerId) as
      { status: string } | undefined
  )?.status;
}

test('event-bound registration atomically joins base and target and selects the target', async () => {
  const target = createEvent('Event-Kontext Ziel', {
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
  });

  const issued = await request(app).post('/api/auth/invites').send({ purpose: 'register', eventId: target.id });
  assert.equal(issued.status, 201);
  assert.equal(issued.body.eventId, target.id);
  assert.equal(issued.body.eventName, target.name);

  const listed = await request(app).get('/api/auth/invites');
  const listedInvite = listed.body.find((entry: { code: string }) => entry.code === issued.body.code);
  assert.equal(listedInvite.eventId, target.id);
  assert.equal(listedInvite.eventName, target.name);

  const registered = await request(app)
    .post('/api/auth/register')
    .send({ code: issued.body.code, name: 'Event Context Member', password: 'event context password' });
  assert.equal(registered.status, 201);
  const playerId = registered.body.id as string;
  const cookie = responseCookie(registered);

  assert.equal(participantStatus(BASE_EVENT_ID, playerId), 'accepted');
  assert.equal(participantStatus(target.id, playerId), 'accepted');
  assert.deepEqual(db.prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?').get(playerId), {
    active_event_id: target.id,
  });
  assert.ok(db.prepare('SELECT used_at FROM invites WHERE code = ? AND used_at IS NOT NULL').get(issued.body.code));

  const active = await request(app).get('/api/me/active-event').set('Cookie', cookie);
  assert.equal(active.status, 200);
  assert.equal(active.body.id, target.id);
  assert.equal(active.body.isBase, false);

  const switched = await request(app)
    .put('/api/me/active-event')
    .set('Cookie', cookie)
    .send({ eventId: BASE_EVENT_ID });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.id, BASE_EVENT_ID);
  assert.equal(switched.body.isBase, true);

  const unavailable = createEvent('Nicht freigegebenes Event', {
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
  });
  const denied = await request(app).put('/api/me/active-event').set('Cookie', cookie).send({ eventId: unavailable.id });
  assert.equal(denied.status, 404);
  assert.deepEqual(db.prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?').get(playerId), {
    active_event_id: BASE_EVENT_ID,
  });

  const selectedAgain = await request(app)
    .put('/api/me/active-event')
    .set('Cookie', cookie)
    .send({ eventId: target.id });
  assert.equal(selectedAgain.status, 200);
  assert.ok(endEvent(target.id));

  const repaired = await request(app).get('/api/me/active-event').set('Cookie', cookie);
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.id, BASE_EVENT_ID);
  assert.ok(historicallyParticipatedEventIds(playerId).includes(target.id));
  assert.equal(endEvent(BASE_EVENT_ID), undefined);
  assert.equal(cancelEvent(BASE_EVENT_ID), undefined);
});

test('removing current participation preserves history and falls back to the base event', async () => {
  const player = db
    .prepare("SELECT id FROM players WHERE name = 'Event Context Member'")
    .get() as { id: string };
  const event = createEvent('Historisch erhaltenes Event', {
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
  });
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    event.id,
    player.id,
  );
  db.prepare(
    'UPDATE player_event_contexts SET active_event_id = ?, updated_at = ? WHERE player_id = ?',
  ).run(event.id, Date.now(), player.id);

  assert.equal(removeEventParticipant(event.id, player.id), 'accepted');
  assert.equal(participantStatus(event.id, player.id), undefined);
  assert.ok(historicallyParticipatedEventIds(player.id).includes(event.id));
  assert.deepEqual(db.prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?').get(player.id), {
    active_event_id: BASE_EVENT_ID,
  });
});

test('registration rolls back completely when its invited event became unavailable', async () => {
  const target = createEvent('Später abgesagtes Event', {
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
  });
  const invite = createInvite({
    purpose: 'register',
    eventId: target.id,
    createdBy: TEST_ADMIN_ID,
  });
  assert.ok(cancelEvent(target.id));

  const registered = await request(app)
    .post('/api/auth/register')
    .send({ code: invite.code, name: 'Rolled Back Event Member', password: 'rollback event password' });
  assert.equal(registered.status, 400);
  assert.equal(db.prepare('SELECT id FROM players WHERE name = ?').get('Rolled Back Event Member'), undefined);
  assert.deepEqual(db.prepare('SELECT used_at, used_by FROM invites WHERE code = ?').get(invite.code), {
    used_at: null,
    used_by: null,
  });
});

test('two parallel registrations can consume an event invite only once', async () => {
  const target = createEvent('Paralleles Einladungsziel', {
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
  });
  const invite = createInvite({ purpose: 'register', eventId: target.id, createdBy: TEST_ADMIN_ID });

  const responses = await Promise.all([
    request(app)
      .post('/api/auth/register')
      .send({ code: invite.code, name: `Parallel A ${nanoid(5)}`, password: 'parallel event password' }),
    request(app)
      .post('/api/auth/register')
      .send({ code: invite.code, name: `Parallel B ${nanoid(5)}`, password: 'parallel event password' }),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status).sort((a, b) => a - b),
    [201, 400],
  );
  const winner = responses.find((response) => response.status === 201)!;
  assert.equal(participantStatus(BASE_EVENT_ID, winner.body.id), 'accepted');
  assert.equal(participantStatus(target.id, winner.body.id), 'accepted');
  assert.deepEqual(
    db.prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?').get(winner.body.id),
    {
      active_event_id: target.id,
    },
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM players WHERE name LIKE ?').get('Parallel %') as { count: number })
      .count,
    1,
  );
});
