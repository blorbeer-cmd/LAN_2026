// Group creation is feature-flagged and auth configuration is read at import
// time, so this boundary is exercised in an isolated child process.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'group-foundation-recovery-code';

function runGroupScenario(multiGroupsEnabled: boolean): void {
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
      const admin = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Group Owner',
        password: 'group owner secure passphrase',
      });
      assert.equal(admin.status, 201, JSON.stringify(admin.body));
      const adminCookie = cookie(admin);

      const initialGroups = await request(app).get('/api/groups').set('Cookie', adminCookie);
      assert.equal(initialGroups.status, 200, JSON.stringify(initialGroups.body));
      assert.deepEqual(initialGroups.body.map((group) => [group.id, group.role]), [[DEFAULT_GROUP_ID, 'owner']]);

      const created = await request(app).post('/api/groups').set('Cookie', adminCookie).send({
        name: 'Second Crew',
        description: 'Separate Testgruppe',
      });

      if (!${multiGroupsEnabled}) {
        assert.equal(created.status, 409, JSON.stringify(created.body));
        assert.equal(created.body.code, 'multi_groups_disabled');
        assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', adminCookie).send({
          password: 'group owner secure passphrase',
        })).status, 204);
        const accountInvite = await request(app)
          .post('/api/auth/invites')
          .set('Cookie', adminCookie)
          .send({ purpose: 'register' });
        assert.equal(accountInvite.status, 201, JSON.stringify(accountInvite.body));
        const member = await request(app).post('/api/auth/register').send({
          code: accountInvite.body.code,
          name: 'Default Group Member',
          password: 'default group member passphrase',
        });
        assert.equal(member.status, 201, JSON.stringify(member.body));
        const blockedRemoval = await request(app)
          .delete('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + member.body.id)
          .set('Cookie', adminCookie);
        assert.equal(blockedRemoval.status, 409);
        return;
      }

      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.role, 'owner');
      assert.equal(created.body.outsideTrackingEnabled, false);
      const groupId = created.body.id;

      const inviteWithoutStepUp = await request(app)
        .post('/api/groups/' + groupId + '/invites')
        .set('Cookie', adminCookie)
        .send({});
      assert.equal(inviteWithoutStepUp.status, 403);
      assert.equal(inviteWithoutStepUp.body.code, 'reauth_required');

      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', adminCookie).send({
        password: 'group owner secure passphrase',
      })).status, 204);

      async function register(name) {
        const accountInvite = await request(app).post('/api/auth/invites').set('Cookie', adminCookie).send({ purpose: 'register' });
        assert.equal(accountInvite.status, 201, JSON.stringify(accountInvite.body));
        const response = await request(app).post('/api/auth/register').send({
          code: accountInvite.body.code,
          name,
          password: name.toLowerCase() + ' secure passphrase',
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response) };
      }

      const member = await register('Group Member');
      const outsider = await register('Group Outsider');
      const hiddenMembers = await request(app).get('/api/groups/' + groupId + '/members').set('Cookie', outsider.cookie);
      assert.equal(hiddenMembers.status, 404);

      const targetedInvite = await request(app)
        .post('/api/groups/' + groupId + '/invites')
        .set('Cookie', adminCookie)
        .send({ targetPlayerId: member.account.id });
      assert.equal(targetedInvite.status, 201, JSON.stringify(targetedInvite.body));
      const wrongPreview = await request(app).get('/api/groups/invites/' + targetedInvite.body.code).set('Cookie', outsider.cookie);
      assert.equal(wrongPreview.status, 404);
      const preview = await request(app).get('/api/groups/invites/' + targetedInvite.body.code).set('Cookie', member.cookie);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.group.id, groupId);

      const accepted = await request(app)
        .post('/api/groups/invites/' + targetedInvite.body.code + '/accept')
        .set('Cookie', member.cookie);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal(accepted.body.role, 'member');
      assert.equal(accepted.body.outsideTrackingEnabled, false);
      assert.equal((await request(app).get('/api/groups/' + groupId + '/members').set('Cookie', member.cookie)).status, 200);
      assert.equal((await request(app).get('/api/groups/' + groupId + '/invites').set('Cookie', member.cookie)).status, 403);
      assert.equal((await request(app).post('/api/groups/invites/' + targetedInvite.body.code + '/accept').set('Cookie', member.cookie)).status, 404);

      const openInvite = await request(app)
        .post('/api/groups/' + groupId + '/invites')
        .set('Cookie', adminCookie)
        .send({});
      assert.equal(openInvite.status, 201, JSON.stringify(openInvite.body));
      const simultaneous = await Promise.all([
        request(app).post('/api/groups/invites/' + openInvite.body.code + '/accept').set('Cookie', outsider.cookie),
        request(app).post('/api/groups/invites/' + openInvite.body.code + '/accept').set('Cookie', member.cookie),
      ]);
      assert.equal(simultaneous.filter((response) => response.status === 200).length, 1);
      assert.equal(simultaneous.filter((response) => response.status === 404 || response.status === 409).length, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM group_invites WHERE code = ? AND used_at IS NOT NULL').get(openInvite.body.code).count, 1);

      const memberships = await request(app).get('/api/groups').set('Cookie', member.cookie);
      assert.equal(memberships.status, 200);
      assert.ok(memberships.body.some((group) => group.id === DEFAULT_GROUP_ID));
      assert.ok(memberships.body.some((group) => group.id === groupId && group.role === 'member'));
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
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
        MULTI_GROUPS_ENABLED: multiGroupsEnabled ? '1' : '0',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`group foundation child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`);
  }
}

test('additional groups stay disabled until tenant isolation is complete', () => {
  runGroupScenario(false);
});

test('group owners can create a group and invite existing accounts atomically', () => {
  runGroupScenario(true);
});

test('the first legacy account claim becomes owner of the migrated default group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    const playerId = 'legacy-first-claim';
    const now = Date.now();
    db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
      .run(playerId, 'Legacy Claim', 'legacy-claim-key', now);
    db.prepare(
      "INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 1)"
    ).run(DEFAULT_GROUP_ID, playerId, now);

    (async () => {
      const response = await request(createApp()).post('/api/auth/claim').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        playerId,
        password: 'legacy claim secure passphrase',
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const membership = db.prepare('SELECT role FROM group_memberships WHERE group_id = ? AND player_id = ?')
        .get(DEFAULT_GROUP_ID, playerId);
      assert.equal(membership.role, 'owner');
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
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`legacy group ownership child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`);
  }
});
