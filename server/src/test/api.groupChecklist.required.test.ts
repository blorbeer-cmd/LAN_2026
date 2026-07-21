// Regression coverage for the Packliste finding that mutations must be
// scoped to the group's *currently tracked event*, not just the group as a
// whole - switching which event tracks must make the previous event's items
// un-mutable even though they remain group-owned. Events stay the one real
// scoping dimension once there is only ever one group (see
// docs/plans/reset-single-group.md).
//
// Same execFileSync-child-process pattern as api.groupSeatingPings.required.test.ts
// (required auth + real cookies needs a live process, not the in-process app
// used by the legacy-mode checklist tests).

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'checklist-recovery-code';

test('checklist mutations 404 across an event-scope boundary and group admins moderate tasks', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
    function scoped(app, method, url, user, groupId) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', groupId);
    }

    (async () => {
      const app = createApp();
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)}, name: 'Checklist Alice', password: 'checklist alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'checklist alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }
      const bob = await register('Checklist Bob', 'checklist bob secure passphrase');
      const dave = await register('Checklist Dave', 'checklist dave secure passphrase');

      const groupsResponse = await request(app).get('/api/groups').set('Cookie', alice.cookie);
      const groupId = groupsResponse.body[0].id;
      const promoteDave = await request(app).patch('/api/groups/' + groupId + '/members/' + dave.account.id)
        .set('Cookie', alice.cookie).send({ role: 'admin' });
      assert.equal(promoteDave.status, 200, JSON.stringify(promoteDave.body));

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupId)
        .send({ name: 'Checklist Event A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice, groupId)).status, 200);

      const itemA = await scoped(app, 'post', '/api/checklist/items', alice, groupId).send({ label: 'Sache A' });
      assert.equal(itemA.status, 201, JSON.stringify(itemA.body));
      const taskA = await scoped(app, 'post', '/api/checklist/tasks', bob, groupId).send({ title: 'Anfrage A' });
      assert.equal(taskA.status, 201, JSON.stringify(taskA.body));

      const itemARow = db.prepare('SELECT group_id, event_id FROM checklist_items WHERE id = ?').get(itemA.body.id);
      const taskARow = db.prepare('SELECT group_id, event_id FROM checklist_tasks WHERE id = ?').get(taskA.body.id);
      assert.equal(itemARow.group_id, groupId);
      assert.equal(itemARow.event_id, eventA.body.id);
      assert.equal(taskARow.group_id, groupId);
      assert.equal(taskARow.event_id, eventA.body.id);

      const listA = await scoped(app, 'get', '/api/checklist/tasks', alice, groupId);
      assert.deepEqual(listA.body.tasks.map((t) => t.id), [taskA.body.id]);

      // --- id-based mutations must 404 for an unknown id ---
      assert.equal((await scoped(app, 'patch', '/api/checklist/items/does-not-exist', bob, groupId).send({ checked: true })).status, 404);
      assert.equal((await scoped(app, 'delete', '/api/checklist/items/does-not-exist', bob, groupId).send({})).status, 404);
      assert.equal((await scoped(app, 'post', '/api/checklist/tasks/does-not-exist/claim', dave, groupId).send({})).status, 404);

      // --- group admins (not just the creator/assignee) moderate their own group's tasks ---
      const claimedA = await scoped(app, 'post', '/api/checklist/tasks/' + taskA.body.id + '/claim', bob, groupId).send({});
      assert.equal(claimedA.status, 409, JSON.stringify(claimedA.body), 'Bob created taskA and cannot claim his own request');
      // Alice (owner, not creator/assignee of taskA which Bob created and
      // nobody claimed yet) attempting done must also fail - a task has to
      // be taken before it can be done regardless of role.
      assert.equal((await scoped(app, 'patch', '/api/checklist/tasks/' + taskA.body.id + '/done', alice, groupId).send({})).status, 409);

      const todoBob = await scoped(app, 'post', '/api/checklist/tasks/todo', alice, groupId)
        .send({ title: 'Mehrfachsteckdosen', assigneePlayerIds: [bob.account.id] });
      assert.equal(todoBob.status, 201, JSON.stringify(todoBob.body));
      const todoBobId = todoBob.body.tasks[0].id;
      // Dave is an admin but neither creator nor assignee - he may still
      // moderate it.
      const memberDoneAttempt = await scoped(app, 'patch', '/api/checklist/tasks/' + todoBobId + '/done', dave, groupId).send({});
      assert.equal(memberDoneAttempt.status, 200, JSON.stringify(memberDoneAttempt.body));
      assert.equal(memberDoneAttempt.body.status, 'done');

      // Same admin-moderation check for cancel (DELETE), on a fresh open task
      // - a plain member (not admin/owner, not creator) may not cancel it.
      const todoOpen = await scoped(app, 'post', '/api/checklist/tasks/todo', alice, groupId).send({ title: 'Ohrstöpsel besorgen' });
      const todoOpenId = todoOpen.body.tasks[0].id;
      assert.equal((await scoped(app, 'delete', '/api/checklist/tasks/' + todoOpenId, bob, groupId).send({})).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/checklist/tasks/' + todoOpenId, dave, groupId).send({})).status, 204);

      // --- mutations must also be scoped to the *current* event, not just
      // the group. itemA/taskA belong to eventA, still the group's own
      // resources - switching the group's tracking to a second event must
      // make them un-mutable (though still group-owned) even though a plain
      // group-membership check alone would happily let them through. ---
      const eventA2 = await scoped(app, 'post', '/api/events', alice, groupId)
        .send({ name: 'Checklist Event A2', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA2.status, 201);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice, groupId)).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA2.body.id + '/tracking/start', alice, groupId)).status, 200);

      // itemA/taskA still belong to the group and Alice/Bob are still active
      // members there - only the event scope changed - so a plain group-
      // mismatch check would incorrectly let these through.
      assert.equal((await scoped(app, 'patch', '/api/checklist/items/' + itemA.body.id, alice, groupId).send({ checked: true })).status, 404);
      assert.equal((await scoped(app, 'delete', '/api/checklist/items/' + itemA.body.id, alice, groupId).send({})).status, 404);
      assert.equal((await scoped(app, 'post', '/api/checklist/tasks/' + taskA.body.id + '/claim', dave, groupId).send({})).status, 404);

      // A fresh item/task created now lands under eventA2 and stays mutable.
      const itemA2 = await scoped(app, 'post', '/api/checklist/items', alice, groupId).send({ label: 'Zweites Event' });
      assert.equal(itemA2.status, 201);
      const itemA2Row = db.prepare('SELECT event_id FROM checklist_items WHERE id = ?').get(itemA2.body.id);
      assert.equal(itemA2Row.event_id, eventA2.body.id);
      const toggledItemA2 = await scoped(app, 'patch', '/api/checklist/items/' + itemA2.body.id, alice, groupId).send({ checked: true });
      assert.equal(toggledItemA2.status, 200, JSON.stringify(toggledItemA2.body));
      assert.equal(toggledItemA2.body.checked, true);

      // GET already only lists the current event's tasks/items - confirms
      // the mutation-side 404s above match what was already true for reads.
      const listAfterSwitch = await scoped(app, 'get', '/api/checklist/tasks', alice, groupId);
      assert.deepEqual(listAfterSwitch.body.tasks.map((t) => t.id), []);
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
    throw new Error(
      `group checklist child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
