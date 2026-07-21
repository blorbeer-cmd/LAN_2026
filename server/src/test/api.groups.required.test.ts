// The instance has exactly one group (the migrated start group); account
// claim/registration is import-time configuration, so this boundary is
// exercised in an isolated child process.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'group-foundation-recovery-code';

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
