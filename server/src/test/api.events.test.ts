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
  assert.equal(
    list.body.managedEvents.some((event: { id: string }) => event.id === BASE_EVENT_ID),
    false,
    'the immutable base workspace is not rendered as a manageable LAN event',
  );
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

  const invalid = await request(app).patch(`/api/events/${eventBId}`).send({ endsAt: updated.body.startsAt - 1 });
  assert.equal(invalid.status, 400);
});

test('the management shape is a strict superset of the summary shape', async () => {
  // A member only ever receives the summary shape, an admin additionally the
  // management shape — and both render through the same frontend cards. When
  // the two disagreed on field names (`starts_at` vs. `startsAt`), every
  // member-visible event showed "Invalid Date" and "0 Teilnehmer".
  const created = await createEvent('Shape-Vergleich');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  accept(created.body.id, TEST_ADMIN_ID);
  const list = await request(app).get('/api/events');
  assert.equal(list.status, 200);

  const summary = list.body.availableEvents.find((event: { id: string }) => event.id === created.body.id);
  const managed = list.body.managedEvents.find((event: { id: string }) => event.id === created.body.id);
  assert.ok(summary, 'the accepted event is part of the personal workspace list');
  assert.ok(managed, 'the same event is part of the administrative catalog');

  for (const [key, value] of Object.entries(summary)) {
    assert.deepEqual(managed[key], value, `management and summary shape disagree on "${key}"`);
  }
  assert.equal(typeof summary.startsAt, 'number');
  assert.equal(managed.starts_at, undefined, 'the snake_case duplicate is gone for good');
  assert.equal(managed.ends_at, undefined, 'the snake_case duplicate is gone for good');
  assert.ok(Array.isArray(managed.participantIds), 'only the management shape carries participants');
  assert.equal(summary.participantIds, undefined, 'a member never receives the participant roster');

  // The lifecycle state itself is not management data: the workspace switcher
  // labels every event it offers with it, and a member only ever receives the
  // summary shape. It describes the event, never its participants — the
  // roster above stays management-only.
  assert.equal(typeof summary.trackingEnabled, 'boolean', 'the switcher needs the tracking state of every workspace');
  assert.equal(typeof summary.isEnded, 'boolean', 'the switcher distinguishes an ended event from a running one');
});

test('the workspace list reports the lifecycle state it labels events with', async () => {
  const created = await createEvent('Statusanzeige');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  accept(created.body.id, TEST_ADMIN_ID);

  const idle = await request(app).get('/api/events');
  const beforeTracking = idle.body.availableEvents.find((event: { id: string }) => event.id === created.body.id);
  assert.equal(beforeTracking.trackingEnabled, false);
  assert.equal(beforeTracking.isEnded, false);

  const started = await request(app).post(`/api/events/${created.body.id}/tracking/start`);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const tracking = await request(app).get('/api/events');
  const whileTracking = tracking.body.availableEvents.find((event: { id: string }) => event.id === created.body.id);
  assert.equal(whileTracking.trackingEnabled, true, 'a tracking event is distinguishable in the switcher');

  // The permanent base workspace is always offered and never reports as ended.
  const base = tracking.body.availableEvents.find((event: { isBase: boolean }) => event.isBase);
  assert.ok(base, 'the base workspace stays selectable');
  assert.equal(base.isEnded, false);
});

test('the participation history keeps a finished event available to personal analytics', async () => {
  // Two lists with two different jobs. `availableEvents` answers "where can I
  // work right now" and therefore drops an event the moment it ends;
  // `historicalEvents` answers "what did I take part in" and must keep it,
  // because a finished LAN is the main thing anyone opens an event filter
  // for. The analytics endpoints accept exactly the second list
  // (resolveAnalyticsEvents), so a filter built from it can never offer
  // something they answer with a 404.
  const created = await createEvent('Vergangene LAN');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  accept(eventId, TEST_ADMIN_ID);

  const beforeEnd = await request(app).get('/api/events');
  assert.ok(
    beforeEnd.body.historicalEvents.some((event: { id: string }) => event.id === eventId),
    'accepting an event records the participation immediately',
  );

  assert.equal((await request(app).post(`/api/events/${eventId}/end`)).status, 200);

  const afterEnd = await request(app).get('/api/events');
  assert.equal(
    afterEnd.body.availableEvents.some((event: { id: string }) => event.id === eventId),
    false,
    'an ended event is no longer a workspace anyone can switch into',
  );
  const historical = afterEnd.body.historicalEvents.find((event: { id: string }) => event.id === eventId);
  assert.ok(historical, 'but it stays in the participation history the event filters are built from');
  assert.equal(historical.isEnded, true, 'and it carries the state the filter labels it with');
  assert.ok(
    afterEnd.body.historicalEvents.some((event: { isBase: boolean }) => event.isBase),
    'the permanent base workspace is part of the history like any other accepted event',
  );

  // The contract the filter depends on: what the list offers, the analytics
  // endpoints accept.
  const scoped = await request(app).get(`/api/players/${TEST_ADMIN_ID}/stats?eventId=${eventId}`);
  assert.equal(scoped.status, 200, JSON.stringify(scoped.body));
  assert.equal(scoped.body.eventId, eventId);
});

test('the participation history never offers an event this account only manages', async () => {
  const foreign = await createEvent('Fremdes Event');
  assert.equal(foreign.status, 201, JSON.stringify(foreign.body));
  const foreignId = foreign.body.id as string;
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(foreignId, TEST_ADMIN_ID);
  db.prepare('DELETE FROM event_participation_history WHERE event_id = ? AND player_id = ?').run(
    foreignId,
    TEST_ADMIN_ID,
  );

  const list = await request(app).get('/api/events');
  assert.ok(
    list.body.managedEvents.some((event: { id: string }) => event.id === foreignId),
    'an admin still manages it',
  );
  assert.equal(
    list.body.historicalEvents.some((event: { id: string }) => event.id === foreignId),
    false,
    'managing an event is not taking part in it, so it stays out of personal analytics',
  );
  assert.equal((await request(app).get(`/api/players/${TEST_ADMIN_ID}/stats?eventId=${foreignId}`)).status, 404);
});

test('unknown events stay non-enumerable', async () => {
  assert.equal((await request(app).get('/api/events/does-not-exist')).status, 404);
  assert.equal((await request(app).put('/api/me/active-event').send({ eventId: 'does-not-exist' })).status, 404);
});
