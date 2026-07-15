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
    const { db } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }

    (async () => {
      const app = createApp();
      const meta = await request(app).get('/api/meta');
      assert.equal(meta.status, 200);
      assert.equal(meta.body.accessProtection, false);
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

      const spoofedSkill = await request(app).put('/api/skills').set('Cookie', alice.cookie).send({
        playerId: bob.account.id,
        gameId: game.body.id,
        rating: 7,
      });
      assert.equal(spoofedSkill.status, 200, JSON.stringify(spoofedSkill.body));
      assert.equal(spoofedSkill.body.playerId, alice.account.id);
      assert.ok(db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').get(alice.account.id, game.body.id));
      assert.equal(db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').get(bob.account.id, game.body.id), undefined);

      const spoofedStats = await request(app).get('/api/players/' + bob.account.id + '/stats').set('Cookie', alice.cookie);
      assert.equal(spoofedStats.status, 200, JSON.stringify(spoofedStats.body));
      assert.equal(spoofedStats.body.playerId, alice.account.id);

      const foreignProfile = await request(app).get('/api/players/' + bob.account.id).set('Cookie', alice.cookie);
      assert.equal(foreignProfile.status, 200);
      assert.equal('api_key' in foreignProfile.body, false);
      const ownProfile = await request(app).get('/api/players/' + alice.account.id).set('Cookie', alice.cookie);
      assert.equal(typeof ownProfile.body.api_key, 'string');
      const oldAliceApiKey = ownProfile.body.api_key;
      const rotatedKey = await request(app).post('/api/players/' + alice.account.id + '/api-key/rotate').set('Cookie', alice.cookie);
      assert.equal(rotatedKey.status, 200, JSON.stringify(rotatedKey.body));
      assert.notEqual(rotatedKey.body.apiKey, oldAliceApiKey);
      assert.equal((await request(app).post('/api/agent/report').set('x-api-key', oldAliceApiKey).send({ processNames: [] })).status, 401);
      assert.equal((await request(app).post('/api/agent/report').set('x-api-key', rotatedKey.body.apiKey).send({ processNames: [] })).status, 200);

      const foreignPatch = await request(app).patch('/api/players/' + bob.account.id).set('Cookie', alice.cookie).send({ name: 'Spoofed Bob' });
      assert.equal(foreignPatch.status, 403);

      const roleWithoutStepUp = await request(app).patch('/api/players/' + alice.account.id).set('Cookie', adminCookie).send({ isAdmin: true });
      assert.equal(roleWithoutStepUp.status, 403);
      assert.equal(roleWithoutStepUp.body.code, 'reauth_required');
      const wrongStepUp = await request(app).post('/api/auth/reauth').set('Cookie', adminCookie).send({ password: 'wrong password' });
      assert.equal(wrongStepUp.status, 401);
      const stepUp = await request(app).post('/api/auth/reauth').set('Cookie', adminCookie).send({ password: 'required admin password' });
      assert.equal(stepUp.status, 204);
      const roleAfterStepUp = await request(app).patch('/api/players/' + alice.account.id).set('Cookie', adminCookie).send({ isAdmin: true });
      assert.equal(roleAfterStepUp.status, 200, JSON.stringify(roleAfterStepUp.body));
      const revokeSecondAdmin = await request(app).patch('/api/players/' + alice.account.id).set('Cookie', adminCookie).send({ isAdmin: false });
      assert.equal(revokeSecondAdmin.status, 200);
      const revokeLastAdmin = await request(app).patch('/api/players/' + admin.body.id).set('Cookie', adminCookie).send({ isAdmin: false });
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

      const nonAdminAdminRoute = await request(app).get('/api/admin/players').set('Cookie', cookie(bobRelogin));
      assert.equal(nonAdminAdminRoute.status, 403);
      const audit = await request(app).get('/api/admin/audit').set('Cookie', adminCookie);
      assert.equal(audit.status, 200);
      assert.ok(audit.body.some((entry) => entry.action === 'player_deactivated' && entry.target_id === bob.account.id));
      assert.ok(audit.body.some((entry) => entry.action === 'api_key_rotated' && entry.target_id === alice.account.id));

      const promoteAliceAgain = await request(app).patch('/api/players/' + alice.account.id).set('Cookie', adminCookie).send({ isAdmin: true });
      assert.equal(promoteAliceAgain.status, 200, JSON.stringify(promoteAliceAgain.body));
      const aliceStepUp = await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({
        password: 'required alice secure passphrase',
      });
      assert.equal(aliceStepUp.status, 204);
      const concurrentRevocations = await Promise.all([
        request(app).patch('/api/players/' + alice.account.id).set('Cookie', adminCookie).send({ isAdmin: false }),
        request(app).patch('/api/players/' + admin.body.id).set('Cookie', alice.cookie).send({ isAdmin: false }),
      ]);
      assert.equal(concurrentRevocations.filter((response) => response.status === 200).length, 1);
      assert.ok(concurrentRevocations.every((response) => [200, 403, 409].includes(response.status)));
      const activeAdminCount = db.prepare(
        'SELECT COUNT(*) AS count FROM players WHERE is_admin = 1 AND deactivated_at IS NULL'
      ).get().count;
      assert.equal(activeAdminCount, 1);
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
