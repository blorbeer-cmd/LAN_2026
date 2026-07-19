// Regression coverage for the multi-group Packliste findings from the
// 2026-07-19 Codex review (docs/reviews/2026-07-19-pr-237-review.md):
//
// - id-based task/item mutations (claim/release/done/cancel, item PATCH/
//   DELETE) must 404 when the resource belongs to a different group than
//   the one currently selected, even for a caller who is a legitimate
//   member of both groups.
// - group owners/admins (not just the creator/assignee) may moderate
//   (done/cancel) a task in their own group.
// - the event scope must be resolved per selected group, not from a single
//   global tracking event, so two groups tracking their own events at the
//   same time (MULTI_GROUPS_ENABLED) never cross-contaminate each other's
//   checklist rows.
//
// Same execFileSync-child-process pattern as api.groupSeatingPings.required.test.ts
// (required auth + real cookies + multi-group needs a live process, not the
// in-process app used by the legacy-mode checklist tests).

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'checklist-recovery-code';

test('checklist isolates two groups: cross-group mutations 404, group admins moderate, event scope never crosses groups', () => {
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
      const carol = await register('Checklist Carol', 'checklist carol secure passphrase');
      const dave = await register('Checklist Dave', 'checklist dave secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie).send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Checklist Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Checklist Group B' });
      assert.equal(groupAResponse.status, 201);
      assert.equal(groupBResponse.status, 201);
      const groupA = groupAResponse.body.id;
      const groupB = groupBResponse.body.id;

      async function addMember(owner, groupId, target, role) {
        const invite = await request(app).post('/api/groups/' + groupId + '/invites')
          .set('Cookie', owner.cookie).send({ targetPlayerId: target.account.id });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const accepted = await request(app).post('/api/groups/invites/' + invite.body.code + '/accept')
          .set('Cookie', target.cookie);
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
        if (role) {
          const patched = await request(app).patch('/api/groups/' + groupId + '/members/' + target.account.id)
            .set('Cookie', owner.cookie).send({ role });
          assert.equal(patched.status, 200, JSON.stringify(patched.body));
        }
      }
      // Bob: plain member of A only. Dave: group-admin of B, otherwise
      // uninvolved in every task below. Alice: owner of A, and *also* a
      // member of B - she can legitimately select either group, which is
      // exactly the case the header-mismatch guard has to catch (knowing a
      // valid id from B must not become reachable just because she's
      // currently allowed to select B; it must fail while she has A
      // selected, and only work once she actually switches to B).
      await addMember(alice, groupA, bob);
      await addMember(carol, groupB, dave, 'admin');
      await addMember(carol, groupB, alice);

      // Both groups track their own event at the same time - only possible
      // with MULTI_GROUPS_ENABLED, and exactly the scenario the old global
      // getTrackingEventId() call would have gotten wrong.
      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupA)
        .send({ name: 'Checklist Event A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol, groupB)
        .send({ name: 'Checklist Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201);
      assert.equal(eventB.status, 201);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice, groupA)).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol, groupB)).status, 200);

      // --- Finding: event scope must resolve per selected group ---
      const itemA = await scoped(app, 'post', '/api/checklist/items', alice, groupA).send({ label: 'Gruppe A Sache' });
      assert.equal(itemA.status, 201, JSON.stringify(itemA.body));
      const taskA = await scoped(app, 'post', '/api/checklist/tasks', bob, groupA).send({ title: 'Gruppe A Anfrage' });
      assert.equal(taskA.status, 201, JSON.stringify(taskA.body));
      const itemB = await scoped(app, 'post', '/api/checklist/items', carol, groupB).send({ label: 'Gruppe B Sache' });
      assert.equal(itemB.status, 201, JSON.stringify(itemB.body));

      const itemARow = db.prepare('SELECT group_id, event_id FROM checklist_items WHERE id = ?').get(itemA.body.id);
      const taskARow = db.prepare('SELECT group_id, event_id FROM checklist_tasks WHERE id = ?').get(taskA.body.id);
      const itemBRow = db.prepare('SELECT group_id, event_id FROM checklist_items WHERE id = ?').get(itemB.body.id);
      assert.equal(itemARow.group_id, groupA);
      assert.equal(itemARow.event_id, eventA.body.id, 'group A writes must land under group A\\'s own tracking event');
      assert.equal(taskARow.group_id, groupA);
      assert.equal(taskARow.event_id, eventA.body.id);
      assert.equal(itemBRow.group_id, groupB);
      assert.equal(itemBRow.event_id, eventB.body.id, 'group B writes must never land under group A\\'s event');

      const listA = await scoped(app, 'get', '/api/checklist/tasks', alice, groupA);
      assert.deepEqual(listA.body.tasks.map((t) => t.id), [taskA.body.id]);
      const listB = await scoped(app, 'get', '/api/checklist/tasks', carol, groupB);
      assert.deepEqual(listB.body.tasks.map((t) => t.id), []);

      // --- Finding: id-based mutations must 404 across a group boundary ---
      // Bob only belongs to A; selecting A while pointing at B's task/item
      // ids must 404, not silently touch B's rows.
      assert.equal((await scoped(app, 'patch', '/api/checklist/items/' + itemB.body.id, bob, groupA).send({ checked: true })).status, 404);
      assert.equal((await scoped(app, 'delete', '/api/checklist/items/' + itemB.body.id, bob, groupA).send({})).status, 404);
      assert.equal((await scoped(app, 'post', '/api/checklist/tasks/' + taskA.body.id + '/claim', dave, groupB).send({})).status, 404);

      // Alice is a genuine member of both groups, but the task id belongs to
      // B while she has A selected - still 404, not reachable just because
      // she could legitimately see it after switching groups.
      const taskB = await scoped(app, 'post', '/api/checklist/tasks', dave, groupB).send({ title: 'Gruppe B Anfrage' });
      assert.equal(taskB.status, 201);
      assert.equal((await scoped(app, 'post', '/api/checklist/tasks/' + taskB.body.id + '/claim', alice, groupA).send({})).status, 404);
      // Switching her selected group to B, the same id now resolves normally.
      const claimAsB = await scoped(app, 'post', '/api/checklist/tasks/' + taskB.body.id + '/claim', alice, groupB).send({});
      assert.equal(claimAsB.status, 200, JSON.stringify(claimAsB.body));
      assert.equal(claimAsB.body.assignee.id, alice.account.id);

      // --- Finding: group admins (not just creator/assignee) moderate their own group's tasks ---
      const claimedA = await scoped(app, 'post', '/api/checklist/tasks/' + taskA.body.id + '/claim', bob, groupA).send({});
      assert.equal(claimedA.status, 409, JSON.stringify(claimedA.body), 'Bob created taskA and cannot claim his own request');
      // Re-target: have Alice (group A owner, not creator/assignee of taskA
      // which Bob created and nobody claimed yet) attempt done - must fail,
      // a task has to be taken before it can be done regardless of role.
      assert.equal((await scoped(app, 'patch', '/api/checklist/tasks/' + taskA.body.id + '/done', alice, groupA).send({})).status, 409);

      // A fresh organizer-assigned task in B, taken by Dave: Dave (assignee)
      // could mark it done himself, but here we prove the *admin* path -
      // Carol (owner of B, neither creator nor assignee) may still moderate it.
      const todoB = await scoped(app, 'post', '/api/checklist/tasks/todo', carol, groupB)
        .send({ title: 'Mehrfachsteckdosen', assigneePlayerIds: [dave.account.id] });
      assert.equal(todoB.status, 201, JSON.stringify(todoB.body));
      const todoBId = todoB.body.tasks[0].id;
      // A plain member (Alice, member-role in B) may not moderate someone
      // else's assigned task.
      const memberDoneAttempt = await scoped(app, 'patch', '/api/checklist/tasks/' + todoBId + '/done', alice, groupB).send({});
      assert.equal(memberDoneAttempt.status, 403, JSON.stringify(memberDoneAttempt.body));
      // Carol, the group owner, can.
      const ownerDone = await scoped(app, 'patch', '/api/checklist/tasks/' + todoBId + '/done', carol, groupB).send({});
      assert.equal(ownerDone.status, 200, JSON.stringify(ownerDone.body));
      assert.equal(ownerDone.body.status, 'done');

      // Same admin-moderation check for cancel (DELETE), on a fresh open task.
      const todoBOpen = await scoped(app, 'post', '/api/checklist/tasks/todo', carol, groupB).send({ title: 'Ohrstöpsel besorgen' });
      const todoBOpenId = todoBOpen.body.tasks[0].id;
      assert.equal((await scoped(app, 'delete', '/api/checklist/tasks/' + todoBOpenId, alice, groupB).send({})).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/checklist/tasks/' + todoBOpenId, dave, groupB).send({})).status, 204);
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
        MULTI_GROUPS_ENABLED: '1',
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
