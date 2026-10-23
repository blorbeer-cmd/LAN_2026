import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { createInvite } from '../invites';
import { SESSION_COOKIE_NAME } from '../sessions';
import { db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { nanoid } from 'nanoid';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';

const app = createApp();
const mutableConfig = config as unknown as { welcomeTrailerDir: string };

function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(cookie, 'response should set a session cookie');
  return cookie!.split(';')[0];
}

test('new accounts can complete onboarding without catalog ratings', async () => {
  const adminId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, is_admin, created_at) VALUES (?, ?, ?, 1, ?)').run(
    adminId,
    'Onboarding Admin',
    nanoid(24),
    Date.now(),
  );
  ensureDefaultGroupMembership(adminId, { bootstrapAdmin: true });

  const adminInvite = createInvite({ purpose: 'claim', playerId: adminId, createdBy: adminId });
  const adminClaim = await request(app).post('/api/auth/claim').send({ code: adminInvite.code, password: 'admin password' });
  assert.equal(adminClaim.status, 200, JSON.stringify(adminClaim.body));
  const adminCookie = sessionCookie(adminClaim);
  const adminOnboarding = await request(app).get('/api/me/onboarding').set('Cookie', adminCookie);
  assert.equal(adminOnboarding.status, 200, JSON.stringify(adminOnboarding.body));
  assert.equal(adminOnboarding.body.status, 'pending');

  const memberInvite = createInvite({ purpose: 'register', createdBy: adminId });
  const memberRegister = await request(app).post('/api/auth/register').send({
    code: memberInvite.code,
    name: 'Onboarding Member',
    password: 'member password',
  });
  assert.equal(memberRegister.status, 201, JSON.stringify(memberRegister.body));
  const memberCookie = sessionCookie(memberRegister);

  const initial = await request(app).get('/api/me/onboarding').set('Cookie', memberCookie);
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.status, 'pending');
  assert.equal(initial.body.ratingStatus, 'pending');

  const tooManyViews = await request(app)
    .put('/api/me/onboarding')
    .set('Cookie', memberCookie)
    .send({ seenViews: Array.from({ length: 21 }, (_, index) => `view-${index}`) });
  assert.equal(tooManyViews.status, 400);

  const bypassAttempt = await request(app)
    .put('/api/me/onboarding')
    .set('Cookie', memberCookie)
    .send({ status: 'completed', ratingStatus: 'completed' });
  assert.equal(bypassAttempt.status, 400);

  const completedWithoutRatings = await request(app)
    .post('/api/me/onboarding/complete')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(completedWithoutRatings.status, 200, JSON.stringify(completedWithoutRatings.body));
  assert.equal(completedWithoutRatings.body.status, 'completed');
  assert.equal(completedWithoutRatings.body.lastCoreStep, 7);
  assert.equal(completedWithoutRatings.body.ratingStatus, 'completed');
  assert.deepEqual(completedWithoutRatings.body.ratingCandidateIds, []);

  const resetForLegacyRatingCoverage = await request(app)
    .put('/api/me/onboarding')
    .set('Cookie', memberCookie)
    .send({ status: 'pending', lastCoreStep: 0, ratingStatus: 'pending' });
  assert.equal(resetForLegacyRatingCoverage.status, 200, JSON.stringify(resetForLegacyRatingCoverage.body));

  const games: Array<{ id: string; name: string }> = [];
  for (let index = 0; index < 12; index += 1) {
    const created = await request(app)
      .post('/api/games')
      .set('Cookie', adminCookie)
      .send({ name: `Onboarding Game ${String(index).padStart(2, '0')}` });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    games.push({ id: created.body.id, name: created.body.name });
    const preference = await request(app)
      .put('/api/preferences')
      .set('Cookie', adminCookie)
      .send({ playerId: adminId, gameId: created.body.id, rating: index < 10 ? 5 : 0 }); // ties rank by name's number
    assert.equal(preference.status, 200, JSON.stringify(preference.body));
  }

  const testPlayerId = nanoid();
  const defaultGroupId = (db.prepare('SELECT id FROM groups ORDER BY id LIMIT 1').get() as { id: string }).id;
  db.prepare('INSERT INTO players (id, name, api_key, is_test, created_at) VALUES (?, ?, ?, 1, ?)').run(
    testPlayerId,
    'Onboarding Test Player',
    nanoid(24),
    Date.now(),
  );
  db.prepare('INSERT INTO preferences (player_id, game_id, group_id, rating) VALUES (?, ?, ?, ?)').run(
    testPlayerId,
    games[11].id,
    defaultGroupId,
    5,
  );

  const started = await request(app)
    .post('/api/me/onboarding/rating/start')
    .set('Cookie', memberCookie)
    .send({ includeAll: false });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.ratingStatus, 'active');
  assert.deepEqual(started.body.ratingCandidateIds, games.slice(0, 10).map((game) => game.id));

  const deferred = await request(app)
    .post('/api/me/onboarding/rating/defer')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(deferred.status, 200, JSON.stringify(deferred.body));
  assert.equal(deferred.body.ratingStatus, 'deferred');

  const resumed = await request(app)
    .post('/api/me/onboarding/rating/start')
    .set('Cookie', memberCookie)
    .send({ includeAll: false });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.ratingStatus, 'active');

  const incomplete = await request(app)
    .post('/api/me/onboarding/rating/complete')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.body.code, 'onboarding_ratings_incomplete');
  assert.equal(incomplete.body.missingGameIds.length, 10);

  const demoted = await request(app)
    .post(`/api/games/${games[0].id}/demote`)
    .set('Cookie', adminCookie)
    .send();
  assert.equal(demoted.status, 200, JSON.stringify(demoted.body));

  for (const game of games.slice(1, 10)) {
    const skill = await request(app)
      .put('/api/skills')
      .set('Cookie', memberCookie)
      .send({ playerId: memberRegister.body.id, gameId: game.id, rating: 5 });
    assert.equal(skill.status, 200, JSON.stringify(skill.body));
  }

  const replacementRequired = await request(app)
    .post('/api/me/onboarding/rating/complete')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(replacementRequired.status, 409, JSON.stringify(replacementRequired.body));
  assert.deepEqual(replacementRequired.body.missingGameIds, [games[10].id]);

  const rating = await request(app)
    .put('/api/skills')
    .set('Cookie', memberCookie)
    .send({ playerId: memberRegister.body.id, gameId: games[10].id, rating: 0 });
  assert.equal(rating.status, 200, JSON.stringify(rating.body));

  const completed = await request(app)
    .post('/api/me/onboarding/rating/complete')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.ratingStatus, 'completed');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM preferences WHERE player_id = ?').get(memberRegister.body.id) as { count: number }).count, 0,
    'Skill alone completes the optional rating round; Bock is not required');

  const all = await request(app)
    .post('/api/me/onboarding/rating/start')
    .set('Cookie', memberCookie)
    .send({ includeAll: true });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const catalog = await request(app).get('/api/games').set('Cookie', memberCookie);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
  assert.equal(all.body.ratingCandidateIds.length, catalog.body.filter((game: { isSuggestion: boolean }) => !game.isSuggestion).length);
  assert.deepEqual(all.body.ratingCandidateIds.slice(0, 10), games.slice(1, 11).map((game) => game.id));
});

test('every account sees the welcome trailer once, only when the operator provided the file', async () => {
  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    'Trailer Veteran',
    nanoid(24),
    Date.now(),
  );
  ensureDefaultGroupMembership(playerId);
  const claimInvite = createInvite({ purpose: 'claim', playerId, createdBy: playerId });
  const claim = await request(app).post('/api/auth/claim').send({ code: claimInvite.code, password: 'veteran password' });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const cookie = sessionCookie(claim);
  // An existing account that already finished the tour still owes the trailer.
  await request(app).post('/api/me/onboarding/complete').set('Cookie', cookie).expect(200);

  assert.equal((await request(app).get('/api/me/onboarding/trailer')).status, 401);
  const previousDir = mutableConfig.welcomeTrailerDir;
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-trailer-'));
  try {
    mutableConfig.welcomeTrailerDir = mediaDir;
    const missing = await request(app).get('/api/me/onboarding/trailer').set('Cookie', cookie);
    assert.deepEqual(missing.body, { available: false, hasPoster: false, seen: false });
    assert.equal((await request(app).get('/api/me/onboarding/trailer/video').set('Cookie', cookie)).status, 404);

    fs.writeFileSync(path.join(mediaDir, 'welcome-trailer.mp4'), Buffer.alloc(1000, 7));
    const offered = await request(app).get('/api/me/onboarding/trailer').set('Cookie', cookie);
    assert.deepEqual(offered.body, { available: true, hasPoster: false, seen: false });
    assert.equal((await request(app).get('/api/me/onboarding/trailer/video')).status, 401);
    const partial = await request(app).get('/api/me/onboarding/trailer/video').set('Cookie', cookie).set('Range', 'bytes=0-99');
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['content-range'], 'bytes 0-99/1000');
    assert.match(partial.headers['content-type'], /^video\/mp4/);
    assert.equal((await request(app).get('/api/me/onboarding/trailer/poster').set('Cookie', cookie)).status, 404);

    // Closing on two devices at once is harmless: both succeed and the first
    // stored time survives a later close.
    const closes = await Promise.all([
      request(app).post('/api/me/onboarding/trailer/seen').set('Cookie', cookie),
      request(app).post('/api/me/onboarding/trailer/seen').set('Cookie', cookie),
    ]);
    for (const response of closes) {
      assert.equal(response.status, 200);
      assert.equal(response.body.seen, true);
    }
    const seenAt = () => (db.prepare('SELECT welcome_trailer_seen_at AS seenAt FROM players WHERE id = ?').get(playerId) as { seenAt: number }).seenAt;
    const firstSeenAt = seenAt();
    await request(app).post('/api/me/onboarding/trailer/seen').set('Cookie', cookie).expect(200);
    assert.equal(seenAt(), firstSeenAt);
    assert.equal((await request(app).get('/api/me/onboarding/trailer').set('Cookie', cookie)).body.seen, true);

    // Test players never get the trailer in the way of an admin's test session.
    db.prepare('UPDATE players SET welcome_trailer_seen_at = NULL, is_test = 1 WHERE id = ?').run(playerId);
    assert.equal((await request(app).get('/api/me/onboarding/trailer').set('Cookie', cookie)).body.seen, true);
  } finally {
    mutableConfig.welcomeTrailerDir = previousDir;
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// A minimal MP4 header ("ftyp" at byte 4) followed by filler bytes.
function fakeMp4(fill: number, length = 64 * 1024): Buffer {
  const body = Buffer.alloc(length, fill);
  Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(body);
  return body;
}

async function claimAccount(name: string, { admin = false } = {}): Promise<{ id: string; cookie: string }> {
  const id = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    nanoid(24),
    admin ? 1 : 0,
    Date.now(),
  );
  ensureDefaultGroupMembership(id, { bootstrapAdmin: admin });
  const invite = createInvite({ purpose: 'claim', playerId: id, createdBy: id });
  const claim = await request(app).post('/api/auth/claim').send({ code: invite.code, password: `${name} password` });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  return { id, cookie: sessionCookie(claim) };
}

test('admins manage the welcome trailer in the app: upload, switch, show again, remove', async () => {
  const admin = await claimAccount('Trailer Admin', { admin: true });
  const member = await claimAccount('Trailer Member');
  const previousDir = mutableConfig.welcomeTrailerDir;
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-trailer-admin-'));
  const upload = (asset: string, body: Buffer, type: string) =>
    request(app).put(`/api/admin/welcome-trailer/${asset}`).set('Cookie', admin.cookie).set('Content-Type', type).send(body);
  try {
    mutableConfig.welcomeTrailerDir = mediaDir;
    assert.equal((await request(app).get('/api/admin/welcome-trailer').set('Cookie', member.cookie)).status, 403);
    assert.equal(
      (await request(app).put('/api/admin/welcome-trailer/video').set('Cookie', member.cookie)
        .set('Content-Type', 'video/mp4').send(fakeMp4(1))).status,
      403,
    );

    // A large upload asks for the password before the file is sent.
    const check = await request(app).post('/api/admin/welcome-trailer/upload-check').set('Cookie', admin.cookie);
    assert.equal(check.body.code, 'reauth_required');
    assert.equal((await upload('video', fakeMp4(1), 'video/mp4')).body.code, 'reauth_required');
    await request(app).post('/api/auth/reauth').set('Cookie', admin.cookie)
      .send({ password: 'Trailer Admin password' }).expect(204);
    await request(app).post('/api/admin/welcome-trailer/upload-check').set('Cookie', admin.cookie).expect(204);

    assert.equal((await upload('video', fakeMp4(1), 'application/octet-stream')).status, 415);
    const notMp4 = await upload('video', Buffer.from('definitely not a video'), 'video/mp4');
    assert.equal(notMp4.status, 400);
    assert.equal((await upload('video', Buffer.alloc(0), 'video/mp4')).status, 400);
    assert.deepEqual(fs.readdirSync(mediaDir), [], 'a rejected upload leaves nothing behind');

    // Two admins replacing the video at once both succeed; the live file is
    // always one complete upload, never a mix, and no temporary file stays.
    const first = fakeMp4(1);
    const second = fakeMp4(2);
    const [a, b] = await Promise.all([upload('video', first, 'video/mp4'), upload('video', second, 'video/mp4')]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const stored = fs.readFileSync(path.join(mediaDir, 'welcome-trailer.mp4'));
    assert.ok(stored.equals(first) || stored.equals(second));
    assert.deepEqual(fs.readdirSync(mediaDir), ['welcome-trailer.mp4']);

    assert.equal((await upload('poster', Buffer.from('not a jpeg'), 'image/jpeg')).status, 400);
    const poster = await upload('poster', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg');
    assert.equal(poster.status, 200);
    assert.equal(poster.body.poster.size, 7);
    assert.equal(poster.body.video.size, 64 * 1024);
    assert.equal(poster.body.enabled, true);

    const memberTrailer = () => request(app).get('/api/me/onboarding/trailer').set('Cookie', member.cookie);
    assert.deepEqual((await memberTrailer()).body, { available: true, hasPoster: true, seen: false });

    // Switched off, nobody is asked; the video stays available for previews.
    const off = await request(app).put('/api/admin/welcome-trailer/settings').set('Cookie', admin.cookie).send({ enabled: false });
    assert.equal(off.body.enabled, false);
    assert.equal((await memberTrailer()).body.available, false);
    assert.equal((await request(app).get('/api/me/onboarding/trailer/video').set('Cookie', admin.cookie)).status, 200);
    assert.equal(
      (await request(app).put('/api/admin/welcome-trailer/settings').set('Cookie', admin.cookie).send({ enabled: 'no' })).status,
      400,
    );
    await request(app).put('/api/admin/welcome-trailer/settings').set('Cookie', admin.cookie).send({ enabled: true }).expect(200);

    await request(app).post('/api/me/onboarding/trailer/seen').set('Cookie', member.cookie).expect(200);
    const counted = await request(app).get('/api/admin/welcome-trailer').set('Cookie', admin.cookie);
    assert.ok(counted.body.seenCount >= 1);
    const reset = await request(app).post('/api/admin/welcome-trailer/seen/reset').set('Cookie', admin.cookie);
    assert.equal(reset.status, 200);
    assert.ok(reset.body.reset >= 1);
    assert.equal(reset.body.seenCount, 0);
    assert.equal((await memberTrailer()).body.seen, false);

    const removed = await request(app).delete('/api/admin/welcome-trailer').set('Cookie', admin.cookie);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.video, null);
    assert.equal(removed.body.poster, null);
    assert.deepEqual(fs.readdirSync(mediaDir), []);
    assert.equal((await memberTrailer()).body.available, false);
  } finally {
    mutableConfig.welcomeTrailerDir = previousDir;
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test('without a media folder the trailer admin explains instead of failing', async () => {
  const admin = await claimAccount('Storage Admin', { admin: true });
  const previousDir = mutableConfig.welcomeTrailerDir;
  try {
    mutableConfig.welcomeTrailerDir = '';
    await request(app).post('/api/auth/reauth').set('Cookie', admin.cookie)
      .send({ password: 'Storage Admin password' }).expect(204);
    const status = await request(app).get('/api/admin/welcome-trailer').set('Cookie', admin.cookie);
    assert.equal(status.body.storage, false);
    const upload = await request(app).put('/api/admin/welcome-trailer/video').set('Cookie', admin.cookie)
      .set('Content-Type', 'video/mp4').send(fakeMp4(3));
    assert.equal(upload.status, 409);
  } finally {
    mutableConfig.welcomeTrailerDir = previousDir;
  }
});
