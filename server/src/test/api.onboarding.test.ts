import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { createInvite } from '../invites';
import { SESSION_COOKIE_NAME } from '../sessions';
import { db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { nanoid } from 'nanoid';

const app = createApp();

function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(cookie, 'response should set a session cookie');
  return cookie!.split(';')[0];
}

test('new accounts receive onboarding and must complete the first ten catalog ratings', async () => {
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
      .send({ playerId: adminId, gameId: created.body.id, rating: index < 10 ? 10 - index : 1 });
    assert.equal(preference.status, 200, JSON.stringify(preference.body));
  }

  const started = await request(app)
    .post('/api/me/onboarding/rating/start')
    .set('Cookie', memberCookie)
    .send({ includeAll: false });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.ratingStatus, 'active');
  assert.deepEqual(started.body.ratingCandidateIds, games.slice(0, 10).map((game) => game.id));

  const incomplete = await request(app)
    .post('/api/me/onboarding/rating/complete')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.body.code, 'onboarding_ratings_incomplete');
  assert.equal(incomplete.body.missingGameIds.length, 10);

  for (const game of games.slice(0, 10)) {
    const bock = await request(app)
      .put('/api/preferences')
      .set('Cookie', memberCookie)
      .send({ playerId: memberRegister.body.id, gameId: game.id, rating: 5 });
    assert.equal(bock.status, 200, JSON.stringify(bock.body));
    const skill = await request(app)
      .put('/api/skills')
      .set('Cookie', memberCookie)
      .send({ playerId: memberRegister.body.id, gameId: game.id, rating: 5 });
    assert.equal(skill.status, 200, JSON.stringify(skill.body));
  }

  const completed = await request(app)
    .post('/api/me/onboarding/rating/complete')
    .set('Cookie', memberCookie)
    .send();
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.ratingStatus, 'completed');

  const all = await request(app)
    .post('/api/me/onboarding/rating/start')
    .set('Cookie', memberCookie)
    .send({ includeAll: true });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const catalog = await request(app).get('/api/games').set('Cookie', memberCookie);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
  assert.equal(all.body.ratingCandidateIds.length, catalog.body.length);
  assert.deepEqual(all.body.ratingCandidateIds.slice(0, 10), games.slice(0, 10).map((game) => game.id));
});
