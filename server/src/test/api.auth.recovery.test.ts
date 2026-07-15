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
