// Integration tests for event lifecycle: several events can exist (even
// with overlapping time frames), but at most one tracks at a time; a
// permanent "außerhalb von Events" sentinel is the fallback whenever
// nothing is tracking; matches/sessions get tagged to whichever is current.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

test('GET /api/events/active returns the "außerhalb von Events" sentinel out of the box', async () => {
  const res = await request(app).get('/api/events/active');
  assert.equal(res.status, 200);
  assert.ok(res.body.id);
  assert.equal(res.body.isOutsideEvents, true);
  assert.equal(res.body.trackingEnabled, false);
});

test('GET /api/events lists only the sentinel before any real event exists', async () => {
  const res = await request(app).get('/api/events');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].isOutsideEvents, true);
  assert.equal(res.body[0].isActive, true);
});

test('POST /api/events rejects an empty name', async () => {
  const res = await request(app)
    .post('/api/events')
    .send({ name: '  ', startsAt: Date.now(), endsAt: Date.now() + 1000 });
  assert.equal(res.status, 400);
});

test('POST /api/events requires startsAt and endsAt', async () => {
  const missingStarts = await request(app).post('/api/events').send({ name: 'X', endsAt: Date.now() });
  assert.equal(missingStarts.status, 400);
  const missingEnds = await request(app).post('/api/events').send({ name: 'X', startsAt: Date.now() });
  assert.equal(missingEnds.status, 400);
});

test('POST /api/events rejects an endsAt before startsAt', async () => {
  const startsAt = Date.now() + 60_000;
  const res = await request(app)
    .post('/api/events')
    .send({ name: 'Zeitreise-Event', startsAt, endsAt: startsAt - 1000 });
  assert.equal(res.status, 400);
});

test('POST /api/events rejects a location that is too long', async () => {
  const res = await request(app)
    .post('/api/events')
    .send({ name: 'Zu langer Ort', startsAt: Date.now(), endsAt: Date.now() + 1000, location: 'x'.repeat(81) });
  assert.equal(res.status, 400);
});

let eventAId: string;
let eventBId: string;

test('POST /api/events creates a real event with tracking off, without touching the current tracking target', async () => {
  const before = await request(app).get('/api/events/active');

  const startsAt = Date.now();
  const endsAt = startsAt + 3 * 24 * 60 * 60 * 1000;
  const res = await request(app)
    .post('/api/events')
    .send({ name: 'LAN Winter 2027', startsAt, endsAt, location: 'Bei Tim', description: 'Fokus: AoE2-Turnier' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'LAN Winter 2027');
  assert.equal(res.body.starts_at, startsAt);
  assert.equal(res.body.ends_at, endsAt);
  assert.equal(res.body.location, 'Bei Tim');
  assert.equal(res.body.description, 'Fokus: AoE2-Turnier');
  assert.equal(res.body.trackingEnabled, false);
  assert.equal(res.body.isEnded, false);
  eventAId = res.body.id;

  // Whatever was tracking before (the sentinel, at this point) is untouched.
  const after = await request(app).get('/api/events/active');
  assert.equal(after.body.id, before.body.id);
});

test('multiple real events can coexist with overlapping time frames', async () => {
  const startsAt = Date.now();
  const res = await request(app)
    .post('/api/events')
    .send({ name: 'Parallel-Event', startsAt, endsAt: startsAt + 1000 });
  assert.equal(res.status, 201);
  eventBId = res.body.id;

  const list = await request(app).get('/api/events');
  const ids = list.body.map((e: { id: string }) => e.id);
  assert.ok(ids.includes(eventAId));
  assert.ok(ids.includes(eventBId));
});

test('POST /api/events/:id/tracking/start turns tracking on and clears stale live status', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Tracking Switch Tester' });
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', player.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  // Not yet a participant of any tracking event and nothing is tracking, so
  // this lands in "außerhalb von Events" and shows up as playing.
  const before = await request(app).get('/api/live');
  const entryBefore = before.body.find((r: { player_id: string }) => r.player_id === player.body.id);
  assert.equal(entryBefore.state, 'playing');

  const res = await request(app).post(`/api/events/${eventAId}/tracking/start`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.trackingEnabled, true);

  const active = await request(app).get('/api/events/active');
  assert.equal(active.body.id, eventAId);

  const after = await request(app).get('/api/live');
  const entryAfter = after.body.find((r: { player_id: string }) => r.player_id === player.body.id);
  assert.equal(entryAfter.state, 'offline');
  assert.deepEqual(entryAfter.games, []);
});

test('POST /api/events/:id/tracking/start 409s with the conflicting event while another already tracks', async () => {
  const res = await request(app).post(`/api/events/${eventBId}/tracking/start`).send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.conflictEventId, eventAId);
  assert.equal(res.body.conflictEventName, 'LAN Winter 2027');
});

test('POST /api/events/:id/tracking/start 404s for an unknown id', async () => {
  const res = await request(app).post('/api/events/does-not-exist/tracking/start').send({});
  assert.equal(res.status, 404);
});

test('the "außerhalb von Events" sentinel itself can never be tracked', async () => {
  // eventAId is currently tracking, so fetch the sentinel id explicitly.
  const list = await request(app).get('/api/events');
  const sentinel = list.body.find((e: { isOutsideEvents: boolean }) => e.isOutsideEvents);
  const res = await request(app).post(`/api/events/${sentinel.id}/tracking/start`).send({});
  assert.equal(res.status, 400);
});

test('participants roster gates who actually gets tracked while an event is tracking', async () => {
  const rostered = await request(app).post('/api/players').send({ name: 'Rostered Player' });
  const notRostered = await request(app).post('/api/players').send({ name: 'Not Rostered Player' });

  const putRes = await request(app)
    .put(`/api/events/${eventAId}/participants`)
    .send({ playerIds: [rostered.body.id] });
  assert.equal(putRes.status, 200);
  assert.deepEqual(putRes.body.participantIds, [rostered.body.id]);

  const rosteredReport = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', rostered.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  assert.equal(rosteredReport.body.tracked, true);

  const notRosteredReport = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', notRostered.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  assert.equal(notRosteredReport.body.tracked, false);

  const live = await request(app).get('/api/live');
  const rosteredEntry = live.body.find((r: { player_id: string }) => r.player_id === rostered.body.id);
  assert.equal(rosteredEntry.state, 'playing');
  const notRosteredEntry = live.body.find((r: { player_id: string }) => r.player_id === notRostered.body.id);
  assert.equal(notRosteredEntry.state, 'offline');
});

test('PUT /api/events/:id/participants rejects an unknown player', async () => {
  const res = await request(app).put(`/api/events/${eventAId}/participants`).send({ playerIds: ['ghost'] });
  assert.equal(res.status, 404);
});

test('matches recorded while an event tracks get tagged to it', async () => {
  const p1 = await request(app).post('/api/players').send({ name: 'Tag Tester A' });
  const p2 = await request(app).post('/api/players').send({ name: 'Tag Tester B' });
  const games = await request(app).get('/api/games');
  const cs2 = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2');

  const match = await request(app)
    .post('/api/matches')
    .send({ gameId: cs2.id, teams: [{ playerIds: [p1.body.id] }, { playerIds: [p2.body.id] }], winnerTeamIndex: 0 });
  assert.equal(match.status, 201);
  assert.equal(match.body.eventId, eventAId);
});

test('POST /api/events/:id/tracking/stop pauses tracking without ending the event', async () => {
  const res = await request(app).post(`/api/events/${eventAId}/tracking/stop`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.trackingEnabled, false);
  assert.equal(res.body.isEnded, false);

  const active = await request(app).get('/api/events/active');
  assert.equal(active.body.isOutsideEvents, true);
});

test('tracking can be resumed after stopping', async () => {
  const res = await request(app).post(`/api/events/${eventAId}/tracking/start`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.trackingEnabled, true);
});

test('POST /api/events/:id/end closes the event and stops tracking', async () => {
  const res = await request(app).post(`/api/events/${eventAId}/end`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.isEnded, true);
  assert.equal(res.body.trackingEnabled, false);

  const active = await request(app).get('/api/events/active');
  assert.equal(active.body.isOutsideEvents, true);
});

test('an ended event cannot be tracked again', async () => {
  const res = await request(app).post(`/api/events/${eventAId}/tracking/start`).send({});
  assert.equal(res.status, 400);
});

test('PATCH /api/events/:id updates metadata without touching tracking state', async () => {
  const res = await request(app).patch(`/api/events/${eventBId}`).send({ name: 'Umbenannt' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Umbenannt');
  assert.equal(res.body.trackingEnabled, false);
});

test('PATCH /api/events/:id 404s for an unknown id', async () => {
  const res = await request(app).patch('/api/events/does-not-exist').send({ name: 'X' });
  assert.equal(res.status, 404);
});

test('PATCH /api/events/:id 404s for the "außerhalb von Events" sentinel', async () => {
  const list = await request(app).get('/api/events');
  const sentinel = list.body.find((e: { isOutsideEvents: boolean }) => e.isOutsideEvents);
  const res = await request(app).patch(`/api/events/${sentinel.id}`).send({ name: 'X' });
  assert.equal(res.status, 404);
});

test('PATCH /api/events/:id can clear an optional field by sending an empty string', async () => {
  await request(app).patch(`/api/events/${eventBId}`).send({ location: 'Irgendwo' });
  const cleared = await request(app).patch(`/api/events/${eventBId}`).send({ location: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.location, null);
});

test("PATCH /api/events/:id rejects endsAt before the event's existing startsAt", async () => {
  const event = await request(app).get('/api/events').then((r) => r.body.find((e: { id: string }) => e.id === eventBId));
  const res = await request(app).patch(`/api/events/${eventBId}`).send({ endsAt: event.starts_at - 1 });
  assert.equal(res.status, 400);
});
