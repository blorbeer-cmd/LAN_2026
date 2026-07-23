// AUTH_MODE is read at module import time, so the required-mode security
// boundary is exercised in a child process with the environment configured
// before app.ts and its routers load.

import { test } from 'node:test';
import { execFileSync } from 'child_process';
import path from 'path';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'required-mode-recovery-code';

test('required auth binds personal APIs to the session and protects API keys', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }

    (async () => {
      const app = createApp();
      const meta = await request(app).get('/api/meta');
      assert.equal(meta.status, 200);
      assert.equal(meta.body.accessProtection, false);
      assert.equal(meta.body.kioskProtection, true);
      const kioskRead = await request(app)
        .get('/api/live')
        .set('x-kiosk-mode', '1')
        .set('x-access-token', 'required-kiosk-token');
      assert.equal(kioskRead.status, 200, JSON.stringify(kioskRead.body));
      const kioskMutation = await request(app)
        .post('/api/games')
        .set('x-kiosk-mode', '1')
        .set('x-access-token', 'required-kiosk-token')
        .send({ name: 'Kiosk must not create' });
      assert.equal(kioskMutation.status, 401);
      assert.equal(
        (await request(app).post('/api/auth/login').send({ name: 'x'.repeat(61), password: 'password' })).status,
        400
      );
      assert.equal(
        (await request(app).post('/api/auth/login').send({ name: 'bounded', password: 'x'.repeat(201) })).status,
        400
      );
      const admin = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Required Admin',
        password: 'required admin password',
      });
      assert.equal(admin.status, 201, JSON.stringify(admin.body));
      const adminCookie = cookie(admin);
      const inviteAdminLogin = await request(app).post('/api/auth/login').send({
        name: 'Required Admin',
        password: 'required admin password',
      });
      assert.equal(inviteAdminLogin.status, 200);
      const inviteAdminCookie = cookie(inviteAdminLogin);
      const inviteAdminStepUp = await request(app).post('/api/auth/reauth').set('Cookie', inviteAdminCookie).send({
        password: 'required admin password',
      });
      assert.equal(inviteAdminStepUp.status, 204);

      async function register(name) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', inviteAdminCookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const registered = await request(app).post('/api/auth/register').send({
          code: invite.body.code,
          name,
          password: name.toLowerCase() + ' secure passphrase',
        });
        assert.equal(registered.status, 201, JSON.stringify(registered.body));
        return { account: registered.body, cookie: cookie(registered) };
      }

      const alice = await register('Required Alice');
      const bob = await register('Required Bob');
      const game = await request(app).post('/api/games').set('Cookie', adminCookie).send({ name: 'Required Identity Game' });
      assert.equal(game.status, 201, JSON.stringify(game.body));

      const unauthenticated = await request(app).put('/api/skills').send({
        playerId: bob.account.id,
        gameId: game.body.id,
        rating: 7,
      });
      assert.equal(unauthenticated.status, 401);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM admin_log WHERE action = 'access_denied'").get().count,
        0
      );
      const malformedCookie = await request(app).get('/api/me').set('Cookie', 'respawn_session=%');
      assert.equal(malformedCookie.status, 401);

      const spoofedSkill = await request(app).put('/api/skills').set('Cookie', alice.cookie).send({
        playerId: bob.account.id,
        gameId: game.body.id,
        rating: 7,
      });
      assert.equal(spoofedSkill.status, 403, JSON.stringify(spoofedSkill.body));
      assert.equal(db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').get(alice.account.id, game.body.id), undefined);
      assert.equal(db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').get(bob.account.id, game.body.id), undefined);

      const catalogByMember = await request(app).post('/api/games').set('Cookie', alice.cookie).send({
        name: 'Unauthorized Catalog Game',
      });
      assert.equal(catalogByMember.status, 403);
      const suggestionByMember = await request(app).post('/api/games').set('Cookie', alice.cookie).send({
        name: 'Allowed Suggested Game',
        status: 'suggestion',
      });
      assert.equal(suggestionByMember.status, 201, JSON.stringify(suggestionByMember.body));

      const spoofedStats = await request(app).get('/api/players/' + bob.account.id + '/stats').set('Cookie', alice.cookie);
      assert.equal(spoofedStats.status, 200, JSON.stringify(spoofedStats.body));
      assert.equal(spoofedStats.body.playerId, alice.account.id);

      const foreignProfile = await request(app).get('/api/players/' + bob.account.id).set('Cookie', alice.cookie);
      assert.equal(foreignProfile.status, 200);
      assert.equal('api_key' in foreignProfile.body, false);
      assert.equal('password_hash' in foreignProfile.body, false);
      assert.equal('last_login_at' in foreignProfile.body, false);
      const ownProfile = await request(app).get('/api/players/' + alice.account.id).set('Cookie', alice.cookie);
      assert.equal(typeof ownProfile.body.api_key, 'string');
      assert.equal('password_hash' in ownProfile.body, false);
      assert.equal('last_login_at' in ownProfile.body, false);
      const roster = await request(app).get('/api/players').set('Cookie', alice.cookie);
      assert.ok(roster.body.every((player) => !('password_hash' in player) && !('last_login_at' in player)));
      const oldAliceApiKey = ownProfile.body.api_key;
      const rotatedKey = await request(app).post('/api/players/' + alice.account.id + '/api-key/rotate').set('Cookie', alice.cookie);
      assert.equal(rotatedKey.status, 200, JSON.stringify(rotatedKey.body));
      assert.notEqual(rotatedKey.body.apiKey, oldAliceApiKey);
      assert.equal((await request(app).post('/api/agent/report').set('x-api-key', oldAliceApiKey).send({ processNames: [] })).status, 401);
      assert.equal((await request(app).post('/api/agent/report').set('x-api-key', rotatedKey.body.apiKey).send({ processNames: [] })).status, 200);

      const foreignPatch = await request(app).patch('/api/players/' + bob.account.id).set('Cookie', alice.cookie).send({ name: 'Spoofed Bob' });
      assert.equal(foreignPatch.status, 403);

      // Required mode retires the direct isAdmin toggle: instance admin
      // rights are derived from the group role instead (groups.ts,
      // changeGroupMemberRole; docs/plans/reset-single-group.md §9.1).
      const legacyIsAdminToggle = await request(app).patch('/api/players/' + alice.account.id).set('Cookie', adminCookie).send({ isAdmin: true });
      assert.equal(legacyIsAdminToggle.status, 400);

      const roleWithoutStepUp = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + alice.account.id)
        .set('Cookie', adminCookie)
        .send({ role: 'admin' });
      assert.equal(roleWithoutStepUp.status, 403);
      assert.equal(roleWithoutStepUp.body.code, 'reauth_required');
      const wrongStepUp = await request(app).post('/api/auth/reauth').set('Cookie', adminCookie).send({ password: 'wrong password' });
      assert.equal(wrongStepUp.status, 401);
      const stepUp = await request(app).post('/api/auth/reauth').set('Cookie', adminCookie).send({ password: 'required admin password' });
      assert.equal(stepUp.status, 204);
      const backupAsMember = await request(app).get('/api/backup').set('Cookie', alice.cookie);
      assert.equal(backupAsMember.status, 403);
      const backupAdminLogin = await request(app).post('/api/auth/login').send({
        name: 'Required Admin',
        password: 'required admin password',
      });
      const backupWithoutStepUp = await request(app).get('/api/backup').set('Cookie', cookie(backupAdminLogin));
      assert.equal(backupWithoutStepUp.status, 403);
      assert.equal(backupWithoutStepUp.body.code, 'reauth_required');
      const backupWithStepUp = await request(app).get('/api/backup').set('Cookie', adminCookie);
      assert.equal(backupWithStepUp.status, 409);
      const roleAfterStepUp = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + alice.account.id)
        .set('Cookie', adminCookie)
        .send({ role: 'admin' });
      assert.equal(roleAfterStepUp.status, 200, JSON.stringify(roleAfterStepUp.body));
      assert.equal(db.prepare('SELECT is_admin FROM players WHERE id = ?').get(alice.account.id).is_admin, 1);
      const revokeSecondAdmin = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + alice.account.id)
        .set('Cookie', adminCookie)
        .send({ role: 'member' });
      assert.equal(revokeSecondAdmin.status, 200);
      assert.equal(db.prepare('SELECT is_admin FROM players WHERE id = ?').get(alice.account.id).is_admin, 0);
      // The sole owner can never be demoted (last_owner guard in groups.ts) -
      // the group-role path this instance admin now goes through.
      const revokeLastAdmin = await request(app)
        .patch('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + admin.body.id)
        .set('Cookie', adminCookie)
        .send({ role: 'member' });
      assert.equal(revokeLastAdmin.status, 409);
      const deleteLastAdmin = await request(app).delete('/api/players/' + admin.body.id).set('Cookie', adminCookie);
      assert.equal(deleteLastAdmin.status, 409);

      const subscription = {
        endpoint: 'https://push.example/required-mode',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      };
      const aliceBind = await request(app).post('/api/push/subscribe').set('Cookie', alice.cookie).send({
        playerId: bob.account.id,
        subscription,
      });
      assert.equal(aliceBind.status, 201, JSON.stringify(aliceBind.body));
      assert.equal(db.prepare('SELECT player_id FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint).player_id, alice.account.id);

      const bobRebind = await request(app).post('/api/push/subscribe').set('Cookie', bob.cookie).send({
        playerId: alice.account.id,
        subscription,
      });
      assert.equal(bobRebind.status, 201);
      assert.equal(db.prepare('SELECT player_id FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint).player_id, bob.account.id);

      await request(app).post('/api/push/unsubscribe').set('Cookie', alice.cookie).send({ endpoint: subscription.endpoint });
      assert.ok(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint));
      await request(app).post('/api/push/unsubscribe').set('Cookie', bob.cookie).send({ endpoint: subscription.endpoint });
      assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint), undefined);

      const secondAdminLogin = await request(app).post('/api/auth/login').send({
        name: 'Required Admin',
        password: 'required admin password',
      });
      assert.equal(secondAdminLogin.status, 200);
      const isolatedStepUp = await request(app).delete('/api/players/' + bob.account.id).set('Cookie', cookie(secondAdminLogin));
      assert.equal(isolatedStepUp.status, 403);
      assert.equal(isolatedStepUp.body.code, 'reauth_required');
      const hardDeleteRealPlayer = await request(app).delete('/api/players/' + bob.account.id).set('Cookie', adminCookie);
      assert.equal(hardDeleteRealPlayer.status, 409);
      const bobFull = await request(app).get('/api/players/' + bob.account.id).set('Cookie', adminCookie);
      const deactivate = await request(app).post('/api/players/' + bob.account.id + '/deactivate').set('Cookie', adminCookie);
      assert.equal(deactivate.status, 204, JSON.stringify(deactivate.body));
      assert.equal((await request(app).get('/api/me').set('Cookie', bob.cookie)).status, 401);
      assert.equal((await request(app).post('/api/agent/report').set('x-api-key', bobFull.body.api_key).send({ processNames: [] })).status, 401);
      const activeRoster = await request(app).get('/api/players').set('Cookie', alice.cookie);
      assert.equal(activeRoster.body.some((player) => player.id === bob.account.id), false);
      const adminRoster = await request(app).get('/api/admin/players').set('Cookie', adminCookie);
      assert.ok(adminRoster.body.find((player) => player.id === bob.account.id).deactivated_at);
      const reactivate = await request(app).post('/api/players/' + bob.account.id + '/reactivate').set('Cookie', adminCookie);
      assert.equal(reactivate.status, 204);
      const bobRelogin = await request(app).post('/api/auth/login').send({ name: 'Required Bob', password: 'required bob secure passphrase' });
      assert.equal(bobRelogin.status, 200);

      const passwordChangeSubscription = {
        endpoint: 'https://push.example/password-change',
        keys: { p256dh: 'password-change-p256dh', auth: 'password-change-auth' },
      };
      assert.equal(
        (await request(app).post('/api/push/subscribe').set('Cookie', cookie(bobRelogin)).send({ subscription: passwordChangeSubscription })).status,
        201
      );
      const passwordChange = await request(app).post('/api/auth/password').set('Cookie', cookie(bobRelogin)).send({
        currentPassword: 'required bob secure passphrase',
        newPassword: 'required bob changed passphrase',
      });
      assert.equal(passwordChange.status, 204);
      assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(passwordChangeSubscription.endpoint), undefined);

      const nonAdminAdminRoute = await request(app).get('/api/admin/players').set('Cookie', cookie(bobRelogin));
      assert.equal(nonAdminAdminRoute.status, 403);
      const audit = await request(app).get('/api/admin/audit').set('Cookie', adminCookie);
      assert.equal(audit.status, 200);
      assert.ok(audit.body.some((entry) => entry.action === 'player_deactivated' && entry.target_id === bob.account.id));
      assert.ok(audit.body.some((entry) => entry.action === 'api_key_rotated' && entry.target_id === alice.account.id));
      // is_admin changes driven by the group role still land in the
      // instance-wide audit (group_id NULL), same as the retired direct
      // toggle used to, so /api/admin/audit stays the authoritative trail
      // for "who currently holds instance admin rights". The concurrent
      // last-owner-vs-demotion race is covered in
      // api.groupAuthorization.required.test.ts's ownerRace, which also
      // asserts the resulting is_admin state.
      assert.ok(audit.body.some((entry) => entry.action === 'admin_granted' && entry.target_id === alice.account.id));
      assert.ok(audit.body.some((entry) => entry.action === 'admin_revoked' && entry.target_id === alice.account.id));

      db.exec('DROP INDEX IF EXISTS idx_players_name_unique');
      const duplicateHash = db.prepare('SELECT password_hash FROM players WHERE id = ?').get(admin.body.id).password_hash;
      db.prepare(
        'INSERT INTO players (id, name, api_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('duplicate-a', 'Duplicate Login', 'duplicate-key-a', duplicateHash, Date.now());
      db.prepare(
        'INSERT INTO players (id, name, api_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('duplicate-b', 'Duplicate Login', 'duplicate-key-b', duplicateHash, Date.now());
      const ambiguousLogin = await request(app).post('/api/auth/login').send({
        name: 'Duplicate Login',
        password: 'required admin password',
      });
      assert.equal(ambiguousLogin.status, 409);

      const rateLimitLogin = await request(app).post('/api/auth/login').send({
        name: 'Required Alice',
        password: 'required alice secure passphrase',
      });
      const rateLimitCookie = cookie(rateLimitLogin);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const failed = await request(app).post('/api/auth/reauth').set('Cookie', rateLimitCookie).send({ password: 'wrong' });
        assert.equal(failed.status, 401);
      }
      const lockedReauth = await request(app).post('/api/auth/reauth').set('Cookie', rateLimitCookie).send({
        password: 'required alice secure passphrase',
      });
      assert.equal(lockedReauth.status, 429);
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  try {
    execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        AUTH_MODE: 'required',
        ACCESS_TOKEN: 'legacy-token-that-must-not-be-required',
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        KIOSK_TOKEN: 'required-kiosk-token',
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`required-mode child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`);
  }
});

test('required auth recovery code restores the sole admin and revokes old devices', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});
    function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
    (async () => {
      const app = createApp();
      const registered = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Sole Recovery Admin',
        password: 'original recovery passphrase',
      });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
      const oldCookie = cookie(registered);
      const secondLogin = await request(app).post('/api/auth/login').send({
        name: 'Sole Recovery Admin',
        password: 'original recovery passphrase',
      });
      const subscription = {
        endpoint: 'https://push.example/recovery',
        keys: { p256dh: 'recovery-p256dh', auth: 'recovery-auth' },
      };
      assert.equal(
        (await request(app).post('/api/push/subscribe').set('Cookie', oldCookie).send({ subscription })).status,
        201
      );
      const reset = await request(app).post('/api/auth/reset').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        newPassword: 'restored recovery passphrase',
      });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      assert.equal((await request(app).get('/api/me').set('Cookie', oldCookie)).status, 401);
      assert.equal((await request(app).get('/api/me').set('Cookie', cookie(secondLogin))).status, 401);
      assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint), undefined);
      assert.equal(
        (await request(app).post('/api/auth/login').send({
          name: 'Sole Recovery Admin',
          password: 'restored recovery passphrase',
        })).status,
        200
      );
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  try {
    execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        AUTH_MODE: 'required',
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`required recovery child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`);
  }
});
