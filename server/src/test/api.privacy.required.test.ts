import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import request from 'supertest';
import { createApp } from '../app';
import { createTestApp, DEFAULT_GROUP_ID, enableTestTracking, sessionCookie } from './testApp';
import { BASE_EVENT_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { config } from '../config';

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
  const auditId = nanoid();
  const draftId = nanoid();
  const tournamentId = nanoid();
  const ownTeamId = nanoid();
  const otherTeamId = nanoid();
  const tournamentMatchId = nanoid();
  const recordedMatchId = nanoid();
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
  db.prepare(
    `INSERT INTO admin_log
       (id, actor_player_id, group_id, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, 'event_participant_invited', 'event_participant', ?, '{}', ?)`,
  ).run(auditId, other.id, DEFAULT_GROUP_ID, `${exportEventId}:${own.id}`, Date.now());
  db.prepare(
    `INSERT INTO drafts
       (id, group_id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at)
     VALUES (?, ?, ?, ?, 'completed', ?, '[]', '[]', ?)`,
  ).run(draftId, DEFAULT_GROUP_ID, exportEventId, gameId, JSON.stringify([own.id]), Date.now());
  db.prepare(
    `INSERT INTO draft_player_refs
       (draft_id, group_id, player_id, role, player_name_snapshot, player_color_snapshot)
     VALUES (?, ?, ?, 'captain', 'Export Own Gamertag', '#123456')`,
  ).run(draftId, DEFAULT_GROUP_ID, own.id);
  db.prepare(
    `INSERT INTO tournaments
       (id, group_id, event_id, game_id, name, format, status, created_at)
     VALUES (?, ?, ?, ?, 'Export Cup', 'round_robin', 'completed', ?)`,
  ).run(tournamentId, DEFAULT_GROUP_ID, exportEventId, gameId, Date.now());
  db.prepare(
    'INSERT INTO tournament_teams (id, tournament_id, name, player_ids) VALUES (?, ?, ?, ?)',
  ).run(ownTeamId, tournamentId, 'Export Own Team', JSON.stringify([own.id]));
  db.prepare(
    'INSERT INTO tournament_teams (id, tournament_id, name, player_ids) VALUES (?, ?, ?, ?)',
  ).run(otherTeamId, tournamentId, 'Export Other Team', JSON.stringify([other.id]));
  db.prepare(
    `INSERT INTO tournament_matches
       (id, tournament_id, round, slot, team_a_id, team_b_id, winner_team_id,
        score_a, score_b, is_draw, is_bye, played_at)
     VALUES (?, ?, 1, 0, ?, ?, ?, 2, 1, 0, 0, ?)`,
  ).run(tournamentMatchId, tournamentId, ownTeamId, otherTeamId, ownTeamId, Date.now());
  db.prepare(
    `INSERT INTO matches (id, group_id, game_id, event_id, played_at, result)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    recordedMatchId,
    DEFAULT_GROUP_ID,
    gameId,
    exportEventId,
    Date.now(),
    JSON.stringify({
      teams: [
        { playerIds: [own.id], score: 2 },
        { playerIds: [other.id], score: 1 },
      ],
      winnerTeamIndex: 0,
    }),
  );

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
  assert.equal(response.body.competition.drafts.some((draft: { draftId: string }) => draft.draftId === draftId), true);
  assert.equal(response.body.competition.tournamentTeams.some((team: { teamId: string }) => team.teamId === ownTeamId), true);
  assert.equal(response.body.competition.tournamentMatches.some((match: { id: string; outcome: string }) => match.id === tournamentMatchId && match.outcome === 'win'), true);
  assert.equal(response.body.competition.recordedMatches.some((match: { id: string; outcome: string }) => match.id === recordedMatchId && match.outcome === 'win'), true);
  assert.equal(JSON.stringify(response.body.competition).includes(other.id), false);
  assert.equal(
    response.body.audit.some(
      (entry: { action: string; targetType: string; targetedOwnAccount: number }) =>
        entry.action === 'event_participant_invited' &&
        entry.targetType === 'event_participant' &&
        entry.targetedOwnAccount === 1,
    ),
    true,
  );
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
  const accountAuditId = nanoid();
  const checklistTaskId = nanoid();
  const checklistPushId = nanoid();
  db.prepare('UPDATE players SET avatar = ? WHERE id = ?').run('data:image/png;base64,private-avatar', target.id);
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status)
     VALUES (?, 'Privacy snapshot event', ?, ?, ?, 'ended')`,
  ).run(snapshotEventId, now - 2_000, now - 1_000, DEFAULT_GROUP_ID);
  db.prepare(
    `INSERT INTO push_log
       (id, group_id, event_id, title, body, audience, player_ids, topic_key, target_id, created_at)
     VALUES (?, ?, ?, 'Test', 'Test', 'direct', ?, ?, ?, ?)`,
  ).run(
    pushId,
    DEFAULT_GROUP_ID,
    BASE_EVENT_ID,
    JSON.stringify([target.id, other.id]),
    `event-payment-reminder:${target.id}:${BASE_EVENT_ID}`,
    `event-reminder:${BASE_EVENT_ID}:${target.id}:schedule-1`,
    now,
  );
  db.prepare(
    `INSERT INTO admin_log
       (id, actor_player_id, group_id, action, target_type, target_id, details, created_at)
     VALUES (?, NULL, ?, 'login_failed', 'account_name', 'delete target gamertag', '{}', ?)`,
  ).run(accountAuditId, DEFAULT_GROUP_ID, now);
  db.prepare(
    `INSERT INTO checklist_tasks
       (id, group_id, event_id, type, title, created_by, assignee_id, status, created_at, done_at)
     VALUES (?, ?, ?, 'todo', 'Private Aufgabe', ?, ?, 'done', ?, ?)`,
  ).run(checklistTaskId, DEFAULT_GROUP_ID, snapshotEventId, target.id, target.id, now, now);
  db.prepare(
    `INSERT INTO push_log
       (id, group_id, event_id, title, body, audience, player_ids, topic_key, created_at)
     VALUES (?, ?, ?, 'To-do', 'Delete Target Gamertag: Private Aufgabe', 'direct', ?, ?, ?)`,
  ).run(
    checklistPushId,
    DEFAULT_GROUP_ID,
    snapshotEventId,
    JSON.stringify([other.id]),
    `checklist-task:${checklistTaskId}`,
    now,
  );
  // A claim push is sent to the task creator but its body is a sentence about
  // the claiming account and quotes that account's own comment, so clearing
  // the identifier would not be enough.
  const claimPushId = nanoid();
  db.prepare(
    `INSERT INTO push_log
       (id, group_id, event_id, title, body, audience, player_ids, target_id, created_at)
     VALUES (?, ?, ?, 'Übernommen', ?, 'direct', ?, ?, ?)`,
  ).run(
    claimPushId,
    DEFAULT_GROUP_ID,
    snapshotEventId,
    'Delete Target Gamertag übernimmt: Tische aufbauen – bringe eigenes Werkzeug mit',
    JSON.stringify([other.id]),
    `about-account:checklist-claim:${nanoid()}:${target.id}`,
    now,
  );
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
  // The permanent room plan of a group is the same table with event_id = NULL
  // and additionally stores a plain name snapshot.
  db.prepare(
    `INSERT INTO seating_layouts
       (event_id, assignments, updated_at, group_id)
     VALUES (NULL, ?, ?, ?)`,
  ).run(
    JSON.stringify([{ side: 'left', seat: 1, playerId: target.id, playerNameSnapshot: 'Delete Target Gamertag' }]),
    now,
    DEFAULT_GROUP_ID,
  );
  db.prepare(
    `INSERT INTO arcade_results
       (id, game_type, winner_id, players, scores, reason, started_at, ended_at, group_id, event_id)
     VALUES (?, 'quiz', ?, ?, ?, 'finished', ?, ?, ?, ?)`,
    // The score map already carries an earlier erasure, so the anonymous key
    // has to stay free for this account instead of overwriting that entry.
  ).run(arcadeResultId, target.id, JSON.stringify([{ playerId: target.id, name: 'Delete Target Gamertag' }]), JSON.stringify({ deletedAccount: 3, [target.id]: 5 }), now - 1_000, now, DEFAULT_GROUP_ID, BASE_EVENT_ID);
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
  const pushCopy = db.prepare(
    'SELECT title, body, topic_key AS topicKey, target_id AS targetId FROM push_log WHERE id = ?',
  ).get(pushId) as { title: string; body: string; topicKey: string | null; targetId: string | null };
  assert.deepEqual(pushCopy, {
    title: 'Delete Target Gamertag-Party',
    body: 'Delete Target GamertagA bleibt bestehen',
    topicKey: null,
    targetId: null,
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
  const roomLayout = (db.prepare(
    'SELECT assignments FROM seating_layouts WHERE group_id = ? AND event_id IS NULL',
  ).get(DEFAULT_GROUP_ID) as { assignments: string }).assignments;
  assert.equal(roomLayout.includes(target.id), false, 'the room plan must not keep the account id');
  assert.doesNotMatch(roomLayout, /Delete Target/, 'the room plan must not keep the name snapshot');
  assert.deepEqual(
    JSON.parse((db.prepare('SELECT scores FROM arcade_results WHERE id = ?').get(arcadeResultId) as { scores: string }).scores),
    { deletedAccount: 3, 'deletedAccount-2': 5 },
    'a second erasure must not overwrite an earlier anonymous entry',
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
    db.prepare('SELECT target_id AS targetId FROM admin_log WHERE id = ?').get(accountAuditId),
    { targetId: null },
  );
  assert.equal(db.prepare('SELECT 1 FROM push_log WHERE id = ?').get(checklistPushId), undefined);
  assert.equal(
    db.prepare('SELECT 1 FROM push_log WHERE id = ?').get(claimPushId),
    undefined,
    'a push whose body is a sentence about the account must be removed, not only unlinked',
  );
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
  assert.match(response.body.error, /von dir/, 'self service addresses the account owner');
  assert.ok(db.prepare('SELECT 1 FROM players WHERE id = ?').get(target.id));
  assert.ok(db.prepare('SELECT 1 FROM food_orders WHERE id = ?').get(orderId));

  // The admin path shares the blockers but must not tell the admin to clean
  // up "your" own order.
  const admin = createMember('Delete Blocking Admin');
  db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(admin.id);
  db.prepare("UPDATE group_memberships SET role = 'owner' WHERE group_id = ? AND player_id = ?").run(DEFAULT_GROUP_ID, admin.id);
  const adminAttempt = await request(app).delete(`/api/players/${target.id}`).set('Cookie', admin.cookie);
  assert.equal(adminAttempt.status, 409, JSON.stringify(adminAttempt.body));
  assert.equal(adminAttempt.body.code, 'owned_food_orders');
  assert.match(adminAttempt.body.error, /Sammelbestellungen/);
  assert.doesNotMatch(adminAttempt.body.error, /von dir|deine/i, 'the admin is not the account owner');
  assert.ok(db.prepare('SELECT 1 FROM players WHERE id = ?').get(target.id));
});

test('self deletion writes a durable hash-only ledger before removing the account', async () => {
  const app = createTestApp();
  const target = createMember('Durable Receipt');
  const directory = mkdtempSync(path.join(tmpdir(), 'respawn-deletion-ledger-'));
  const ledger = path.join(directory, 'receipts.jsonl');
  const mutableConfig = config as unknown as { deletionLedgerFile: string };
  const previousLedger = mutableConfig.deletionLedgerFile;
  mutableConfig.deletionLedgerFile = ledger;
  try {
    const deleted = await request(app).delete('/api/privacy/account').set('Cookie', target.cookie);
    assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
    const entries = readFileSync(ledger, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(entries.length, 1);
    assert.match(entries[0].subjectHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(entries).includes(target.id), false);
    assert.equal(JSON.stringify(entries).includes('Durable Receipt'), false);
  } finally {
    mutableConfig.deletionLedgerFile = previousLedger;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('self deletion fails closed when the durable ledger is unavailable', async () => {
  const app = createTestApp();
  const target = createMember('Unavailable Receipt');
  const directory = mkdtempSync(path.join(tmpdir(), 'respawn-deletion-ledger-blocked-'));
  const mutableConfig = config as unknown as { deletionLedgerFile: string };
  const previousLedger = mutableConfig.deletionLedgerFile;
  mutableConfig.deletionLedgerFile = directory;
  try {
    const response = await request(app).delete('/api/privacy/account').set('Cookie', target.cookie);
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'deletion_receipt_unavailable');
    assert.ok(db.prepare('SELECT 1 FROM players WHERE id = ?').get(target.id));
  } finally {
    mutableConfig.deletionLedgerFile = previousLedger;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('self deletion clears the own claim comment on another account\'s task', async () => {
  const app = createTestApp();
  const creator = createMember('Claim Creator');
  const claimer = createMember('Claim Author');
  const taskId = nanoid();
  const claimComment = `beamer-${nanoid()}`;
  // Completed, so no open-to-do blocker applies; created by someone else, so
  // the assignee_id cascade must not take the task with it.
  db.prepare(
    `INSERT INTO checklist_tasks
       (id, group_id, event_id, type, title, description, created_by, assignee_id,
        claim_comment, status, created_at, taken_at, done_at)
     VALUES (?, ?, ?, 'todo', 'Beamer holen', NULL, ?, ?, ?, 'done', ?, ?, ?)`,
  ).run(taskId, DEFAULT_GROUP_ID, BASE_EVENT_ID, creator.id, claimer.id, claimComment, Date.now(), Date.now(), Date.now());

  const exported = await request(app).get('/api/privacy/export').set('Cookie', claimer.cookie);
  assert.equal(exported.status, 200);
  assert.ok(
    exported.text.includes(claimComment),
    'the export presents the claim comment as the account\'s own data',
  );

  const response = await request(app).delete('/api/privacy/account').set('Cookie', claimer.cookie);
  assert.equal(response.status, 204, JSON.stringify(response.body));

  const task = db
    .prepare('SELECT created_by, assignee_id, claim_comment FROM checklist_tasks WHERE id = ?')
    .get(taskId) as { created_by: string; assignee_id: string | null; claim_comment: string | null } | undefined;
  assert.ok(task, 'the other account keeps its task');
  assert.equal(task!.created_by, creator.id);
  assert.equal(task!.assignee_id, null);
  assert.equal(task!.claim_comment, null, 'the deleted account\'s own free text is gone');
});

test('revoking event consent clears the stored diagnostic process snapshot', async () => {
  const app = createTestApp();
  const member = createMember('Revoke Diagnostics');
  db.prepare(
    `INSERT OR REPLACE INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')`,
  ).run(BASE_EVENT_ID, member.id);
  enableTestTracking(member.id, BASE_EVENT_ID);
  const game = db.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get(DEFAULT_GROUP_ID) as { id: string };
  db.prepare(
    'INSERT OR IGNORE INTO game_process_names (id, group_id, game_id, process_name) VALUES (?, ?, ?, ?)',
  ).run(nanoid(), DEFAULT_GROUP_ID, game.id, 'cs2.exe');

  const report = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', member.apiKey)
    .send({ processNames: ['cs2.exe'], foregroundProcessName: 'cs2.exe', agentVersion: '1.0.0' });
  assert.equal(report.status, 200);
  const stored = () =>
    (db.prepare('SELECT process_names FROM agent_diagnostics WHERE player_id = ?').get(member.id) as
      | { process_names: string }
      | undefined)?.process_names;
  assert.equal(stored(), JSON.stringify(['cs2.exe']), 'a valid context stores the matched name');

  const revoked = await request(app)
    .post(`/api/events/${BASE_EVENT_ID}/tracking-consent`)
    .set('Cookie', member.cookie)
    .send({ granted: false });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(stored(), '[]', 'the revocation clears what was already collected');

  // The export must not claim emptiness while the row still holds names.
  const exported = await request(app).get('/api/privacy/export').set('Cookie', member.cookie);
  assert.equal(exported.status, 200);
  assert.deepEqual(JSON.parse(exported.text).activity.agent.processNames, []);
});

test('an outdated event consent stays revocable through the privacy view', async () => {
  const app = createTestApp();
  const member = createMember('Legacy Consent');
  db.prepare(
    `INSERT OR REPLACE INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')`,
  ).run(BASE_EVENT_ID, member.id);
  const consentId = nanoid();
  // The shape migration 105 deliberately preserves: granted, never revoked,
  // without purpose or text version.
  db.prepare(
    `INSERT INTO event_tracking_consents (id, event_id, group_id, player_id, accepted_at, source)
     VALUES (?, ?, ?, ?, ?, 'user')`,
  ).run(consentId, BASE_EVENT_ID, DEFAULT_GROUP_ID, member.id, Date.now() - 1_000);

  const view = await request(app).get('/api/privacy').set('Cookie', member.cookie);
  assert.equal(view.status, 200);
  assert.equal(
    view.body.trackingConsent.events.find((row: { eventId: string }) => row.eventId === BASE_EVENT_ID)?.consentId,
    null,
    'an unversioned row never counts as an active consent',
  );
  const legacy = view.body.trackingConsent.legacyEvents as Array<{ eventId: string; textVersion: string | null }>;
  assert.equal(legacy.length, 1, 'it is offered separately instead of staying invisible');
  assert.equal(legacy[0].eventId, BASE_EVENT_ID);
  assert.equal(legacy[0].textVersion, null);

  const revoked = await request(app)
    .post(`/api/events/${BASE_EVENT_ID}/tracking-consent`)
    .set('Cookie', member.cookie)
    .send({ granted: false });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.ok(
    (db.prepare('SELECT revoked_at FROM event_tracking_consents WHERE id = ?').get(consentId) as {
      revoked_at: number | null;
    }).revoked_at,
    'revoking needs no text version',
  );
  const after = await request(app).get('/api/privacy').set('Cookie', member.cookie);
  assert.deepEqual(after.body.trackingConsent.legacyEvents, []);
});
