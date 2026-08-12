// Integration tests for player CRUD, run against the real Express app and an
// in-memory DB. Tests run sequentially and build on each other (create ->
// read -> update -> delete), which mirrors how the flow is actually used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, sessionCookie, TEST_ADMIN_ID } from './testApp';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';

const app = createTestApp();
let createdId: string;

function patchPlayer(id: string, body: Record<string, unknown>, actorId: string = id) {
  return request(app).patch(`/api/players/${id}`).set('x-test-player-id', actorId).send(body);
}

test('POST /api/players rejects an empty name', async () => {
  const res = await request(app).post('/api/players').send({ name: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Name/);
});

test('POST /api/players rejects an invalid color', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Alex', color: 'blau' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Farbe/);
});

test('POST /api/players creates a player with a generated API key', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Alex' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Alex');
  assert.equal(res.body.color, '#4f9dff');
  assert.ok(res.body.api_key && res.body.api_key.length > 10);
  createdId = res.body.id;
});

test('GET /api/players lists players WITHOUT exposing api_key', async () => {
  const res = await request(app).get('/api/players');
  assert.equal(res.status, 200);
  const found = res.body.find((p: { id: string }) => p.id === createdId);
  assert.ok(found, 'created player should be in the list');
  assert.equal('api_key' in found, false);
});

test('GET /api/players/:id returns the single player WITH api_key', async () => {
  const res = await request(app).get(`/api/players/${createdId}`).set('x-test-player-id', createdId);
  assert.equal(res.status, 200);
  assert.ok(res.body.api_key);
});

test('GET /api/players/:id hides api_key from another identity', async () => {
  const viewer = await request(app).post('/api/players').send({ name: 'Profile Viewer' });
  const res = await request(app).get(`/api/players/${createdId}`).set('x-test-player-id', viewer.body.id);
  assert.equal(res.status, 200);
  assert.equal('api_key' in res.body, false);
  await request(app).delete(`/api/players/${viewer.body.id}`);
});

test('GET /api/players/:id includes the most recent agent report time', async () => {
  const lastSeen = Date.now() - 90_000;
  db.prepare('INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, NULL)').run(createdId, lastSeen);
  const res = await request(app).get(`/api/players/${createdId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.agent_last_seen, lastSeen);
});

test('GET /api/players/:id 404s for an unknown id', async () => {
  const res = await request(app)
    .get('/api/players/does-not-exist')
    .set('Cookie', sessionCookie(TEST_ADMIN_ID));
  assert.equal(res.status, 404);
});

test('PATCH /api/players/:id renames and recolors', async () => {
  const res = await patchPlayer(createdId, { name: 'Alexandra', color: '#ff0000' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Alexandra');
  assert.equal(res.body.color, '#ff0000');
});

test('PATCH /api/players/:id rejects profile changes from another identity', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Fremder Spieler' });
  const foreignIdentity = await patchPlayer(createdId, { name: 'Übernommen' }, other.body.id);
  assert.equal(foreignIdentity.status, 403);
  assert.match(foreignIdentity.body.error, /eigenes Profil/);

  const unchanged = await request(app).get(`/api/players/${createdId}`);
  assert.equal(unchanged.body.name, 'Alexandra');
  await request(app).delete(`/api/players/${other.body.id}`);
});

test('PATCH /api/players/:id rejects an invalid color', async () => {
  const res = await patchPlayer(createdId, { color: 'nope' });
  assert.equal(res.status, 400);
});

test('POST /api/players rejects a name that is already taken (case-insensitive)', async () => {
  const dup = await request(app).post('/api/players').send({ name: 'alexandra' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /vergeben/);
});

test('PATCH /api/players/:id rejects renaming to a name already taken by someone else', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Bine' });
  const res = await patchPlayer(other.body.id, { name: 'ALEXANDRA' });
  assert.equal(res.status, 409);
  await request(app).delete(`/api/players/${other.body.id}`);
});

test('PATCH /api/players/:id keeping your own name (same casing or not) is not a conflict', async () => {
  const res = await patchPlayer(createdId, { name: 'Alexandra' });
  assert.equal(res.status, 200);
});

test('PATCH /api/players/:id rejects an invalid avatar value', async () => {
  const res = await patchPlayer(createdId, { avatar: 'not-a-data-url' });
  assert.equal(res.status, 400);
});

test('POST /api/players accepts an optional realName', async () => {
  const res = await request(app).post('/api/players').send({ name: 'RealName Rex', realName: 'Max Mustermann' });
  assert.equal(res.status, 201);
  assert.equal(res.body.real_name, 'Max Mustermann');
  await request(app).delete(`/api/players/${res.body.id}`);
});

test('POST /api/players rejects a too-long realName', async () => {
  const res = await request(app)
    .post('/api/players')
    .send({ name: 'RealName Overflow', realName: 'x'.repeat(61) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Richtiger Name/);
});

test('PATCH /api/players/:id sets, then clears, realName (null and empty string both clear it)', async () => {
  const set = await patchPlayer(createdId, { realName: 'Alexandra Musterfrau' });
  assert.equal(set.status, 200);
  assert.equal(set.body.real_name, 'Alexandra Musterfrau');

  const stillSet = await request(app).get(`/api/players/${createdId}`);
  assert.equal(stillSet.body.real_name, 'Alexandra Musterfrau');

  // Omitting the field entirely leaves it untouched.
  const untouched = await patchPlayer(createdId, { color: '#123456' });
  assert.equal(untouched.body.real_name, 'Alexandra Musterfrau');

  const clearedByNull = await patchPlayer(createdId, { realName: null });
  assert.equal(clearedByNull.status, 200);
  assert.equal(clearedByNull.body.real_name, null);

  await patchPlayer(createdId, { realName: 'Set again' });
  const clearedByEmptyString = await patchPlayer(createdId, { realName: '  ' });
  assert.equal(clearedByEmptyString.status, 200);
  assert.equal(clearedByEmptyString.body.real_name, null);
});

test('PATCH /api/players/:id rejects a too-long realName', async () => {
  const res = await patchPlayer(createdId, { realName: 'x'.repeat(61) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Richtiger Name/);
});

test('PATCH /api/players/:id accepts and stores a valid avatar data URL', async () => {
  const avatar = 'data:image/png;base64,aGVsbG8=';
  const res = await patchPlayer(createdId, { avatar });
  assert.equal(res.status, 200);
  assert.equal(res.body.avatar, avatar);

  const fetched = await request(app).get(`/api/players/${createdId}`);
  assert.equal(fetched.body.avatar, avatar);
});

test('GET /api/players/:id/stats binds the URL identity to the session', async () => {
  const res = await request(app)
    .get('/api/players/does-not-exist/stats')
    .set('x-test-player-id', createdId);
  assert.equal(res.status, 200);
  assert.equal(res.body.playerId, createdId);
});

test('GET /api/players/:id/stats returns an empty-but-shaped summary before any sessions', async () => {
  const res = await request(app).get(`/api/players/${createdId}/stats`);
  assert.equal(res.status, 200);
  assert.equal(res.body.playerId, createdId);
  assert.equal(res.body.totalMs, 0);
  assert.deepEqual(res.body.games, []);
  assert.deepEqual(res.body.events, []);
  assert.deepEqual(res.body.awards, []);
  assert.equal(res.body.simultaneous.maxSimultaneous, 0);
});

test('GET /api/players/:id/neighbors starts out empty', async () => {
  const res = await request(app).get(`/api/players/${createdId}/neighbors`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.neighborIds, []);
});

test('PUT /api/players/:id/neighbors rejects a non-array neighborIds', async () => {
  const res = await request(app).put(`/api/players/${createdId}/neighbors`).send({ neighborIds: 'nope' });
  assert.equal(res.status, 400);
});

test('PUT /api/players/:id/neighbors sets and replaces the declared neighbors', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Neighbor One' });
  const third = await request(app).post('/api/players').send({ name: 'Neighbor Two' });

  const first = await request(app)
    .put(`/api/players/${createdId}/neighbors`)
    .send({ neighborIds: [other.body.id] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.neighborIds, [other.body.id]);

  // A second PUT fully replaces the set rather than appending to it.
  const second = await request(app)
    .put(`/api/players/${createdId}/neighbors`)
    .send({ neighborIds: [third.body.id] });
  assert.deepEqual(second.body.neighborIds, [third.body.id]);

  const check = await request(app).get(`/api/players/${createdId}/neighbors`);
  assert.deepEqual(check.body.neighborIds, [third.body.id]);
});

test('PUT /api/players/:id/neighbors rejects unknown ids', async () => {
  const res = await request(app)
    .put(`/api/players/${createdId}/neighbors`)
    .send({ neighborIds: [createdId, 'ghost-id'] });
  assert.equal(res.status, 404);
});

test('profile reads stay in the base event and personal analytics exclude unvisited private events', async () => {
  const event = await request(app)
    .post('/api/events')
    .send({ name: 'Private Profile Event', startsAt: Date.now(), endsAt: Date.now() + 60_000, visibilityScope: 'participants' });
  assert.equal(event.status, 201, JSON.stringify(event.body));
  const game = db.prepare('SELECT id FROM games WHERE group_id = ? OR arcade_key IS NOT NULL LIMIT 1').get(DEFAULT_GROUP_ID) as {
    id: string;
  };
  const now = Date.now();
  db.prepare(
    `INSERT INTO play_sessions (id, player_id, game_id, event_id, group_id, started_at, ended_at, active_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('profile-group-room-session', createdId, game.id, BASE_EVENT_ID, DEFAULT_GROUP_ID, now - 1_000, now, 500);
  db.prepare(
    `INSERT INTO play_sessions (id, player_id, game_id, event_id, group_id, started_at, ended_at, active_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('profile-private-session', createdId, game.id, event.body.id, DEFAULT_GROUP_ID, now - 9_000, now, 4_500);
  try {
    // createdId never joined the private event, so their operational profile
    // remains in the persisted base workspace regardless of tracking flags.
    const neighbors = await request(app).get(`/api/players/${createdId}/neighbors`);
    assert.equal(neighbors.status, 200);
    assert.equal(neighbors.body.eventId, BASE_EVENT_ID);

    const stats = await request(app).get(`/api/players/${createdId}/stats`);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.playerId, createdId);
    assert.equal(stats.body.eventId, null);
    assert.deepEqual(stats.body.eventIds, [BASE_EVENT_ID]);
    assert.equal(stats.body.sessionCount, 1, 'the inaccessible private event session must not leak into the fallback');
    assert.equal(stats.body.totalMs, 1_000);
    assert.equal(stats.body.events.some((entry: { eventId: string }) => entry.eventId === event.body.id), false);

    const explicit = await request(app).get(`/api/players/${createdId}/neighbors?eventId=${event.body.id}`);
    assert.equal(explicit.status, 404, 'an explicitly requested inaccessible event id still 404s');
    const explicitStats = await request(app).get(`/api/players/${createdId}/stats?eventId=${event.body.id}`);
    assert.equal(explicitStats.status, 404, 'explicit stats for an inaccessible event still 404');
  } finally {
    db.prepare("DELETE FROM play_sessions WHERE id IN ('profile-group-room-session', 'profile-private-session')").run();
  }
});

test('PUT /api/players/:id/neighbors binds the URL identity to the session', async () => {
  const res = await request(app)
    .put('/api/players/ghost/neighbors')
    .set('Cookie', sessionCookie(TEST_ADMIN_ID))
    .send({ neighborIds: [] });
  assert.equal(res.status, 200);
});

test('real players can be hard-deleted and their tracking data is removed', async () => {
  const sender = await request(app).post('/api/players').send({ name: 'Delete Sender' });
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)")
    .run(DEFAULT_GROUP_ID, createdId, now);
  db.prepare("INSERT OR IGNORE INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)")
    .run(DEFAULT_GROUP_ID, sender.body.id, now);
  db.prepare('INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
    .run('delete-test-push', DEFAULT_GROUP_ID, 'Test', 'Test', 'all', JSON.stringify([createdId, sender.body.id]), now);
  db.prepare('INSERT INTO broadcasts (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, recipient_ids, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)')
    .run('delete-test-broadcast', DEFAULT_GROUP_ID, sender.body.id, sender.body.name, 'Test', now + 60_000, JSON.stringify([createdId, sender.body.id]), now);
  const res = await request(app).delete(`/api/players/${createdId}`);
  assert.equal(res.status, 204);

  const after = await request(app)
    .get(`/api/players/${createdId}`)
    .set('Cookie', sessionCookie(TEST_ADMIN_ID));
  assert.equal(after.status, 404);
  assert.equal(db.prepare('SELECT 1 FROM players WHERE id = ?').get(createdId), undefined);
  assert.equal(db.prepare('SELECT 1 FROM live_status WHERE player_id = ?').get(createdId), undefined);
  assert.deepEqual(JSON.parse((db.prepare('SELECT player_ids FROM push_log WHERE id = ?').get('delete-test-push') as { player_ids: string }).player_ids), [sender.body.id]);
  assert.deepEqual(JSON.parse((db.prepare('SELECT recipient_ids FROM broadcasts WHERE id = ?').get('delete-test-broadcast') as { recipient_ids: string }).recipient_ids), [sender.body.id]);
  const roster = await request(app).get('/api/players');
  assert.equal(roster.body.some((player: { id: string }) => player.id === createdId), false);
});

test('deactivation returns not found after a player was deleted', async () => {
  const res = await request(app).post(`/api/players/${createdId}/deactivate`);
  assert.equal(res.status, 404);
});
