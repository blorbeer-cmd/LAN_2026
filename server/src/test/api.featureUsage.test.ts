// Integration tests for the Bestandsdaten-Auswertung (Baustein A):
// GET /api/admin/feature-usage aggregates existing fachliche tables. Rows are
// seeded directly via SQL (each source table's own write path is already
// covered by its feature's own tests) so this stays focused on the
// aggregation query itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { nanoid } from 'nanoid';
import { createTestApp } from './testApp';
import { db, BASE_EVENT_ID, DEFAULT_GROUP_ID } from '../db';

const app = createTestApp();

interface UsageEntry {
  key: string;
  players: number;
  total: number;
  detail?: string;
  eventScoped: boolean;
}

function findEntry(body: { entries: UsageEntry[] }, key: string): UsageEntry {
  const entry = body.entries.find((e) => e.key === key);
  assert.ok(entry, `missing entry for key ${key}`);
  return entry!;
}

test('GET /api/admin/feature-usage rejects non-admin callers', async () => {
  const member = await request(app).post('/api/players').send({ name: 'Feature Usage Member' });
  const res = await request(app)
    .get('/api/admin/feature-usage')
    .set('x-test-player-id', member.body.id);
  assert.equal(res.status, 403);
});

test('GET /api/admin/feature-usage validates eventId', async () => {
  const res = await request(app).get('/api/admin/feature-usage?eventId=');
  assert.equal(res.status, 400);
});

test('GET /api/admin/feature-usage aggregates real rows across fachliche tables', async () => {
  const playerA = await request(app).post('/api/players').send({ name: 'Feature Usage A' });
  const playerB = await request(app).post('/api/players').send({ name: 'Feature Usage B' });
  const idA: string = playerA.body.id;
  const idB: string = playerB.body.id;

  const games = (await request(app).get('/api/games')).body as Array<{ id: string }>;
  const gameId = games[0].id;
  const now = Date.now();
  const eventId = BASE_EVENT_ID;
  const groupId = DEFAULT_GROUP_ID;

  // A vote row is only valid once a matching vote_rounds row exists for the
  // same (group_id, round, event_id) — enforced by trg_votes_round_scope_insert.
  db.prepare(
    `INSERT INTO vote_rounds (group_id, round, event_id, started_at, mode) VALUES (?, ?, ?, ?, 'single')`,
  ).run(groupId, 999_001, eventId, now);
  db.prepare(
    `INSERT INTO votes (id, group_id, player_id, player_name_snapshot, game_id, event_id, round, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(nanoid(), groupId, idA, 'Feature Usage A', gameId, eventId, 999_001, now);
  db.prepare(
    `INSERT INTO votes (id, group_id, player_id, player_name_snapshot, game_id, event_id, round, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(nanoid(), groupId, idB, 'Feature Usage B', gameId, eventId, 999_001, now);

  db.prepare('INSERT INTO matches (id, game_id, event_id, played_at, result, group_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    nanoid(),
    gameId,
    eventId,
    now,
    JSON.stringify({ teams: [{ playerIds: [idA] }, { playerIds: [idB] }], winnerTeamIndex: 0 }),
    groupId,
  );

  const tournamentId = nanoid();
  db.prepare(
    `INSERT INTO tournaments (id, event_id, game_id, name, format, two_legged, track_score, group_count, advancers_per_group, status, created_at, lobby_name, lobby_password, group_id)
     VALUES (?, ?, ?, ?, 'single_elimination', 0, 0, NULL, NULL, 'active', ?, NULL, NULL, ?)`,
  ).run(tournamentId, eventId, gameId, 'Feature Usage Cup', now, groupId);
  db.prepare('INSERT INTO tournament_teams (id, tournament_id, name, player_ids, group_index) VALUES (?, ?, ?, ?, NULL)').run(
    nanoid(),
    tournamentId,
    'Team A',
    JSON.stringify([idA, idB]),
  );

  db.prepare(
    `INSERT INTO checklist_tasks (id, group_id, event_id, type, title, created_by, assignee_id, status, created_at, done_at)
     VALUES (?, ?, ?, 'todo', 'Feature Usage To-Do', ?, ?, 'done', ?, ?)`,
  ).run(nanoid(), groupId, eventId, idA, idA, now, now);

  const orderId = nanoid();
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(orderId, eventId, 'Feature Usage Pizza', idA, now);
  db.prepare(
    `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
  ).run(nanoid(), orderId, idA, 'Margherita', now);

  db.prepare(`INSERT INTO arrivals (event_id, player_id, arrival_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    eventId,
    idA,
    now,
    now,
  );

  const carpoolId = nanoid();
  db.prepare(
    `INSERT INTO carpools (id, event_id, direction, label, seats_total, created_by, created_at) VALUES (?, ?, 'arrival', 'Feature Usage Fahrt', 3, ?, ?)`,
  ).run(carpoolId, eventId, idA, now);
  db.prepare('INSERT INTO carpool_members (carpool_id, player_id) VALUES (?, ?)').run(carpoolId, idB);

  db.prepare('INSERT INTO preferences (player_id, game_id, rating, group_id) VALUES (?, ?, 7, ?)').run(idA, gameId, groupId);

  db.prepare(
    `INSERT INTO event_tracking_consents (id, event_id, group_id, player_id, accepted_at, source) VALUES (?, ?, ?, ?, ?, 'user')`,
  ).run(nanoid(), eventId, groupId, idA, now);

  db.prepare(
    `INSERT INTO play_sessions (id, player_id, game_id, event_id, started_at, ended_at, active_ms, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(nanoid(), idA, gameId, eventId, now - 60_000, now, 45_000, groupId);

  db.prepare(
    `INSERT INTO push_subscriptions (id, player_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, 'p', 'a', ?)`,
  ).run(nanoid(), idA, `https://push.example/${nanoid()}`, now);

  const musicSessionId = nanoid();
  db.prepare(
    `INSERT INTO music_sessions (id, group_id, event_id, host_player_id, device_id, device_name, status, started_at)
     VALUES (?, ?, ?, ?, 'device-1', 'Test Device', 'ended', ?)`,
  ).run(musicSessionId, groupId, eventId, idA, now);
  db.prepare(
    `INSERT INTO music_requests
       (id, session_id, track_uri, track_id, track_name, artist_name, duration_ms, requested_by, requested_by_name_snapshot, status, created_at)
     VALUES (?, ?, 'spotify:track:1', 'track-1', 'Track', 'Artist', 180000, ?, 'Feature Usage A', 'played', ?)`,
  ).run(nanoid(), musicSessionId, idA, now);

  const res = await request(app).get('/api/admin/feature-usage');
  assert.equal(res.status, 200);
  assert.equal(res.body.eventId, null);
  assert.ok(res.body.rosterSize >= 2);

  assert.deepEqual({ players: findEntry(res.body, 'votes').players, total: findEntry(res.body, 'votes').total }, { players: 2, total: 2 });
  assert.deepEqual({ players: findEntry(res.body, 'matches').players, total: findEntry(res.body, 'matches').total }, { players: 2, total: 1 });
  assert.deepEqual(
    { players: findEntry(res.body, 'tournaments').players, total: findEntry(res.body, 'tournaments').total },
    { players: 2, total: 1 },
  );
  assert.deepEqual(
    { players: findEntry(res.body, 'checklist_tasks').players, total: findEntry(res.body, 'checklist_tasks').total },
    { players: 1, total: 1 },
  );
  assert.deepEqual(
    { players: findEntry(res.body, 'food_orders').players, total: findEntry(res.body, 'food_orders').total },
    { players: 1, total: 1 },
  );
  assert.deepEqual(
    { players: findEntry(res.body, 'arrivals').players, total: findEntry(res.body, 'arrivals').total },
    { players: 1, total: 1 },
  );
  assert.deepEqual(
    { players: findEntry(res.body, 'carpools').players, total: findEntry(res.body, 'carpools').total },
    { players: 1, total: 1 },
  );
  const preferences = findEntry(res.body, 'preferences');
  assert.ok(preferences.players >= 1 && preferences.total >= 1);
  assert.deepEqual(
    { players: findEntry(res.body, 'tracking_consent').players, total: findEntry(res.body, 'tracking_consent').total },
    { players: 1, total: 1 },
  );
  assert.deepEqual(
    { players: findEntry(res.body, 'play_sessions').players, total: findEntry(res.body, 'play_sessions').total },
    { players: 1, total: 1 },
  );
  const push = findEntry(res.body, 'push_subscriptions');
  assert.ok(push.players >= 1 && push.total >= 1);
  assert.deepEqual(
    { players: findEntry(res.body, 'music_requests').players, total: findEntry(res.body, 'music_requests').total },
    { players: 1, total: 1 },
  );
});

test('GET /api/admin/feature-usage?eventId= narrows event-scoped entries to that event', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Feature Usage Scoped' });
  const games = (await request(app).get('/api/games')).body as Array<{ id: string }>;
  const gameId = games[0].id;
  const now = Date.now();
  const groupId = DEFAULT_GROUP_ID;

  const otherEventId = nanoid();
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, 'Feature Usage Other Event', ?, ?, 0, ?, 'published', 'participants')`,
  ).run(otherEventId, now, now + 3_600_000, groupId);

  const baseline = await request(app).get(`/api/admin/feature-usage?eventId=${BASE_EVENT_ID}`);
  const baselineVoteTotal = findEntry(baseline.body, 'votes').total;

  db.prepare(
    `INSERT INTO vote_rounds (group_id, round, event_id, started_at, mode) VALUES (?, ?, ?, ?, 'single')`,
  ).run(groupId, 999_002, otherEventId, now);
  db.prepare(
    `INSERT INTO votes (id, group_id, player_id, player_name_snapshot, game_id, event_id, round, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(nanoid(), groupId, player.body.id, 'Feature Usage Scoped', gameId, otherEventId, 999_002, now);

  const scopedToOther = await request(app).get(`/api/admin/feature-usage?eventId=${otherEventId}`);
  assert.equal(scopedToOther.status, 200);
  assert.equal(findEntry(scopedToOther.body, 'votes').total, 1);

  const scopedToBase = await request(app).get(`/api/admin/feature-usage?eventId=${BASE_EVENT_ID}`);
  assert.equal(scopedToBase.status, 200);
  assert.equal(
    findEntry(scopedToBase.body, 'votes').total,
    baselineVoteTotal,
    'vote seeded for the other event must not count against the base event filter',
  );
});

test('GET /api/admin/feature-usage excludes admin-seeded test players from every entry', async () => {
  // Real path: POST /api/admin/test-users (server/src/testUsers.ts) writes
  // directly into preferences, play_sessions and event_tracking_consents for
  // an is_test=1 player — exactly the tables a prior review found leaking
  // into these counts.
  const baseline = await request(app).get('/api/admin/feature-usage');
  assert.equal(baseline.status, 200);
  const before = {
    preferences: findEntry(baseline.body, 'preferences'),
    play_sessions: findEntry(baseline.body, 'play_sessions'),
    tracking_consent: findEntry(baseline.body, 'tracking_consent'),
  };

  const created = await request(app).post('/api/admin/test-users').send({ count: 1 });
  assert.equal(created.status, 201);

  const after = await request(app).get('/api/admin/feature-usage');
  assert.equal(after.status, 200);
  for (const key of ['preferences', 'play_sessions', 'tracking_consent'] as const) {
    assert.deepEqual(
      { players: findEntry(after.body, key).players, total: findEntry(after.body, key).total },
      { players: before[key].players, total: before[key].total },
      `${key} must not count the freshly seeded test player`,
    );
  }
});

test('checklist_tasks stays unfiltered by ?eventId= like its eventScoped: false marker promises', async () => {
  // event_id is nullable on checklist_tasks (the group's permanent room, not
  // tied to one event); the entry is deliberately marked eventScoped: false
  // because an eventId filter would silently drop those NULL rows.
  const player = await request(app).post('/api/players').send({ name: 'Feature Usage Checklist Scope' });
  const groupId = DEFAULT_GROUP_ID;
  const now = Date.now();

  const otherEventId = nanoid();
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, 'Feature Usage Checklist Other Event', ?, ?, 0, ?, 'published', 'participants')`,
  ).run(otherEventId, now, now + 3_600_000, groupId);

  const unscoped = await request(app).get('/api/admin/feature-usage');
  const before = findEntry(unscoped.body, 'checklist_tasks');
  assert.equal(before.eventScoped, false);

  db.prepare(
    `INSERT INTO checklist_tasks (id, group_id, event_id, type, title, created_by, assignee_id, status, created_at, done_at)
     VALUES (?, ?, NULL, 'todo', 'Feature Usage Permanent Room Task', ?, ?, 'done', ?, ?)`,
  ).run(nanoid(), groupId, player.body.id, player.body.id, now, now);

  const scoped = await request(app).get(`/api/admin/feature-usage?eventId=${otherEventId}`);
  assert.equal(scoped.status, 200);
  assert.equal(
    findEntry(scoped.body, 'checklist_tasks').total,
    before.total + 1,
    'a permanent-room task (event_id NULL) must still count when narrowed to an unrelated event',
  );
});

function insertTestPlayer(name: string): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO players (id, name, color, api_key, is_test, created_at) VALUES (?, ?, '#4f9dff', ?, 1, ?)`,
  ).run(id, name, nanoid(), Date.now());
  return id;
}

test('matches and tournaments played entirely between test players do not inflate total, but a mixed one still counts', async () => {
  const realPlayer = await request(app).post('/api/players').send({ name: 'Feature Usage Real Match Player' });
  const testPlayerA = insertTestPlayer('Feature Usage Test Match A');
  const testPlayerB = insertTestPlayer('Feature Usage Test Match B');
  const games = (await request(app).get('/api/games')).body as Array<{ id: string }>;
  const gameId = games[0].id;
  const groupId = DEFAULT_GROUP_ID;
  const now = Date.now();

  const before = await request(app).get('/api/admin/feature-usage');
  const matchesBefore = findEntry(before.body, 'matches').total;
  const tournamentsBefore = findEntry(before.body, 'tournaments').total;

  db.prepare('INSERT INTO matches (id, game_id, event_id, played_at, result, group_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    nanoid(),
    gameId,
    BASE_EVENT_ID,
    now,
    JSON.stringify({ teams: [{ playerIds: [testPlayerA] }, { playerIds: [testPlayerB] }], winnerTeamIndex: 0 }),
    groupId,
  );
  const testOnlyTournamentId = nanoid();
  db.prepare(
    `INSERT INTO tournaments (id, event_id, game_id, name, format, two_legged, track_score, group_count, advancers_per_group, status, created_at, lobby_name, lobby_password, group_id)
     VALUES (?, ?, ?, ?, 'single_elimination', 0, 0, NULL, NULL, 'active', ?, NULL, NULL, ?)`,
  ).run(testOnlyTournamentId, BASE_EVENT_ID, gameId, 'Feature Usage Test-Only Cup', now, groupId);
  db.prepare('INSERT INTO tournament_teams (id, tournament_id, name, player_ids, group_index) VALUES (?, ?, ?, ?, NULL)').run(
    nanoid(),
    testOnlyTournamentId,
    'Team Test',
    JSON.stringify([testPlayerA, testPlayerB]),
  );

  const afterTestOnly = await request(app).get('/api/admin/feature-usage');
  assert.equal(
    findEntry(afterTestOnly.body, 'matches').total,
    matchesBefore,
    'a match played only between test players must not count',
  );
  assert.equal(
    findEntry(afterTestOnly.body, 'tournaments').total,
    tournamentsBefore,
    'a tournament fielding only test-player rosters must not count',
  );

  db.prepare('INSERT INTO matches (id, game_id, event_id, played_at, result, group_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    nanoid(),
    gameId,
    BASE_EVENT_ID,
    now,
    JSON.stringify({ teams: [{ playerIds: [realPlayer.body.id] }, { playerIds: [testPlayerA] }], winnerTeamIndex: 0 }),
    groupId,
  );
  const mixedTournamentId = nanoid();
  db.prepare(
    `INSERT INTO tournaments (id, event_id, game_id, name, format, two_legged, track_score, group_count, advancers_per_group, status, created_at, lobby_name, lobby_password, group_id)
     VALUES (?, ?, ?, ?, 'single_elimination', 0, 0, NULL, NULL, 'active', ?, NULL, NULL, ?)`,
  ).run(mixedTournamentId, BASE_EVENT_ID, gameId, 'Feature Usage Mixed Cup', now, groupId);
  db.prepare('INSERT INTO tournament_teams (id, tournament_id, name, player_ids, group_index) VALUES (?, ?, ?, ?, NULL)').run(
    nanoid(),
    mixedTournamentId,
    'Team Mixed',
    JSON.stringify([realPlayer.body.id, testPlayerA]),
  );

  const afterMixed = await request(app).get('/api/admin/feature-usage');
  assert.equal(
    findEntry(afterMixed.body, 'matches').total,
    matchesBefore + 1,
    'a match with at least one real participant must still count',
  );
  assert.equal(
    findEntry(afterMixed.body, 'tournaments').total,
    tournamentsBefore + 1,
    'a tournament with at least one real participant must still count',
  );
});

test('food_orders order count in detail excludes orders created by test players', async () => {
  const testCreator = insertTestPlayer('Feature Usage Test Order Creator');
  const now = Date.now();

  const before = await request(app).get('/api/admin/feature-usage');
  const detailBefore = findEntry(before.body, 'food_orders').detail;

  db.prepare('INSERT INTO food_orders (id, event_id, title, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
    nanoid(),
    BASE_EVENT_ID,
    'Feature Usage Test Order',
    testCreator,
    now,
  );

  const after = await request(app).get('/api/admin/feature-usage');
  assert.equal(
    findEntry(after.body, 'food_orders').detail,
    detailBefore,
    'an order created by a test player must not raise the order count',
  );
});
