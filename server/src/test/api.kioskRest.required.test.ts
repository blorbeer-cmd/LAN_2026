// AUTH_MODE and KIOSK_TOKEN are read at module import time, so the read-only
// kiosk REST boundary is exercised in a child process with the environment
// configured before app.ts and its routers load. Covers the token-only
// dashboard load (/push/last must be reachable), the env-token archived-group
// rejection, and the group-kiosk banner union that mirrors the socket rules.

import { test } from 'node:test';
import { execFileSync } from 'child_process';
import path from 'path';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');

test('a token-only kiosk can load the whole dashboard, honours archival, and unions its banner scope', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});

    const KIOSK = 'required-kiosk-token';
    const GROUP = 'default-group';

    function kioskGet(app, pathname) {
      return request(app).get(pathname).set('x-kiosk-mode', '1').set('x-access-token', KIOSK);
    }

    // Direct group-wide push rows: an empty player_ids array satisfies the
    // NOT NULL column and the recipient trigger (json_each('[]') is empty),
    // and the kiosk banner query filters on audience/scope, never player_ids.
    let seq = 0;
    function pushRow(title, eventId) {
      db.prepare(
        "INSERT INTO push_log (id, group_id, event_id, title, body, url, audience, player_ids, topic_key, expires_at, resolved_at, created_at) " +
        "VALUES (?, ?, ?, ?, '', NULL, 'all', '[]', NULL, NULL, NULL, ?)"
      ).run('push-' + seq, GROUP, eventId, title, Date.now() + seq);
      seq += 1;
    }

    (async () => {
      const app = createApp();

      // #1 — /push/last must be a read-only kiosk path; before the fix a
      // token-only kiosk 401s here and its whole Promise.all refresh fails.
      const lastEmpty = await kioskGet(app, '/api/push/last');
      assert.equal(lastEmpty.status, 200, JSON.stringify(lastEmpty.body));
      assert.equal(lastEmpty.body.entry, null);
      for (const p of ['/api/live', '/api/votes', '/api/leaderboard', '/api/food-orders']) {
        assert.equal((await kioskGet(app, p)).status, 200, 'kiosk GET ' + p);
      }

      // #4 — a group kiosk unions its group room with its current tracking
      // event and returns the newest active 'all' entry across both.
      db.prepare("INSERT INTO events (id, name, starts_at, group_id, tracking_enabled) VALUES ('kiosk-evt', 'Kiosk Evt', ?, ?, 1)").run(Date.now(), GROUP);
      pushRow('Gruppenraum', null);
      const afterRoom = await kioskGet(app, '/api/push/last');
      assert.equal(afterRoom.body.entry.title, 'Gruppenraum', 'group-room banner is shown');
      pushRow('Aktuelles Event', 'kiosk-evt');
      const afterEvent = await kioskGet(app, '/api/push/last');
      assert.equal(afterEvent.body.entry.title, 'Aktuelles Event', 'the newer current-event banner wins the union');

      // #2 — the env token keeps reading until the resolved group is archived,
      // then every kiosk GET is rejected (parity with the socket delivery).
      const beforeArchive = await kioskGet(app, '/api/live');
      assert.equal(beforeArchive.status, 200);
      db.prepare('UPDATE groups SET archived_at = ? WHERE id = ?').run(Date.now(), GROUP);
      const afterArchive = await kioskGet(app, '/api/live');
      assert.equal(afterArchive.status, 404, 'an archived group must reject the env-token kiosk');
      const lastAfterArchive = await kioskGet(app, '/api/push/last');
      assert.equal(lastAfterArchive.status, 404, 'and the banner endpoint too');

      console.log('KIOSK_REST_OK');
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      DB_FILE: ':memory:',
      AUTH_MODE: 'required',
      COOKIE_SECURE: '0',
      KIOSK_TOKEN: 'required-kiosk-token',
      ADMIN_RECOVERY_CODE: 'kiosk-rest-recovery-code',
    },
    encoding: 'utf8',
  });
  if (!out.includes('KIOSK_REST_OK')) throw new Error('kiosk REST assertions did not complete:\n' + out);
});
