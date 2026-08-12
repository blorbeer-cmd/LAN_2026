import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, enableTestTracking, TEST_ADMIN_ID } from './testApp';
import { BASE_EVENT_ID, db } from '../db';

const app = createTestApp();

async function createEvent(name: string, durationMs = 60_000) {
  const now = Date.now();
  return request(app).post('/api/events').send({ name, startsAt: now, endsAt: now + durationMs });
}

function accept(eventId: string, playerId: string): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted'`,
  ).run(eventId, playerId);
}

test('every account starts in the permanent base event', async () => {
  const active = await request(app).get('/api/events/active');
  assert.equal(active.status, 200);
  assert.equal(active.body.id, BASE_EVENT_ID);
  assert.equal(active.body.isBase, true);

  const list = await request(app).get('/api/events');
  assert.equal(list.status, 200);
  assert.equal(list.body.activeEvent.id, BASE_EVENT_ID);
  assert.ok(list.body.availableEvents.some((event: { id: string }) => event.id === BASE_EVENT_ID));
  assert.ok(Array.isArray(list.body.invitations));
  assert.ok(Array.isArray(list.body.managedEvents));
});

test('event creation validates name, required timestamps and ordering', async () => {
  assert.equal(
    (await request(app).post('/api/events').send({ name: '  ', startsAt: Date.now(), endsAt: Date.now() + 1_000 })).status,
    400,
  );
  assert.equal((await request(app).post('/api/events').send({ name: 'Missing end', startsAt: Date.now() })).status, 400);
  const startsAt = Date.now() + 60_000;
  assert.equal(
    (await request(app).post('/api/events').send({ name: 'Zeitreise', startsAt, endsAt: startsAt - 1 })).status,
    400,
  );
  for (const visibilityScope of ['group', 'public']) {
    const deprecated = await request(app)
      .post('/api/events')
      .send({ name: `Legacy ${visibilityScope}`, startsAt, endsAt: startsAt + 60_000, visibilityScope });
    assert.equal(deprecated.status, 400);
  }
  const participantsOnly = await request(app)
    .post('/api/events')
    .send({ name: 'Teilnehmende', startsAt, endsAt: startsAt + 60_000, visibilityScope: 'participants' });
  assert.equal(participantsOnly.status, 201, JSON.stringify(participantsOnly.body));
});

let eventAId: string;
let eventBId: string;

test('overlapping events coexist and can both enable tracking', async () => {
  const [eventA, eventB] = await Promise.all([createEvent('LAN Winter 2027'), createEvent('Parallel-Event')]);
  assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
  assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
  eventAId = eventA.body.id;
  eventBId = eventB.body.id;

  const [startA, startB] = await Promise.all([
    request(app).post(`/api/events/${eventAId}/tracking/start`),
    request(app).post(`/api/events/${eventBId}/tracking/start`),
  ]);
  assert.equal(startA.status, 200, JSON.stringify(startA.body));
  assert.equal(startB.status, 200, JSON.stringify(startB.body));
  assert.equal(startA.body.trackingEnabled, true);
  assert.equal(startB.body.trackingEnabled, true);
});

test('tracking follows the reporting account active event only', async () => {
  const tracked = await request(app).post('/api/players').send({ name: 'Event Tracking Player' });
  const baseOnly = await request(app).post('/api/players').send({ name: 'Base Tracking Player' });
  enableTestTracking(tracked.body.id, eventAId);

  const trackedReport = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', tracked.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  const baseReport = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', baseOnly.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  assert.equal(trackedReport.body.tracked, true);
  assert.equal(baseReport.body.tracked, false);
  assert.equal(
    (db.prepare('SELECT event_id AS eventId FROM play_sessions WHERE player_id = ? AND ended_at IS NULL').get(
      tracked.body.id,
    ) as { eventId: string }).eventId,
    eventAId,
  );
});

test('operational writes use the requesting account active event', async () => {
  accept(eventAId, TEST_ADMIN_ID);
  const activated = await request(app).put('/api/me/active-event').send({ eventId: eventAId });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));

  const players = await Promise.all([
    request(app).post('/api/players').send({ name: 'Event Match A' }),
    request(app).post('/api/players').send({ name: 'Event Match B' }),
  ]);
  for (const player of players) accept(eventAId, player.body.id);
  const game = (await request(app).get('/api/games')).body[0];
  const match = await request(app).post('/api/matches').send({
    gameId: game.id,
    teams: [{ playerIds: [players[0].body.id] }, { playerIds: [players[1].body.id] }],
    winnerTeamIndex: 0,
  });
  assert.equal(match.status, 201, JSON.stringify(match.body));
  assert.equal(match.body.eventId, eventAId);
});

test('stopping tracking does not remove the event workspace', async () => {
  const stopped = await request(app).post(`/api/events/${eventAId}/tracking/stop`);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.trackingEnabled, false);
  assert.equal((await request(app).get('/api/events/active')).body.id, eventAId);
});

test('ending the active event falls the account back to the base event', async () => {
  const ended = await request(app).post(`/api/events/${eventAId}/end`);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal(ended.body.isEnded, true);
  assert.equal((await request(app).get('/api/events/active')).body.id, BASE_EVENT_ID);
  assert.equal((await request(app).post(`/api/events/${eventAId}/tracking/start`)).status, 400);
});

test('the base event cannot be ended, cancelled or removed from the roster', async () => {
  assert.equal((await request(app).post(`/api/events/${BASE_EVENT_ID}/end`)).status, 409);
  assert.equal((await request(app).delete(`/api/events/${BASE_EVENT_ID}`)).status, 409);
  assert.equal((await request(app).delete(`/api/events/${BASE_EVENT_ID}/participants/${TEST_ADMIN_ID}`)).status, 409);
});

test('event metadata remains editable without changing tracking state', async () => {
  const before = await request(app).get(`/api/events/${eventBId}`);
  const updated = await request(app).patch(`/api/events/${eventBId}`).send({ location: 'Neue Halle' });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.location, 'Neue Halle');
  assert.equal(updated.body.trackingEnabled, before.body.trackingEnabled);

  const invalid = await request(app).patch(`/api/events/${eventBId}`).send({ endsAt: updated.body.starts_at - 1 });
  assert.equal(invalid.status, 400);
});

test('unknown events stay non-enumerable', async () => {
  assert.equal((await request(app).get('/api/events/does-not-exist')).status, 404);
  assert.equal((await request(app).put('/api/me/active-event').send({ eventId: 'does-not-exist' })).status, 404);
});
