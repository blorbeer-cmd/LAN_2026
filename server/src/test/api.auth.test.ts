// Integration tests for the new /api/auth/* + /api/me endpoints, run against
// the real Express app and an in-memory DB. Tests build on each other in
// sequence, same as the rest of this suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { createInvite, findValidInvite, inviteFingerprint } from '../invites';
import { SESSION_COOKIE_NAME } from '../sessions';
import { db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { nanoid } from 'nanoid';

const app = createApp();

function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(cookie, 'response should set a session cookie');
  return cookie!.split(';')[0];
}

// --- bootstrap: get one admin account onto the board without the
// recovery-code path (that's covered separately in api.auth.recovery.test.ts) ---

let adminId: string;
let adminCookie: string;

test('setup: seed an unclaimed admin player and claim it via a claim invite', async () => {
  adminId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, is_admin, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(adminId, 'Auth Admin', nanoid(24), Date.now());
  ensureDefaultGroupMembership(adminId, { bootstrapAdmin: true });

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
  const player = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Plain Member' });
  const invite = createInvite({ purpose: 'claim', playerId: player.body.id, createdBy: adminId });
  const claimed = await request(app).post('/api/auth/claim').send({ code: invite.code, password: 'member password' });
  const memberCookie = sessionCookie(claimed);

  const res = await request(app).post('/api/auth/invites').set('Cookie', memberCookie).send({ purpose: 'register' });
  assert.equal(res.status, 403);
});

test('POST /api/auth/invites requires recent admin reauthentication', async () => {
  const blocked = await request(app).post('/api/auth/invites').set('Cookie', adminCookie).send({ purpose: 'register' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'reauth_required');

  const reauthenticated = await request(app)
    .post('/api/auth/reauth')
    .set('Cookie', adminCookie)
    .send({ password: 'admin password one' });
  assert.equal(reauthenticated.status, 204);
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

test('GET /api/auth/invites lists active reusable codes without exposing revoked history', async () => {
  const res = await request(app).get('/api/auth/invites').set('Cookie', adminCookie);
  assert.equal(res.status, 200);
  const listed = res.body.find((invite: { code: string }) => invite.code === registerCode);
  assert.equal(listed.purpose, 'register');
  assert.equal(listed.playerId, null);
  assert.equal(listed.expiresAt, null);
  assert.equal(listed.reusable, true);
  assert.equal(listed.usageCount, 0);
});

test('POST /api/auth/invites rejects a non-expiring code', async () => {
  const res = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'register', expiresInMs: 0 });
  assert.equal(res.status, 400);
});

test('POST /api/auth/invites keeps explicitly finite register links one-time at the API boundary', async () => {
  const created = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'register', expiresInMs: 60_000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.reusable, false);
  assert.ok(created.body.expiresAt > Date.now());

  const first = await request(app)
    .post('/api/auth/register')
    .send({ code: created.body.code, name: 'Finite Person', password: 'finite person password' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await request(app)
    .post('/api/auth/register')
    .send({ code: created.body.code, name: 'Second Finite', password: 'second finite password' });
  assert.equal(second.status, 400);

  const active = await request(app).get('/api/auth/invites').set('Cookie', adminCookie);
  assert.equal(active.body.some((invite: { code: string }) => invite.code === created.body.code), false);
});

// --- register ---

test('POST /api/auth/register rejects an empty password', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: registerCode, name: 'New Person', password: '' });
  assert.equal(res.status, 400);
});

let newPersonCookie: string;
let newPersonId: string;
let anotherPersonId: string;

test('POST /api/auth/register creates a non-admin player and logs it in', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: registerCode, name: 'New Person', password: 'new person password' });
  assert.equal(res.status, 201);
  assert.equal(res.body.isAdmin, false);
  assert.equal(res.body.name, 'New Person');
  newPersonId = res.body.id;
  newPersonCookie = sessionCookie(res);

  const active = await request(app).get('/api/auth/invites').set('Cookie', adminCookie);
  assert.equal(active.body.some((invite: { code: string }) => invite.code === registerCode), true);
});

test('the register code can be reused for another new account', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: registerCode, name: 'Another Person', password: 'another persons password' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  anotherPersonId = res.body.id;

  const auditRows = db
    .prepare(
      "SELECT target_id AS targetId, details FROM admin_log WHERE action = 'invite_used' AND target_type = 'registration' AND target_id IN (?, ?)",
    )
    .all(newPersonId, anotherPersonId) as Array<{ targetId: string; details: string }>;
  assert.equal(auditRows.length, 2);
  assert.ok(auditRows.every((row) => typeof JSON.parse(row.details).inviteFingerprint === 'string'));

  const active = await request(app).get('/api/auth/invites').set('Cookie', adminCookie);
  const listed = active.body.find((invite: { code: string }) => invite.code === registerCode);
  assert.equal(listed.usageCount, 2);
});

test('invite lifecycle audit stays correlated in the instance audit feed', async () => {
  const created = await request(app).post('/api/auth/invites').set('Cookie', adminCookie).send({ purpose: 'register' });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const first = await request(app)
    .post('/api/auth/register')
    .send({ code: created.body.code, name: 'Audit First Person', password: 'audit first password' });
  const second = await request(app)
    .post('/api/auth/register')
    .send({ code: created.body.code, name: 'Audit Second Person', password: 'audit second password' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const revoked = await request(app).delete(`/api/auth/invites/${created.body.code}`).set('Cookie', adminCookie);
  assert.equal(revoked.status, 204);

  const fingerprint = inviteFingerprint(created.body.code);
  const rows = db
    .prepare(
      "SELECT action, group_id AS groupId, target_id AS targetId, details FROM admin_log WHERE action IN ('invite_created', 'invite_used', 'invite_revoked')",
    )
    .all() as Array<{ action: string; groupId: string | null; targetId: string | null; details: string }>;
  const matching = rows.filter((row) => JSON.parse(row.details).inviteFingerprint === fingerprint);
  assert.deepEqual(
    matching.map((row) => row.action),
    ['invite_created', 'invite_used', 'invite_used', 'invite_revoked'],
  );
  assert.ok(matching.every((row) => row.groupId === null));
  assert.deepEqual(
    matching
      .filter((row) => row.action === 'invite_used')
      .map((row) => row.targetId)
      .sort(),
    [first.body.id, second.body.id].sort(),
  );
  assert.equal(JSON.parse(matching[0].details).expiresAt, null);
  assert.equal(JSON.parse(matching[3].details).usageCount, 2);

  const audit = await request(app).get('/api/admin/audit?limit=500').set('Cookie', adminCookie);
  assert.equal(audit.status, 200);
  assert.equal(
    audit.body.filter((entry: { details: string | null }) => JSON.parse(entry.details ?? '{}').inviteFingerprint === fingerprint)
      .length,
    4,
  );
});

test('registering with an already-taken name is rejected', async () => {
  const invite = createInvite({ purpose: 'register', createdBy: adminId });
  const res = await request(app)
    .post('/api/auth/register')
    .send({ code: invite.code, name: 'new person', password: 'yet another password' });
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

// --- password reset ---

test('password reset consumes one code, revokes sibling codes, invalidates old sessions and logs this device in', async () => {
  const oldSession = await request(app)
    .post('/api/auth/login')
    .send({ name: 'New Person', password: 'brand new password' });
  const oldCookie = sessionCookie(oldSession);

  const resetA = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'reset', playerId: newPersonId });
  const resetB = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'reset', playerId: newPersonId });
  assert.equal(resetA.status, 201);
  assert.equal(resetB.status, 201);

  const reset = await request(app)
    .post('/api/auth/reset')
    .send({ code: resetA.body.code, newPassword: 'password after reset' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.id, newPersonId);
  const resetCookie = sessionCookie(reset);

  assert.equal((await request(app).get('/api/me').set('Cookie', oldCookie)).status, 401);
  assert.equal((await request(app).get('/api/me').set('Cookie', newPersonCookie)).status, 401);
  assert.equal((await request(app).get('/api/me').set('Cookie', resetCookie)).status, 200);

  const reused = await request(app)
    .post('/api/auth/reset')
    .send({ code: resetA.body.code, newPassword: 'should never be accepted' });
  assert.equal(reused.status, 400);
  const sibling = await request(app)
    .post('/api/auth/reset')
    .send({ code: resetB.body.code, newPassword: 'should also be rejected' });
  assert.equal(sibling.status, 400);

  assert.equal(
    (await request(app).post('/api/auth/login').send({ name: 'New Person', password: 'brand new password' })).status,
    401
  );
  assert.equal(
    (await request(app).post('/api/auth/login').send({ name: 'New Person', password: 'password after reset' })).status,
    200
  );
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

// --- test-player sessions ("Testsitzung öffnen") ---

test('POST /api/auth/invites rejects purpose "test_login" for a real (non-test) player', async () => {
  const real = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Real Not Test Player' });
  const res = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'test_login', playerId: real.body.id });
  assert.equal(res.status, 409);
});

test('a full test-session round trip: mint as admin, redeem once, then the code is dead', async () => {
  const testPlayer = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Seeded Test Player' });
  db.prepare('UPDATE players SET is_test = 1 WHERE id = ?').run(testPlayer.body.id);

  const minted = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'test_login', playerId: testPlayer.body.id });
  assert.equal(minted.status, 201, JSON.stringify(minted.body));
  assert.equal(minted.body.purpose, 'test_login');
  assert.ok(minted.body.expiresAt < Date.now() + 20 * 60 * 1000, 'test-session codes should be short-lived');

  const badCode = await request(app).post('/api/auth/test-session').send({ code: 'not-a-real-code' });
  assert.equal(badCode.status, 400);

  const redeemed = await request(app).post('/api/auth/test-session').send({ code: minted.body.code });
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
  assert.equal(redeemed.body.id, testPlayer.body.id);
  assert.equal(redeemed.body.isTest, true);
  const testPlayerCookie = sessionCookie(redeemed);

  const me = await request(app).get('/api/me').set('Cookie', testPlayerCookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.id, testPlayer.body.id);

  const reused = await request(app).post('/api/auth/test-session').send({ code: minted.body.code });
  assert.equal(reused.status, 400);
});

test('a test-session code stops working if the player loses its is_test marking before redemption', async () => {
  const testPlayer = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Unmarked Before Redeem' });
  db.prepare('UPDATE players SET is_test = 1 WHERE id = ?').run(testPlayer.body.id);

  const minted = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'test_login', playerId: testPlayer.body.id });
  assert.equal(minted.status, 201);

  db.prepare('UPDATE players SET is_test = 0 WHERE id = ?').run(testPlayer.body.id);

  const redeemed = await request(app).post('/api/auth/test-session').send({ code: minted.body.code });
  assert.equal(redeemed.status, 409);
});

test('a test-session code stops working if the player is deactivated before redemption', async () => {
  const testPlayer = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Deactivated Before Redeem' });
  db.prepare('UPDATE players SET is_test = 1 WHERE id = ?').run(testPlayer.body.id);

  const minted = await request(app)
    .post('/api/auth/invites')
    .set('Cookie', adminCookie)
    .send({ purpose: 'test_login', playerId: testPlayer.body.id });
  assert.equal(minted.status, 201);

  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), testPlayer.body.id);

  const redeemed = await request(app).post('/api/auth/test-session').send({ code: minted.body.code });
  assert.equal(redeemed.status, 409);
});

test('registered players and invite creators remain deletable', async () => {
  const creator = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Disposable Invite Creator' });
  const invite = createInvite({ purpose: 'register', createdBy: creator.body.id });
  const registered = await request(app)
    .post('/api/auth/register')
    .send({ code: invite.code, name: 'Disposable Registered Player', password: 'disposable password' });
  assert.equal(registered.status, 201);

  // Hard-delete remains available for disposable/test identities, which also
  // pins the invite audit foreign-key behavior this test targets.
  db.prepare('UPDATE players SET is_test = 1 WHERE id IN (?, ?)').run(creator.body.id, registered.body.id);

  assert.equal((await request(app).delete(`/api/players/${creator.body.id}`).set('Cookie', adminCookie)).status, 204);
  assert.equal((await request(app).delete(`/api/players/${registered.body.id}`).set('Cookie', adminCookie)).status, 204);
});

test('deactivating or deleting a creator revokes its open registration links', async () => {
  const creator = await request(app).post('/api/players').set('Cookie', adminCookie).send({ name: 'Registration Link Creator' });
  assert.equal(creator.status, 201, JSON.stringify(creator.body));
  const invite = createInvite({ purpose: 'register', createdBy: creator.body.id });
  assert.ok(findValidInvite(invite.code, 'register'));

  const deactivated = await request(app)
    .post(`/api/players/${creator.body.id}/deactivate`)
    .set('Cookie', adminCookie);
  assert.equal(deactivated.status, 204);
  assert.equal(findValidInvite(invite.code, 'register'), undefined);
  const active = await request(app).get('/api/auth/invites').set('Cookie', adminCookie);
  assert.equal(active.body.some((entry: { code: string }) => entry.code === invite.code), false);

  const deletedCreator = await request(app)
    .post('/api/players')
    .set('Cookie', adminCookie)
    .send({ name: 'Deleted Link Creator' });
  assert.equal(deletedCreator.status, 201, JSON.stringify(deletedCreator.body));
  const deletedInvite = createInvite({ purpose: 'register', createdBy: deletedCreator.body.id });
  assert.ok(findValidInvite(deletedInvite.code, 'register'));
  const deleted = await request(app)
    .delete(`/api/players/${deletedCreator.body.id}`)
    .set('Cookie', adminCookie);
  assert.equal(deleted.status, 204);
  assert.equal(findValidInvite(deletedInvite.code, 'register'), undefined);
});
