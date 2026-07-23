// Integration test for the admin-recovery-code bootstrap path (see
// docs/KONZEPT-USER-MANAGEMENT.md 4.3/9): the only way in before any admin
// has claimed an account. ADMIN_RECOVERY_CODE is read once into config.ts at
// import time, so exercising it needs a fresh process with the env var
// already set — same reasoning as db.migrations.test.ts's execFileSync
// approach, just running against the real app instead of only db.ts.

import { test } from 'node:test';
import { execFileSync } from 'child_process';
import path from 'path';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const RECOVERY_CODE = 'test-only-recovery-code';

function runChildScript(script: string): void {
  try {
    execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, ADMIN_RECOVERY_CODE: RECOVERY_CODE },
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer };
    throw new Error(`recovery bootstrap child script failed:\n${e.stderr?.toString() ?? ''}\n${e.stdout?.toString() ?? ''}`);
  }
}

test('recovery code registers exactly one admin, then stops working', () => {
  runChildScript(`
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});

    (async () => {
      const app = createApp();

      const first = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Bootstrap Admin',
        password: 'bootstrap admin password',
      });
      assert.equal(first.status, 201, 'first bootstrap register should succeed: ' + JSON.stringify(first.body));
      assert.equal(first.body.isAdmin, true, 'bootstrap account should be admin');

      const second = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Second Bootstrap Admin',
        password: 'second bootstrap password',
      });
      assert.equal(second.status, 400, 'recovery code must be single-use once an admin exists: ' + JSON.stringify(second.body));
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `);
});

test('recovery code can instead claim an existing unclaimed player as admin, then stops working', () => {
  runChildScript(`
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});

    (async () => {
      const app = createApp();

      const playerA = await request(app).post('/api/players').send({ name: 'Unclaimed Legacy Player' });
      assert.equal(playerA.status, 201);

      const bootstrapAccounts = await request(app).get('/api/auth/bootstrap-accounts').query({
        code: ${JSON.stringify(RECOVERY_CODE)},
      });
      assert.equal(bootstrapAccounts.status, 200);
      assert.deepEqual(bootstrapAccounts.body.map((player) => player.id), [playerA.body.id]);

      const claimed = await request(app).post('/api/auth/claim').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        playerId: playerA.body.id,
        password: 'claimed via recovery code',
      });
      assert.equal(claimed.status, 200, 'recovery-code claim should succeed: ' + JSON.stringify(claimed.body));
      assert.equal(claimed.body.isAdmin, true, 'claimed account should become admin');
      assert.equal(
        (await request(app).get('/api/auth/bootstrap-accounts').query({ code: ${JSON.stringify(RECOVERY_CODE)} })).status,
        404,
        'bootstrap account listing must close with the recovery path'
      );

      const playerB = await request(app).post('/api/players').send({ name: 'Second Unclaimed Player' });
      const secondClaim = await request(app).post('/api/auth/claim').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        playerId: playerB.body.id,
        password: 'irrelevant password',
      });
      assert.equal(secondClaim.status, 400, 'recovery code must stop working once an admin has claimed: ' + JSON.stringify(secondClaim.body));
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `);
});

// Required mode derives players.is_admin from the group role
// (groups.ts, syncInstanceAdminForRole). recoveryCodeUsable() (routes/auth.ts)
// gates the recovery code on hasClaimedAdmin() (is_admin=1 + password_hash),
// a check independent of groups.ts's own hasOwner reading - a stale
// group_memberships 'owner' row (e.g. hand-repaired during an incident, or
// left over from an unclaimed legacy account) must not let that independent
// signal silently revert the very grant the recovery code exists to make.
const APP_JS_PATH_REQUIRED = APP_JS_PATH;
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');

test('recovery code bootstrap still grants admin in required mode despite a stale unclaimed owner row', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH_REQUIRED)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    (async () => {
      const app = createApp();

      // Simulate a stale group_memberships row: an "owner" who never
      // actually claimed a password (no players.is_admin/password_hash
      // combination exists, so hasClaimedAdmin() - and therefore the
      // recovery code - still reports "no admin yet").
      db.prepare(
        \`INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at) VALUES (?, ?, ?, 0, NULL, ?)\`
      ).run('stale-unclaimed-owner', 'Stale Unclaimed Owner', 'stale-owner-key', Date.now());
      db.prepare(
        \`INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
         VALUES (?, ?, 'owner', 'active', ?, NULL, 1, NULL)\`
      ).run(DEFAULT_GROUP_ID, 'stale-unclaimed-owner', Date.now());

      const registered = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Real Recovery Admin',
        password: 'real recovery admin password',
      });
      assert.equal(registered.status, 201, 'recovery register should still succeed: ' + JSON.stringify(registered.body));
      assert.equal(registered.body.isAdmin, true);

      const persisted = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(registered.body.id);
      assert.equal(persisted.is_admin, 1, 'is_admin must not be silently reverted by the group-role sync');

      const membership = db.prepare(
        "SELECT role FROM group_memberships WHERE group_id = ? AND player_id = ? AND status = 'active'"
      ).get(DEFAULT_GROUP_ID, registered.body.id);
      assert.equal(membership.role, 'owner', 'the bootstrap admin must become group owner despite the stale row');

      const totalAdmins = db.prepare('SELECT COUNT(*) AS count FROM players WHERE is_admin = 1').get().count;
      assert.equal(totalAdmins, 1, 'the instance must not end up with zero real admins after a successful bootstrap');
    })().catch((err) => { console.error(err); process.exit(1); });
  `;
  try {
    execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, AUTH_MODE: 'required', ADMIN_RECOVERY_CODE: RECOVERY_CODE, COOKIE_SECURE: '0', DB_FILE: ':memory:' },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `recovery-vs-stale-owner-register child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});

test('recovery code claim on an already-migrated legacy member still grants owner despite a stale unclaimed owner row', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH_REQUIRED)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    (async () => {
      const app = createApp();

      // A different stale, never-claimed 'owner' row (same setup as above).
      db.prepare(
        \`INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at) VALUES (?, ?, ?, 0, NULL, ?)\`
      ).run('stale-unclaimed-owner', 'Stale Unclaimed Owner', 'stale-owner-key', Date.now());
      db.prepare(
        \`INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
         VALUES (?, ?, 'owner', 'active', ?, NULL, 1, NULL)\`
      ).run(DEFAULT_GROUP_ID, 'stale-unclaimed-owner', Date.now());

      // A migrated legacy player: already has a group_memberships row
      // (role 'member', as migration 30 would backfill) but no password yet
      // - the "existing" branch of ensureDefaultGroupMembership.
      db.prepare(
        \`INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at) VALUES (?, ?, ?, 0, NULL, ?)\`
      ).run('legacy-claimant', 'Legacy Claimant', 'legacy-claimant-key', Date.now());
      db.prepare(
        \`INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
         VALUES (?, ?, 'member', 'active', ?, NULL, 1, NULL)\`
      ).run(DEFAULT_GROUP_ID, 'legacy-claimant', Date.now());

      const claimed = await request(app).post('/api/auth/claim').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        playerId: 'legacy-claimant',
        password: 'claimed via recovery despite stale owner',
      });
      assert.equal(claimed.status, 200, 'recovery-code claim should still succeed: ' + JSON.stringify(claimed.body));
      assert.equal(claimed.body.isAdmin, true);

      const persisted = db.prepare('SELECT is_admin FROM players WHERE id = ?').get('legacy-claimant');
      assert.equal(persisted.is_admin, 1, 'is_admin must not be silently reverted by the group-role sync');

      const membership = db.prepare(
        "SELECT role FROM group_memberships WHERE group_id = ? AND player_id = ? AND status = 'active'"
      ).get(DEFAULT_GROUP_ID, 'legacy-claimant');
      assert.equal(membership.role, 'owner', 'the claiming recovery admin must be promoted to owner despite the stale row');
    })().catch((err) => { console.error(err); process.exit(1); });
  `;
  try {
    execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, AUTH_MODE: 'required', ADMIN_RECOVERY_CODE: RECOVERY_CODE, COOKIE_SECURE: '0', DB_FILE: ':memory:' },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `recovery-vs-stale-owner-claim child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
