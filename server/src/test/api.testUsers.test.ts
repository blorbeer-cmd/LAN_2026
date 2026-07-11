// Admin test-user seeding (POST/DELETE /api/admin/test-users): created
// players must arrive fully "lived in" — flagged is_test, seated in the
// table plan with auto-derived visible monitors, random skill/Bock ratings
// for every game, finished play sessions, and the first two showing up as
// currently playing. Cleanup must remove all of it again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';
import { getTrackingEventId } from '../events';

const app = createApp();

interface PlayerBody {
  id: string;
  name: string;
  is_test: number;
}

test('POST /api/admin/test-users validates count', async () => {
  for (const count of [0, 21, 2.5, 'five', undefined]) {
    const res = await request(app).post('/api/admin/test-users').send({ count });
    assert.equal(res.status, 400, `count=${count}`);
  }
});

test('POST /api/admin/test-users seeds players with seats, neighbors, ratings, and sessions', async () => {
  const res = await request(app).post('/api/admin/test-users').send({ count: 4 });
  assert.equal(res.status, 201);
  assert.equal(res.body.created.length, 4);
  assert.equal(res.body.totalTestUsers, 4);
  const ids: string[] = res.body.created.map((c: { id: string }) => c.id);

  // Flagged and visible in the roster.
  const roster = await request(app).get('/api/players');
  const testRows = (roster.body as PlayerBody[]).filter((p) => ids.includes(p.id));
  assert.equal(testRows.length, 4);
  assert.ok(testRows.every((p) => p.is_test === 1));

  // A skill and a Bock rating (1-10) for every game, per player.
  const games = (await request(app).get('/api/games')).body as Array<{ id: string }>;
  assert.ok(games.length > 0, 'expected seeded default games');
  for (const id of ids) {
    const skills = db.prepare('SELECT rating FROM skills WHERE player_id = ?').all(id) as Array<{ rating: number }>;
    const prefs = db.prepare('SELECT rating FROM preferences WHERE player_id = ?').all(id) as Array<{ rating: number }>;
    assert.equal(skills.length, games.length);
    assert.equal(prefs.length, games.length);
    assert.ok([...skills, ...prefs].every((r) => r.rating >= 1 && r.rating <= 10));
  }

  // Everyone got a seat in the tracking event's layout...
  const layout = await request(app).get('/api/seating/layout');
  const seated = new Set(layout.body.layout.assignments.map((a: { playerId: string }) => a.playerId));
  assert.ok(ids.every((id) => seated.has(id)), 'all test users should be seated');

  // ...and same-edge adjacency produced auto seat neighbors ("Sichtbare
  // Monitore"). With 4 players on empty default sides (2 seats each), at
  // least one adjacent pair must exist.
  const eventId = getTrackingEventId();
  const autoRows = db
    .prepare("SELECT player_id, neighbor_id FROM seat_neighbors WHERE event_id = ? AND source = 'auto'")
    .all(eventId) as Array<{ player_id: string; neighbor_id: string }>;
  assert.ok(autoRows.some((r) => ids.includes(r.player_id) && ids.includes(r.neighbor_id)));
  // Plus the deliberately-manual extra pair from the seeder.
  const manualRows = db
    .prepare("SELECT player_id FROM seat_neighbors WHERE event_id = ? AND source = 'manual'")
    .all(eventId) as Array<{ player_id: string }>;
  assert.ok(manualRows.some((r) => ids.includes(r.player_id)));

  // Finished play sessions in the tracking event for everyone.
  for (const id of ids) {
    const sessions = db
      .prepare('SELECT event_id, started_at, ended_at, active_ms FROM play_sessions WHERE player_id = ?')
      .all(id) as Array<{ event_id: string; started_at: number; ended_at: number | null; active_ms: number }>;
    assert.ok(sessions.length >= 1, `player ${id} should have sessions`);
    assert.ok(sessions.every((s) => s.event_id === eventId));
    const finished = sessions.filter((s) => s.ended_at !== null);
    assert.ok(finished.length >= 1);
    assert.ok(finished.every((s) => s.ended_at! > s.started_at && s.active_ms <= s.ended_at! - s.started_at));
  }

  // The first two of the batch are live right now.
  const board = await request(app).get('/api/live');
  const liveStates = new Map(board.body.map((e: { player_id: string; state: string }) => [e.player_id, e.state]));
  assert.equal(liveStates.get(ids[0]), 'playing');
  assert.equal(liveStates.get(ids[1]), 'playing');
});

test('DELETE /api/admin/test-users removes players, seats, neighbors, and sessions', async () => {
  const ids = (db.prepare('SELECT id FROM players WHERE is_test = 1').all() as Array<{ id: string }>).map((r) => r.id);
  assert.ok(ids.length > 0, 'previous test should have seeded users');

  const res = await request(app).delete('/api/admin/test-users');
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, ids.length);

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_test = 1').get() as { n: number }).n, 0);
  const layout = await request(app).get('/api/seating/layout');
  const seated = new Set(layout.body.layout.assignments.map((a: { playerId: string }) => a.playerId));
  assert.ok(ids.every((id) => !seated.has(id)), 'no test user should stay seated');
  const eventId = getTrackingEventId();
  for (const id of ids) {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE player_id = ?').get(id) as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM seat_neighbors WHERE event_id = ? AND (player_id = ? OR neighbor_id = ?)').get(eventId, id, id) as { n: number }).n, 0);
  }

  // Idempotent: a second cleanup finds nothing.
  const again = await request(app).delete('/api/admin/test-users');
  assert.equal(again.body.deleted, 0);
});

test('seeding respects existing seat assignments and grows the table when full', async () => {
  // Occupy a seat with a real player first.
  const real = await request(app).post('/api/players').send({ name: 'Seated Real' });
  const before = await request(app).get('/api/seating/layout');
  const put = await request(app).put('/api/seating/layout').send({
    eventId: before.body.eventId,
    topSeats: 1, rightSeats: 1, bottomSeats: 1, leftSeats: 1,
    assignments: [{ side: 'top', seat: 0, playerId: real.body.id }],
  });
  assert.equal(put.status, 200);

  // 8 test users into a 4-seat table with 1 seat taken → sides must grow,
  // nobody may displace the real player or double-book a seat.
  const res = await request(app).post('/api/admin/test-users').send({ count: 8 });
  assert.equal(res.status, 201);
  const layout = await request(app).get('/api/seating/layout');
  const assignments = layout.body.layout.assignments as Array<{ side: string; seat: number; playerId: string }>;
  const seatKeys = assignments.map((a) => `${a.side}:${a.seat}`);
  assert.equal(new Set(seatKeys).size, seatKeys.length, 'no double-booked seats');
  assert.ok(assignments.some((a) => a.playerId === real.body.id), 'real player keeps their seat');
  assert.equal(assignments.length, 9); // 1 real + 8 test users all seated

  await request(app).delete('/api/admin/test-users');
});

test('a non-admin seating save cannot silently unseat test users; an admin-mode save can', async () => {
  const seeded = await request(app).post('/api/admin/test-users').send({ count: 2 });
  const ids: string[] = seeded.body.created.map((c: { id: string }) => c.id);
  const before = await request(app).get('/api/seating/layout');
  const l = before.body.layout;

  // Non-admin clients have test users filtered out of their state, so their
  // PUT body omits those assignments — the server must carry them over.
  const nonAdmin = await request(app).put('/api/seating/layout').send({
    eventId: before.body.eventId,
    topSeats: l.topSeats, rightSeats: l.rightSeats, bottomSeats: l.bottomSeats, leftSeats: l.leftSeats,
    assignments: l.assignments.filter((a: { playerId: string }) => !ids.includes(a.playerId)),
  });
  const keptSeated = new Set(nonAdmin.body.layout.assignments.map((a: { playerId: string }) => a.playerId));
  assert.ok(ids.every((id) => keptSeated.has(id)), 'test users must keep their seats');

  // The same body from a device in admin mode is a deliberate removal.
  const admin = await request(app).put('/api/seating/layout').set('x-admin-mode', '1').send({
    eventId: before.body.eventId,
    topSeats: l.topSeats, rightSeats: l.rightSeats, bottomSeats: l.bottomSeats, leftSeats: l.leftSeats,
    assignments: l.assignments.filter((a: { playerId: string }) => !ids.includes(a.playerId)),
  });
  const afterAdmin = new Set(admin.body.layout.assignments.map((a: { playerId: string }) => a.playerId));
  assert.ok(ids.every((id) => !afterAdmin.has(id)), 'admin-mode save removes them for real');

  await request(app).delete('/api/admin/test-users');
});
