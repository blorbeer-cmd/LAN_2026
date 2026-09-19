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
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status)
     VALUES (?, 'Privacy snapshot event', ?, ?, ?, 'ended')`,
  ).run(snapshotEventId, now - 2_000, now - 1_000, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO push_log (id, group_id, event_id, title, body, audience, player_ids, created_at)
     VALUES (?, ?, ?, 'Test', 'Test', 'direct', ?, ?)`,
  ).run(pushId, DEFAULT_GROUP_ID, BASE_EVENT_ID, JSON.stringify([target.id, other.id]), now);
  db.prepare("UPDATE push_log SET title = ?, body = ? WHERE id = ?")
    .run('Delete Target Gamertag ist aktiv', 'Nachricht von Delete Target Klarname', pushId);
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
  ).run(drawId, gameId, snapshotEventId, JSON.stringify([{ players: [{ id: target.id, name: 'Delete Target Gamertag' }] }]), now, DEFAULT_GROUP_ID);
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

  const deleted = await request(app).delete('/api/privacy/account').set('Cookie', target.cookie);
  assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
  assert.equal(db.prepare('SELECT 1 FROM players WHERE id = ?').get(target.id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE player_id = ?').get(target.id), undefined);
  assert.deepEqual(JSON.parse((db.prepare('SELECT player_ids FROM push_log WHERE id = ?').get(pushId) as { player_ids: string }).player_ids), [other.id]);
  const pushCopy = db.prepare('SELECT title, body FROM push_log WHERE id = ?').get(pushId) as { title: string; body: string };
  assert.doesNotMatch(`${pushCopy.title} ${pushCopy.body}`, /Delete Target/);
  assert.match(`${pushCopy.title} ${pushCopy.body}`, /Gelöschtes Konto/);
  assert.deepEqual(JSON.parse((db.prepare('SELECT recipient_ids FROM broadcasts WHERE id = ?').get(broadcastId) as { recipient_ids: string }).recipient_ids), [other.id]);
  const matchResult = (db.prepare('SELECT result FROM matches WHERE id = ?').get(matchId) as { result: string }).result;
  assert.doesNotMatch(matchResult, new RegExp(target.id));
  assert.doesNotMatch(matchResult, /Delete Target/);
  assert.match(matchResult, /Gelöschtes Konto/);
  assert.equal(
    JSON.stringify(db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').get(drawId)).includes(target.id),
    false,
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
