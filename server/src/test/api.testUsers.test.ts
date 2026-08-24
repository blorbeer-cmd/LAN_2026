// Admin test-user seeding (POST/DELETE /api/admin/test-users): created
// players must arrive fully "lived in" — flagged is_test, seated in the
// table plan with auto-derived visible monitors, random skill/Bock ratings
// for every game, finished play sessions, and the first two showing up as
// currently playing. Cleanup must remove all of it again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { BASE_EVENT_ID, db } from '../db';
import { EVENT_FEATURE_KEYS } from '../eventFeatureCatalog';

const app = createTestApp();

interface PlayerBody {
  id: string;
  name: string;
  is_test: number;
  is_admin: number;
}

test('POST /api/admin/test-users validates count', async () => {
  for (const count of [0, 21, 2.5, 'five', undefined]) {
    const res = await request(app).post('/api/admin/test-users').send({ count });
    assert.equal(res.status, 400, `count=${count}`);
  }
});

test('POST /api/admin/test-users seeds players with seats, neighbors, ratings, and sessions', async () => {
  assert.equal((await request(app).post(`/api/events/${BASE_EVENT_ID}/tracking/start`).send({})).status, 200);
  const statsBefore = await request(app).get('/api/stats/playtime');
  const votesBefore = await request(app).get('/api/votes');
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
  assert.ok(testRows.every((p) => p.is_admin === 0));

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
  const eventId = BASE_EVENT_ID;
  const autoRows = db
    .prepare("SELECT player_id, neighbor_id FROM seat_neighbors WHERE group_id = 'default-group' AND event_id = ? AND source = 'auto'")
    .all(eventId) as Array<{ player_id: string; neighbor_id: string }>;
  assert.ok(autoRows.some((r) => ids.includes(r.player_id) && ids.includes(r.neighbor_id)));
  // Plus the deliberately-manual extra pair from the seeder.
  const manualRows = db
    .prepare("SELECT player_id FROM seat_neighbors WHERE group_id = 'default-group' AND event_id = ? AND source = 'manual'")
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

  // Player-carrying rows were already removable in the browser, but grouped
  // values were not. The server now keeps both the per-game playtime and the
  // Bock aggregate unchanged outside Admin mode, while Admin mode receives
  // the complete fixture contribution.
  const regularStats = await request(app).get('/api/stats/playtime');
  assert.deepEqual(regularStats.body.totalsByGame, statsBefore.body.totalsByGame);
  assert.ok(regularStats.body.entries.every((entry: { playerId: string }) => !ids.includes(entry.playerId)));
  const adminStats = await request(app).get('/api/stats/playtime').set('x-admin-mode', '1');
  assert.ok(adminStats.body.entries.some((entry: { playerId: string }) => ids.includes(entry.playerId)));

  const beforeVoteByGame = new Map<string, { preferenceCount: number; totalPlaytimeMs: number }>(
    votesBefore.body.catalogResults.map((row: { gameId: string; preferenceCount: number; totalPlaytimeMs: number }) => [
      row.gameId,
      { preferenceCount: row.preferenceCount, totalPlaytimeMs: row.totalPlaytimeMs },
    ] as const),
  );
  const regularVotes = await request(app).get('/api/votes');
  for (const row of regularVotes.body.catalogResults as Array<{
    gameId: string;
    preferenceCount: number;
    totalPlaytimeMs: number;
  }>) {
    assert.deepEqual(
      { preferenceCount: row.preferenceCount, totalPlaytimeMs: row.totalPlaytimeMs },
      beforeVoteByGame.get(row.gameId),
    );
  }
  const adminVotes = await request(app).get('/api/votes').set('x-admin-mode', '1');
  assert.ok(
    adminVotes.body.catalogResults.some(
      (row: { gameId: string; preferenceCount: number }) =>
        row.preferenceCount === (beforeVoteByGame.get(row.gameId)?.preferenceCount ?? 0) + ids.length,
    ),
  );

  // The same seed maintains two operational test events. Each test identity
  // is accepted to one and pending on the other, so both roster states are
  // available without involving real accounts.
  const testEvents = db
    .prepare(
      `SELECT id, name, event_type_key AS eventType FROM events
       WHERE is_test = 1 AND name IN ('Test-LAN', 'Allgemeines Testevent')
       ORDER BY name`,
    )
    .all() as Array<{ id: string; name: string; eventType: string }>;
  assert.deepEqual(
    testEvents.map((event) => ({ name: event.name, eventType: event.eventType })),
    [
      { name: 'Allgemeines Testevent', eventType: 'general' },
      { name: 'Test-LAN', eventType: 'lan' },
    ],
  );
  for (const event of testEvents) {
    const statuses = db
      .prepare('SELECT status, COUNT(*) AS n FROM event_participants WHERE event_id = ? GROUP BY status')
      .all(event.id) as Array<{ status: string; n: number }>;
    assert.deepEqual(
      Object.fromEntries(statuses.map((row) => [row.status, row.n])),
      { accepted: 2, invited: 2 },
    );
    assert.ok(
      (db.prepare('SELECT COUNT(*) AS n FROM event_features WHERE event_id = ?').get(event.id) as { n: number }).n > 0,
    );
  }

  const regularEvents = await request(app).get('/api/events');
  assert.ok(regularEvents.body.managedEvents.every((event: { isTest: boolean }) => !event.isTest));
  const adminEvents = await request(app).get('/api/events').set('x-admin-mode', '1');
  assert.deepEqual(
    adminEvents.body.managedEvents.filter((event: { isTest: boolean }) => event.isTest).map((event: { name: string }) => event.name).sort(),
    ['Allgemeines Testevent', 'Test-LAN'],
  );
  assert.equal((await request(app).get(`/api/events/${testEvents[0].id}`)).status, 404);
  assert.equal((await request(app).get(`/api/events/${testEvents[0].id}`).set('x-admin-mode', '1')).status, 200);

  const invitedTestPlayerId = (
    db.prepare("SELECT player_id AS id FROM event_participants WHERE event_id = ? AND status = 'invited' LIMIT 1").get(
      testEvents[0].id,
    ) as { id: string }
  ).id;
  const testIdentityEvents = await request(app).get('/api/events').set('x-test-player-id', invitedTestPlayerId);
  assert.ok(testIdentityEvents.body.invitations.every((event: { isTest: boolean }) => !event.isTest));

  const acceptedTestPlayerId = (
    db.prepare("SELECT player_id AS id FROM event_participants WHERE event_id = ? AND status = 'accepted' LIMIT 1").get(
      testEvents[0].id,
    ) as { id: string }
  ).id;
  assert.equal(
    (
      await request(app)
        .get(`/api/live?eventId=${testEvents[0].id}`)
        .set('x-test-player-id', acceptedTestPlayerId)
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .get(`/api/live?eventId=${testEvents[0].id}`)
        .set('x-test-player-id', acceptedTestPlayerId)
        .set('x-admin-mode', '1')
    ).status,
    200,
  );
});

test('POST /api/admin/test-data/hall-of-fame creates dense marked history across years', async () => {
  const seeded = await request(app).post('/api/admin/test-data/hall-of-fame');
  assert.equal(seeded.status, 201);
  assert.deepEqual(seeded.body, { events: 12, matches: 216, tournaments: 36 });

  const events = db
    .prepare(
      `SELECT id, name, is_test, event_type_key AS eventType, preset_version AS presetVersion
       FROM events WHERE is_test = 1 AND name LIKE 'Respawn Test-LAN %' ORDER BY starts_at`,
    )
    .all() as Array<{ id: string; name: string; is_test: number; eventType: string; presetVersion: number }>;
  assert.equal(events.length, 12);
  assert.equal(events[0].name, 'Respawn Test-LAN 2015');
  assert.equal(events.at(-1)?.name, 'Respawn Test-LAN 2026');
  assert.ok(events.every((event) => event.is_test === 1));
  assert.ok(events.every((event) => event.eventType === 'lan' && event.presetVersion === 1));

  const featureSnapshots = db
    .prepare(
      `SELECT ef.event_id AS eventId, COUNT(*) AS featureCount, SUM(ef.enabled) AS enabledCount,
              MIN(ef.changed_by) AS changedBy, MAX(ef.changed_by) AS maxChangedBy
       FROM event_features ef
       JOIN events e ON e.id = ef.event_id
       WHERE e.is_test = 1 AND e.name LIKE 'Respawn Test-LAN %'
       GROUP BY ef.event_id`,
    )
    .all() as Array<{
      eventId: string;
      featureCount: number;
      enabledCount: number;
      changedBy: string | null;
      maxChangedBy: string | null;
    }>;
  assert.equal(featureSnapshots.length, 12);
  assert.ok(
    featureSnapshots.every(
      (snapshot) =>
        snapshot.featureCount === EVENT_FEATURE_KEYS.length &&
        snapshot.enabledCount === EVENT_FEATURE_KEYS.length &&
        snapshot.changedBy === TEST_ADMIN_ID &&
        snapshot.maxChangedBy === TEST_ADMIN_ID,
    ),
  );

  const regularEventList = await request(app).get('/api/events');
  const regularManagedTestEvents = regularEventList.body.managedEvents.filter((event: { name: string }) =>
    event.name.startsWith('Respawn Test-LAN'),
  );
  assert.equal(regularManagedTestEvents.length, 0);

  const eventList = await request(app).get('/api/events').set('x-admin-mode', '1');
  const managedTestEvents = eventList.body.managedEvents.filter((event: { name: string }) =>
    event.name.startsWith('Respawn Test-LAN'),
  );
  assert.equal(managedTestEvents.length, 12);
  assert.ok(
    managedTestEvents.every(
      (event: { eventType: string; presetVersion: number; enabledFeatures: string[] }) =>
        event.eventType === 'lan' &&
        event.presetVersion === 1 &&
        JSON.stringify(event.enabledFeatures) === JSON.stringify(EVENT_FEATURE_KEYS),
    ),
  );

  const regularHall = await request(app).get('/api/hall-of-fame');
  assert.equal(regularHall.status, 200);
  assert.equal(
    regularHall.body.events.filter((event: { eventName: string }) => event.eventName.startsWith('Respawn Test-LAN')).length,
    0,
  );
  const hall = await request(app).get('/api/hall-of-fame').set('x-admin-mode', '1');
  const testEvents = hall.body.events.filter((event: { eventName: string }) => event.eventName.startsWith('Respawn Test-LAN'));
  assert.equal(testEvents.length, 12);
  assert.ok(testEvents.every((event: { overallStandings: unknown[]; tournamentChampions: unknown[] }) =>
    event.overallStandings.length >= 4 && event.tournamentChampions.length === 3));

  const reseeded = await request(app).post('/api/admin/test-data/hall-of-fame');
  assert.equal(reseeded.status, 201);
  assert.deepEqual(reseeded.body, seeded.body);
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM event_features ef JOIN events e ON e.id = ef.event_id
           WHERE e.is_test = 1 AND e.name LIKE 'Respawn Test-LAN %' AND ef.enabled = 1`,
        )
        .get() as { count: number }
    ).count,
    12 * EVENT_FEATURE_KEYS.length,
  );
});

test('DELETE /api/admin/test-users removes every marked player and historical test LAN', async () => {
  const ids = (db.prepare('SELECT id FROM players WHERE is_test = 1').all() as Array<{ id: string }>).map((r) => r.id);
  assert.ok(ids.length > 0, 'previous test should have seeded users');

  // An admin who joined one of the generated test events (e.g. Test-LAN) has
  // it as their active_event_id, which ON DELETE RESTRICT would otherwise
  // turn this cleanup into a 500 that deletes nothing.
  const testLan = db.prepare("SELECT id FROM events WHERE is_test = 1 AND name = 'Test-LAN'").get() as
    | { id: string }
    | undefined;
  assert.ok(testLan, 'previous test should have seeded the Test-LAN fixture event');
  db.prepare('UPDATE player_event_contexts SET active_event_id = ? WHERE player_id = ?').run(testLan!.id, TEST_ADMIN_ID);

  const res = await request(app).delete('/api/admin/test-users');
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, ids.length);
  assert.equal(res.body.deletedPlayers, ids.length);
  assert.equal(res.body.deletedEvents, 14);

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_test = 1').get() as { n: number }).n, 0);
  // The admin's active context fell back instead of leaving a dangling
  // reference to the now-deleted Test-LAN event.
  const adminContext = db
    .prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?')
    .get(TEST_ADMIN_ID) as { active_event_id: string };
  assert.equal(adminContext.active_event_id, BASE_EVENT_ID);
  const layout = await request(app).get('/api/seating/layout');
  const seated = new Set(layout.body.layout.assignments.map((a: { playerId: string }) => a.playerId));
  assert.ok(ids.every((id) => !seated.has(id)), 'no test user should stay seated');
  for (const id of ids) {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE player_id = ?').get(id) as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM seat_neighbors WHERE group_id = ? AND (player_id = ? OR neighbor_id = ?)').get('default-group', id, id) as { n: number }).n, 0);
  }

  // Idempotent: a second cleanup finds nothing.
  const again = await request(app).delete('/api/admin/test-users');
  assert.equal(again.body.deleted, 0);
  assert.equal(again.body.deletedEvents, 0);
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
