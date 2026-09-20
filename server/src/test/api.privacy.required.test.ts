import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import request from 'supertest';
import { createApp } from '../app';
import { createTestApp, DEFAULT_GROUP_ID, sessionCookie } from './testApp';
import { BASE_EVENT_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';

function createMember(label: string): { id: string; apiKey: string; cookie: string } {
  const id = nanoid();
  const apiKey = `agent-${nanoid(24)}`;
  db.prepare(
    `INSERT INTO players (id, name, real_name, api_key, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `${label} Gamertag`, `${label} Klarname`, apiKey, `hash-${nanoid()}`, Date.now());
  ensureDefaultGroupMembership(id);
  return { id, apiKey, cookie: sessionCookie(id) };
}

test('personal export is self-scoped and excludes every reusable access secret', async () => {
  const app = createTestApp();
  assert.equal((await request(createApp()).get('/api/privacy/export')).status, 401);
  const own = createMember('Export Own');
  const other = createMember('Export Foreign');
  const ownMessage = `own-${nanoid()}`;
  const foreignMessage = `foreign-${nanoid()}`;
  const endpointSecret = `https://push.invalid/${nanoid()}`;
  const exportEventId = nanoid();
  const drawingId = nanoid();
  const pingId = nanoid();
  const gameId = (db.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get(DEFAULT_GROUP_ID) as { id: string }).id;
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status)
     VALUES (?, 'Export event', ?, ?, ?, 'ended')`,
  ).run(exportEventId, Date.now() - 2_000, Date.now() - 1_000, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO seating_layouts (group_id, event_id, assignments, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(DEFAULT_GROUP_ID, exportEventId, JSON.stringify([{ side: 'top', seat: 1, playerId: own.id }]), Date.now());
  db.prepare(
    `INSERT INTO seat_neighbors
       (group_id, event_id, player_id, neighbor_id, player_name_snapshot, neighbor_name_snapshot, source)
     VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
  ).run(DEFAULT_GROUP_ID, exportEventId, own.id, other.id, 'Export Own Gamertag', 'Export Foreign Gamertag');
  db.prepare(
    `INSERT INTO scribble_drawings
       (id, match_id, round_number, turn_number, artist_id, artist_name, word, draw_ops,
        created_at, group_id, event_id)
     VALUES (?, ?, 1, 1, ?, ?, 'Datenschutz', ?, ?, ?, ?)`,
  ).run(drawingId, nanoid(), own.id, 'Export Own Gamertag', JSON.stringify([{ x: 1, y: 2 }]), Date.now(), DEFAULT_GROUP_ID, exportEventId);
  db.prepare(
    `INSERT INTO game_pings
       (id, group_id, event_id, player_id, player_name_snapshot, player_color_snapshot,
        player_avatar_snapshot, game_id, game_name_snapshot, game_icon_snapshot, message,
        created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, '#123456', NULL, ?, 'Export game', '🎮', 'Eigener Ping', ?, ?)`,
  ).run(pingId, DEFAULT_GROUP_ID, exportEventId, own.id, 'Export Own Gamertag', gameId, Date.now(), Date.now() + 60_000);
  db.prepare(
    `INSERT INTO push_subscriptions (id, player_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(nanoid(), own.id, endpointSecret, `p256-${nanoid()}`, `auth-${nanoid()}`, Date.now());
  db.prepare(
    `INSERT INTO feedback_entries
       (id, group_id, event_id, player_id, view, sentiment, message, device, created_at)
     VALUES (?, ?, ?, ?, 'profile', 'positive', ?, 'desktop', ?)`,
  ).run(nanoid(), DEFAULT_GROUP_ID, BASE_EVENT_ID, own.id, ownMessage, Date.now());
  db.prepare(
    `INSERT INTO feedback_entries
       (id, group_id, event_id, player_id, view, sentiment, message, device, created_at)
     VALUES (?, ?, ?, ?, 'profile', 'negative', ?, 'mobile', ?)`,
  ).run(nanoid(), DEFAULT_GROUP_ID, BASE_EVENT_ID, other.id, foreignMessage, Date.now());

  const response = await request(app).get('/api/privacy/export').set('Cookie', own.cookie);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.headers['content-disposition'], /respawn-meine-daten/);
  const serialized = JSON.stringify(response.body);
  assert.match(serialized, new RegExp(ownMessage));
  assert.doesNotMatch(serialized, new RegExp(foreignMessage));
  assert.doesNotMatch(serialized, new RegExp(own.apiKey));
  assert.doesNotMatch(serialized, /hash-/);
  assert.equal(serialized.includes(endpointSecret), false);
  assert.doesNotMatch(serialized, /p256-|auth-/);
  assert.equal(response.body.browserAndPush.pushSubscriptions.length, 1);
  assert.deepEqual(Object.keys(response.body.browserAndPush.pushSubscriptions[0]), ['createdAt']);
  assert.equal(response.body.arcade.scribbleDrawings.some((drawing: { id: string }) => drawing.id === drawingId), true);
  assert.equal(response.body.organisation.seatingAssignments.some((seat: { eventId: string }) => seat.eventId === exportEventId), true);
  assert.equal(response.body.organisation.seatNeighborRelations.length, 1);
  assert.equal(response.body.organisation.authoredGamePings.some((ping: { id: string }) => ping.id === pingId), true);
  assert.equal((await request(app).get('/api/privacy/retention-preview').set('Cookie', own.cookie)).status, 403);
  assert.equal((await request(app).get('/api/privacy/deletion-receipts').set('Cookie', own.cookie)).status, 403);

});

test('self deletion revokes access and scrubs recipient, result and historical name copies', async () => {
  const app = createTestApp();
  const target = createMember('Delete Target');
  const other = createMember('Delete Other');
  const now = Date.now();
  const gameId = (db.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get(DEFAULT_GROUP_ID) as { id: string }).id;
  const pushId = nanoid();
  const broadcastId = nanoid();
  const matchId = nanoid();
  const arcadeResultId = nanoid();
  const snapshotEventId = nanoid();
  const drawId = nanoid();
  const drawingId = nanoid();
  const auditId = nanoid();
  const musicSessionId = nanoid();
  const musicRequestId = nanoid();
  db.prepare('UPDATE players SET avatar = ? WHERE id = ?').run('data:image/png;base64,private-avatar', target.id);
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status)
     VALUES (?, 'Privacy snapshot event', ?, ?, ?, 'ended')`,
  ).run(snapshotEventId, now - 2_000, now - 1_000, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, created_at)
     VALUES (?, ?, ?, 'Test', 'Test', 'direct', ?, ?)`,
  ).run(pushId, DEFAULT_GROUP_ID, BASE_EVENT_ID, JSON.stringify([target.id, other.id]), now);
  db.prepare("UPDATE push_log SET title = ?, body = ? WHERE id = ?")
    .run('Delete Target Gamertag-Party', 'Delete Target GamertagA bleibt bestehen', pushId);
  db.prepare(
    `INSERT INTO broadcasts
       (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, recipient_ids, created_at)
     VALUES (?, ?, ?, ?, ?, 'Test', ?, ?, ?)`,
  ).run(broadcastId, DEFAULT_GROUP_ID, BASE_EVENT_ID, other.id, 'Delete Other Gamertag', now + 60_000, JSON.stringify([target.id, other.id]), now);
  db.prepare(
    `INSERT INTO matches (id, game_id, event_id, played_at, result, group_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(matchId, gameId, BASE_EVENT_ID, now, JSON.stringify({ winnerId: target.id, winnerName: 'Delete Target Gamertag', players: [{ playerId: target.id, name: 'Delete Target Klarname' }, { playerId: other.id, name: 'Delete Other Gamertag' }] }), DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO matchmaking_draws
       (id, game_id, event_id, teams, generated_at, group_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    drawId,
    gameId,
    snapshotEventId,
    JSON.stringify([{ players: [{ id: target.id, name: 'Delete Target Gamertag', realName: 'Delete Target Klarname', avatar: 'data:image/png;base64,private-avatar', color: '#abcdef', rating: 9 }] }]),
    now,
    DEFAULT_GROUP_ID,
  );
  db.prepare(
    `INSERT INTO scribble_drawings
       (id, match_id, round_number, turn_number, artist_id, artist_name, word, draw_ops,
        created_at, group_id, event_id)
     VALUES (?, ?, 1, 1, ?, ?, 'Löschtest', '[]', ?, ?, ?)`,
  ).run(drawingId, nanoid(), target.id, 'Delete Target Gamertag', now, DEFAULT_GROUP_ID, snapshotEventId);
  db.prepare(
    `INSERT INTO seating_layouts
       (event_id, assignments, updated_at, group_id)
     VALUES (?, ?, ?, ?)`,
  ).run(snapshotEventId, JSON.stringify([{ side: 'top', seat: 0, playerId: target.id }]), now, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO arcade_results
       (id, game_type, winner_id, players, scores, reason, started_at, ended_at, group_id, event_id)
     VALUES (?, 'quiz', ?, ?, ?, 'finished', ?, ?, ?, ?)`,
  ).run(arcadeResultId, target.id, JSON.stringify([{ playerId: target.id, name: 'Delete Target Gamertag' }]), JSON.stringify({ [target.id]: 5 }), now - 1_000, now, DEFAULT_GROUP_ID, BASE_EVENT_ID);
  db.prepare(
    `INSERT INTO arcade_result_participants
       (result_id, group_id, player_id, participant_key, player_name_snapshot, score_snapshot, is_winner)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(arcadeResultId, DEFAULT_GROUP_ID, target.id, target.id, 'Delete Target Gamertag', JSON.stringify({ playerId: target.id, playerName: 'Delete Target Klarname', points: 5 }));
  db.prepare(
    `INSERT INTO admin_log
       (id, actor_player_id, group_id, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, 'event_participant_invited', 'event_participant', ?, ?, ?)`,
  ).run(
    auditId,
    other.id,
    DEFAULT_GROUP_ID,
    `${snapshotEventId}:${target.id}`,
    JSON.stringify({ eventId: snapshotEventId, playerId: target.id }),
    now,
  );
  db.prepare(
    `INSERT INTO music_sessions
       (id, group_id, event_id, host_player_id, device_id, device_name, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'privacy-device', 'Privacy device', 'ended', ?, ?)`,
  ).run(musicSessionId, DEFAULT_GROUP_ID, snapshotEventId, target.id, now - 1_000, now);
  db.prepare(
    `INSERT INTO music_requests
       (id, session_id, track_uri, track_id, track_name, artist_name, duration_ms,
        requested_by, requested_by_name_snapshot, status, created_at, played_at)
     VALUES (?, ?, 'spotify:track:privacy', 'privacy-track', 'Privacy track', 'Privacy artist',
             180000, ?, 'Delete Other Gamertag', 'played', ?, ?)`,
  ).run(musicRequestId, musicSessionId, other.id, now - 500, now);

  const deleted = await request(app).delete('/api/privacy/account').set('Cookie', target.cookie);
  assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
  assert.equal(db.prepare('SELECT 1 FROM players WHERE id = ?').get(target.id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE player_id = ?').get(target.id), undefined);
  assert.deepEqual(JSON.parse((db.prepare('SELECT player_ids FROM push_log WHERE id = ?').get(pushId) as { player_ids: string }).player_ids), [other.id]);
  const pushCopy = db.prepare('SELECT title, body FROM push_log WHERE id = ?').get(pushId) as { title: string; body: string };
  assert.deepEqual(pushCopy, {
    title: 'Delete Target Gamertag-Party',
    body: 'Delete Target GamertagA bleibt bestehen',
  });
  assert.deepEqual(JSON.parse((db.prepare('SELECT recipient_ids FROM broadcasts WHERE id = ?').get(broadcastId) as { recipient_ids: string }).recipient_ids), [other.id]);
  const matchResult = (db.prepare('SELECT result FROM matches WHERE id = ?').get(matchId) as { result: string }).result;
  assert.doesNotMatch(matchResult, new RegExp(target.id));
  assert.doesNotMatch(matchResult, /Delete Target/);
  assert.match(matchResult, /Gelöschtes Konto/);
  assert.equal(
    JSON.stringify(db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').get(drawId)).includes(target.id),
    false,
  );
  const drawTeams = JSON.parse((db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').get(drawId) as { teams: string }).teams);
  assert.deepEqual(drawTeams[0].players[0], {
    id: null,
    name: 'Gelöschtes Konto',
    realName: 'Gelöschtes Konto',
    avatar: null,
    color: null,
    rating: null,
  });
  assert.deepEqual(
    db.prepare('SELECT artist_id AS artistId, artist_name AS artistName FROM scribble_drawings WHERE id = ?').get(drawingId),
    { artistId: null, artistName: 'Gelöschtes Konto' },
  );
  assert.equal(
    (db.prepare('SELECT assignments FROM seating_layouts WHERE event_id = ?').get(snapshotEventId) as { assignments: string }).assignments.includes(target.id),
    false,
  );
  const arcadeParticipant = db.prepare(
    'SELECT player_id AS playerId, participant_key AS participantKey, player_name_snapshot AS playerName, score_snapshot AS score FROM arcade_result_participants WHERE result_id = ?',
  ).get(arcadeResultId) as { playerId: string | null; participantKey: string; playerName: string; score: string };
  assert.equal(arcadeParticipant.playerId, null);
  assert.match(arcadeParticipant.participantKey, /^deleted-/);
  assert.equal(arcadeParticipant.playerName, 'Gelöschtes Konto');
  assert.doesNotMatch(arcadeParticipant.score, /Delete Target/);
  assert.equal(arcadeParticipant.score.includes(target.id), false);
  const audit = db.prepare('SELECT target_id AS targetId, details FROM admin_log WHERE id = ?').get(auditId) as {
    targetId: string | null;
    details: string;
  };
  assert.equal(audit.targetId, null);
  assert.equal((JSON.parse(audit.details) as { playerId: string | null }).playerId, null);
  assert.deepEqual(
    db.prepare('SELECT host_player_id AS hostPlayerId FROM music_sessions WHERE id = ?').get(musicSessionId),
    { hostPlayerId: null },
  );
  assert.deepEqual(
    db.prepare('SELECT requested_by AS requestedBy FROM music_requests WHERE id = ?').get(musicRequestId),
    { requestedBy: other.id },
  );
  assert.equal((await request(app).get('/api/privacy').set('Cookie', target.cookie)).status, 401);
  const receipts = await request(app).get('/api/privacy/deletion-receipts');
  assert.equal(receipts.status, 200);
  assert.equal(receipts.body.format, 'respawn-deletion-receipts');
  assert.equal(receipts.body.receipts.some((receipt: { subjectHash: string }) => /^[a-f0-9]{64}$/.test(receipt.subjectHash)), true);
});

test('self deletion explains role and open-process blockers without partial deletion', async () => {
  const app = createTestApp();
  const target = createMember('Delete Blocked');
  const orderId = nanoid();
  db.prepare(
    `INSERT INTO food_orders (id, event_id, title, created_by, created_at)
     VALUES (?, ?, 'Offene Bestellung', ?, ?)`,
  ).run(orderId, BASE_EVENT_ID, target.id, Date.now());
  const response = await request(app).delete('/api/privacy/account').set('Cookie', target.cookie);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'owned_food_orders');
  assert.match(response.body.error, /Sammelbestellungen/);
  assert.ok(db.prepare('SELECT 1 FROM players WHERE id = ?').get(target.id));
  assert.ok(db.prepare('SELECT 1 FROM food_orders WHERE id = ?').get(orderId));
});
