// Integration tests for event lifecycle: exactly one active event, starting
// a new one closes the old one and resets live/vote state, matches/sessions
// get tagged with whichever event was active when they were created.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

test('GET /api/events/active returns a default event out of the box', async () => {
  const res = await request(app).get('/api/events/active');
  assert.equal(res.status, 200);
  assert.ok(res.body.id);
  assert.equal(res.body.ends_at, null);
});

test('GET /api/events lists the default event as active', async () => {
  const res = await request(app).get('/api/events');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].isActive, true);
});

test('POST /api/events rejects an empty name', async () => {
  const res = await request(app).post('/api/events').send({ name: '  ' });
  assert.equal(res.status, 400);
});

test('POST /api/events starts a new event and closes the previous one', async () => {
  const before = await request(app).get('/api/events/active');
  const previousId = before.body.id;

  const res = await request(app).post('/api/events').send({ name: 'LAN Sommer 2026' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'LAN Sommer 2026');
  assert.equal(res.body.ends_at, null);
  assert.notEqual(res.body.id, previousId);

  const list = await request(app).get('/api/events');
  const previous = list.body.find((e: { id: string }) => e.id === previousId);
  assert.ok(previous.ends_at, 'previous event should now have an end time');
  const active = list.body.find((e: { isActive: boolean }) => e.isActive);
  assert.equal(active.id, res.body.id);
});

test('starting a new event clears the live-status board', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Event Switch Tester' });
  const games = await request(app).get('/api/games');
  const cs2 = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2');
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', player.body.api_key)
    .send({ processNames: ['cs2.exe'] });

  const before = await request(app).get('/api/live');
  const entryBefore = before.body.find((r: { player_id: string }) => r.player_id === player.body.id);
  assert.equal(entryBefore.state, 'playing');

  await request(app).post('/api/events').send({ name: 'Nächstes Event' });

  const after = await request(app).get('/api/live');
  const entryAfter = after.body.find((r: { player_id: string }) => r.player_id === player.body.id);
  assert.equal(entryAfter.state, 'offline');
  assert.deepEqual(entryAfter.games, []);
});

test('matches and play_sessions are tagged with the event active at creation time', async () => {
  const activeEvent = await request(app).get('/api/events/active');

  const player = await request(app).post('/api/players').send({ name: 'Event Tag Tester' });
  const player2 = await request(app).post('/api/players').send({ name: 'Event Tag Tester 2' });
  const games = await request(app).get('/api/games');
  const cs2 = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2');

  const validMatch = await request(app)
    .post('/api/matches')
    .send({
      gameId: cs2.id,
      teams: [{ playerIds: [player.body.id] }, { playerIds: [player2.body.id] }],
      winnerTeamIndex: 0,
    });
  assert.equal(validMatch.status, 201);
  assert.equal(validMatch.body.eventId, activeEvent.body.id);

  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', player.body.api_key)
    .send({ processNames: ['cs2.exe'] });

  const matchesForEvent = await request(app).get(`/api/matches?eventId=${activeEvent.body.id}`);
  assert.ok(matchesForEvent.body.some((m: { id: string }) => m.id === validMatch.body.id));
});

test('PATCH /api/events/:id renames without changing active state', async () => {
  const active = await request(app).get('/api/events/active');
  const res = await request(app).patch(`/api/events/${active.body.id}`).send({ name: 'Umbenannt' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Umbenannt');
  assert.equal(res.body.ends_at, null);
});

test('PATCH /api/events/:id 404s for an unknown id', async () => {
  const res = await request(app).patch('/api/events/does-not-exist').send({ name: 'X' });
  assert.equal(res.status, 404);
});
