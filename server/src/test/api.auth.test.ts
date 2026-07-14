// Integration tests for the new /api/auth/* + /api/me endpoints, run against
// the real Express app and an in-memory DB. Nothing here is wired into any
// existing route yet (see config.authMode), so these tests only exercise the
// new surface in isolation. Tests build on each other in sequence, same as
// the rest of this suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { createInvite } from '../invites';

const app = createApp();

function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('lan2026_session='));
  assert.ok(cookie, 'response should set a session cookie');
  return cookie!.split(';')[0];
}

// --- bootstrap: get one admin account onto the board without the
// recovery-code path (that's covered separately in api.auth.recovery.test.ts) ---

let adminId: string;
let adminCookie: string;

test('setup: seed an unclaimed admin player and claim it via a claim invite', async () => {
  const created = await request(app).post('/api/players').send({ name: 'Auth Admin' });
  assert.equal(created.status, 201);
  adminId = created.body.id;
  const promoted = await request(app).patch(`/api/players/${adminId}`).send({ isAdmin: true });
  assert.equal(promoted.status, 200);

  const invite = createInvite({ purpose: 'claim', playerId: adminId, createdBy: adminId });
  const claimed = await request(app).post('/api/auth/claim').send({ code: invite.code, password: 'admin password one' });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.isAdmin, true);
  adminCookie = sessionCookie(claimed);
});

test('GET /api/me without a cookie is rejected', async () => {
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 401);
});

test('GET /api/me with the claimed session returns the admin account', async () => {
  const res = await request(app).get('/api/me').set('Cookie', adminCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, adminId);
  assert.equal(res.body.isAdmin, true);
});

test('claiming the same player a second time is rejected (already claimed)', async () => {
  const invite = createInvite({ purpose: 'claim', playerId: adminId, createdBy: adminId });
  const res = await request(app).post('/api/auth/claim').send({ code: invite.code, password: 'another password' });
  assert.equal(res.status, 409);
});

// --- invite issuance is admin-only ---

test('POST /api/auth/invites is rejected without a session', async () => {
  const res = await request(app).post('/api/auth/invites').send({ purpose: 'register' });
  assert.equal(res.status, 401);
});

test('POST /api/auth/invites is rejected for a non-admin session', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Plain Member' });
  const invite = createInvite({ purpose: 'claim', playerId: player.body.id, createdBy: adminId });
  const claimed = await request(app).post('/api/auth/claim').send({ code: invite.code, password: 'member password' });
  const memberCookie = sessionCookie(claimed);

  const res = await request(app).post('/api/auth/invites').set('Cookie', memberCookie).send({ purpose: 'register' });
  assert.equal(res.status, 403);
});

test('POST /api/auth/invites rejects playerId for purpose "register"', async () => {
  const res = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'register', playerId: adminId });
  assert.equal(res.status, 400);
});

let registerCode: string;

test('POST /api/auth/invites creates a register code as admin', async () => {
  const res = await request(app).post('/api/auth/invites').set('Cookie', adminCookie).send({ purpose: 'register' });
  assert.equal(res.status, 201);
  assert.equal(res.body.purpose, 'register');
  assert.ok(res.body.code);
  registerCode = res.body.code;
});

// --- register ---

test('POST /api/auth/register rejects a short password', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: registerCode, name: 'New Person', password: 'short' });
  assert.equal(res.status, 400);
});

let newPersonCookie: string;

test('POST /api/auth/register creates a non-admin player and logs it in', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: registerCode, name: 'New Person', password: 'new person password' });
  assert.equal(res.status, 201);
  assert.equal(res.body.isAdmin, false);
  assert.equal(res.body.name, 'New Person');
  newPersonCookie = sessionCookie(res);
});

test('the register code cannot be reused', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: registerCode, name: 'Another Person', password: 'another persons password' });
  assert.equal(res.status, 400);
});

test('registering with an already-taken name is rejected', async () => {
  const invite = createInvite({ purpose: 'register', createdBy: adminId });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: invite.code, name: 'New Person', password: 'yet another password' });
  assert.equal(res.status, 409);
});

// --- login / logout ---

test('login with a wrong password is rejected generically', async () => {
  const res = await request(app).post('/api/auth/login').send({ name: 'New Person', password: 'nope' });
  assert.equal(res.status, 401);
});

test('login with an unknown name gets the same generic rejection', async () => {
  const res = await request(app).post('/api/auth/login').send({ name: 'Nobody Here', password: 'whatever' });
  assert.equal(res.status, 401);
});

test('login with the right (case-insensitive) name and password succeeds', async () => {
  const res = await request(app).post('/api/auth/login').send({ name: 'new PERSON', password: 'new person password' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'New Person');
  assert.ok(sessionCookie(res));
});

test('logout invalidates the session cookie', async () => {
  const login = await request(app).post('/api/auth/login').send({ name: 'New Person', password: 'new person password' });
  const cookie = sessionCookie(login);

  const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
  assert.equal(logout.status, 204);

  const me = await request(app).get('/api/me').set('Cookie', cookie);
  assert.equal(me.status, 401);
});

// --- password change ---

test('password change with the wrong current password is rejected', async () => {
  const res = await request(app)
    .post('/api/auth/password')
    .set('Cookie', newPersonCookie)
    .send({ currentPassword: 'nope', newPassword: 'brand new password' });
  assert.equal(res.status, 401);
});

test('password change invalidates every OTHER session but keeps the current one', async () => {
  const otherLogin = await request(app)
    .post('/api/auth/login')
    .send({ name: 'New Person', password: 'new person password' });
  const otherCookie = sessionCookie(otherLogin);

  const change = await request(app)
    .post('/api/auth/password')
    .set('Cookie', newPersonCookie)
    .send({ currentPassword: 'new person password', newPassword: 'brand new password' });
  assert.equal(change.status, 204);

  const meWithChangingSession = await request(app).get('/api/me').set('Cookie', newPersonCookie);
  assert.equal(meWithChangingSession.status, 200, 'the session that made the change should still be valid');

  const meWithOtherSession = await request(app).get('/api/me').set('Cookie', otherCookie);
  assert.equal(meWithOtherSession.status, 401, 'every other session should have been invalidated');

  const loginWithOldPassword = await request(app)
    .post('/api/auth/login')
    .send({ name: 'New Person', password: 'new person password' });
  assert.equal(loginWithOldPassword.status, 401);

  const loginWithNewPassword = await request(app)
    .post('/api/auth/login')
    .send({ name: 'New Person', password: 'brand new password' });
  assert.equal(loginWithNewPassword.status, 200);
});

// --- invite revocation ---

test('a revoked invite can no longer be consumed', async () => {
  const created = await request(app).post('/api/auth/invites').set('Cookie', adminCookie).send({ purpose: 'register' });
  const revoke = await request(app).delete(`/api/auth/invites/${created.body.code}`).set('Cookie', adminCookie);
  assert.equal(revoke.status, 204);

  const register = await request(app)
    .post('/api/auth/register')
    .send({ code: created.body.code, name: 'Should Not Exist', password: 'irrelevant password' });
  assert.equal(register.status, 400);
});

test('revoking a nonexistent invite code 404s', async () => {
  const res = await request(app).delete('/api/auth/invites/not-a-real-code').set('Cookie', adminCookie);
  assert.equal(res.status, 404);
});
