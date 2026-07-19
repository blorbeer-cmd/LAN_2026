// Packliste: personal checklist items (Grundstock materialization, custom
// items, checked toggle, ownership) and the shared task/request pool (open
// item_request creation, organizer todo creation with/without direct
// multi-assign, claim/release/done/cancel lifecycle and ownership/role
// guards). The claim race itself gets a dedicated parallel-request test per
// DEVELOPMENT_GUIDELINES.md's race-guard rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { DEFAULT_CHECKLIST_ITEMS } from '../checklistDefaults';

const app = createApp();

let alice: { id: string };
let bob: { id: string };
let carol: { id: string };

test('setup: three players', async () => {
  alice = (await request(app).post('/api/players').send({ name: 'Packende Alice' })).body;
  bob = (await request(app).post('/api/players').send({ name: 'Packender Bob' })).body;
  carol = (await request(app).post('/api/players').send({ name: 'Packende Carol' })).body;
});

test('GET /api/checklist/items materializes the Grundstock once and is idempotent', async () => {
  const missingPlayerId = await request(app).get('/api/checklist/items');
  assert.equal(missingPlayerId.status, 400);

  const ghost = await request(app).get('/api/checklist/items?playerId=ghost');
  assert.equal(ghost.status, 404);

  const first = await request(app).get(`/api/checklist/items?playerId=${alice.id}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, DEFAULT_CHECKLIST_ITEMS.length);
  assert.ok(first.body.items.every((i: { isCustom: boolean; checked: boolean }) => !i.isCustom && !i.checked));
  const expectedLabels = DEFAULT_CHECKLIST_ITEMS.map((item) => item.label).sort((a, b) =>
    a.localeCompare(b, 'de', { sensitivity: 'base' }),
  );
  assert.deepEqual(
    first.body.items.map((item: { label: string }) => item.label),
    expectedLabels,
  );

  const second = await request(app).get(`/api/checklist/items?playerId=${alice.id}`);
  assert.equal(second.status, 200);
  assert.equal(second.body.items.length, DEFAULT_CHECKLIST_ITEMS.length);
  assert.deepEqual(
    second.body.items.map((i: { id: string }) => i.id),
    first.body.items.map((i: { id: string }) => i.id),
  );

  // Bob's list is independent of Alice's.
  const bobList = await request(app).get(`/api/checklist/items?playerId=${bob.id}`);
  assert.equal(bobList.body.items.length, DEFAULT_CHECKLIST_ITEMS.length);
});

let aliceCustomItemId: string;

test('POST /api/checklist/items adds and validates a custom item', async () => {
  const noLabel = await request(app).post('/api/checklist/items').send({ playerId: alice.id });
  assert.equal(noLabel.status, 400);

  const tooLong = await request(app).post('/api/checklist/items').send({ playerId: alice.id, label: 'x'.repeat(81) });
  assert.equal(tooLong.status, 400);

  const ghost = await request(app).post('/api/checklist/items').send({ playerId: 'ghost', label: 'Ersatzbrille' });
  assert.equal(ghost.status, 404);

  const created = await request(app).post('/api/checklist/items').send({ playerId: alice.id, label: 'Ersatzbrille' });
  assert.equal(created.status, 201);
  assert.equal(created.body.label, 'Ersatzbrille');
  assert.equal(created.body.isCustom, true);
  assert.equal(created.body.checked, false);
  aliceCustomItemId = created.body.id;

  const list = await request(app).get(`/api/checklist/items?playerId=${alice.id}`);
  assert.equal(list.body.items.length, DEFAULT_CHECKLIST_ITEMS.length + 1);
});

test('PATCH /api/checklist/items/:id toggles checked, own items only', async () => {
  const notOwner = await request(app)
    .patch(`/api/checklist/items/${aliceCustomItemId}`)
    .send({ playerId: bob.id, checked: true });
  assert.equal(notOwner.status, 403);

  const badChecked = await request(app)
    .patch(`/api/checklist/items/${aliceCustomItemId}`)
    .send({ playerId: alice.id, checked: 'yes' });
  assert.equal(badChecked.status, 400);

  const missing = await request(app).patch('/api/checklist/items/nope').send({ playerId: alice.id, checked: true });
  assert.equal(missing.status, 404);

  const checked = await request(app)
    .patch(`/api/checklist/items/${aliceCustomItemId}`)
    .send({ playerId: alice.id, checked: true });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.checked, true);
  assert.ok(checked.body.checkedAt);

  const unchecked = await request(app)
    .patch(`/api/checklist/items/${aliceCustomItemId}`)
    .send({ playerId: alice.id, checked: false });
  assert.equal(unchecked.status, 200);
  assert.equal(unchecked.body.checked, false);
  assert.equal(unchecked.body.checkedAt, null);
});

test('DELETE /api/checklist/items/:id removes an item, own items only (including default ones)', async () => {
  const notOwner = await request(app).delete(`/api/checklist/items/${aliceCustomItemId}`).send({ playerId: bob.id });
  assert.equal(notOwner.status, 403);

  const removed = await request(app).delete(`/api/checklist/items/${aliceCustomItemId}`).send({ playerId: alice.id });
  assert.equal(removed.status, 204);

  const missing = await request(app).delete(`/api/checklist/items/${aliceCustomItemId}`).send({ playerId: alice.id });
  assert.equal(missing.status, 404);

  // A default item can be removed too - the list is meant to be freely pruned.
  const list = await request(app).get(`/api/checklist/items?playerId=${alice.id}`);
  const defaultItem = list.body.items[0];
  const removedDefault = await request(app)
    .delete(`/api/checklist/items/${defaultItem.id}`)
    .send({ playerId: alice.id });
  assert.equal(removedDefault.status, 204);

  const after = await request(app).get(`/api/checklist/items?playerId=${alice.id}`);
  assert.equal(after.body.items.length, DEFAULT_CHECKLIST_ITEMS.length - 1);
});

let requestTaskId: string;

test('POST /api/checklist/tasks creates an open item_request, validated', async () => {
  const noTitle = await request(app).post('/api/checklist/tasks').send({ playerId: alice.id });
  assert.equal(noTitle.status, 400);

  const tooLongDescription = await request(app)
    .post('/api/checklist/tasks')
    .send({ playerId: alice.id, title: 'Controller', description: 'x'.repeat(301) });
  assert.equal(tooLongDescription.status, 400);

  const ghost = await request(app).post('/api/checklist/tasks').send({ playerId: 'ghost', title: 'Controller' });
  assert.equal(ghost.status, 404);

  const created = await request(app)
    .post('/api/checklist/tasks')
    .send({ playerId: alice.id, title: 'Controller mitbringen?', description: 'Für Mario Kart' });
  assert.equal(created.status, 201);
  assert.equal(created.body.type, 'item_request');
  assert.equal(created.body.status, 'open');
  assert.equal(created.body.assignee, null);
  assert.equal(created.body.createdBy.id, alice.id);
  requestTaskId = created.body.id;

  const list = await request(app).get('/api/checklist/tasks');
  assert.ok(list.body.tasks.some((t: { id: string }) => t.id === requestTaskId));
});

test('POST /api/checklist/tasks/todo creates an open organizer task without assignees', async () => {
  const noTitle = await request(app).post('/api/checklist/tasks/todo').send({ playerId: alice.id });
  assert.equal(noTitle.status, 400);

  const created = await request(app).post('/api/checklist/tasks/todo').send({ playerId: alice.id, title: 'Bierpong-Set' });
  assert.equal(created.status, 201);
  assert.equal(created.body.tasks.length, 1);
  assert.equal(created.body.tasks[0].type, 'todo');
  assert.equal(created.body.tasks[0].status, 'open');
  assert.equal(created.body.tasks[0].assignee, null);
});

test('POST /api/checklist/tasks/todo with assigneePlayerIds assigns directly and skips the pool', async () => {
  const badList = await request(app)
    .post('/api/checklist/tasks/todo')
    .send({ playerId: alice.id, title: 'Ladekabel', assigneePlayerIds: 'not-an-array' });
  assert.equal(badList.status, 400);

  const unknownAssignee = await request(app)
    .post('/api/checklist/tasks/todo')
    .send({ playerId: alice.id, title: 'Ladekabel', assigneePlayerIds: ['ghost'] });
  assert.equal(unknownAssignee.status, 404);

  const single = await request(app)
    .post('/api/checklist/tasks/todo')
    .send({ playerId: alice.id, title: 'Ladekabel', assigneePlayerIds: [bob.id] });
  assert.equal(single.status, 201);
  assert.equal(single.body.tasks.length, 1);
  assert.equal(single.body.tasks[0].status, 'taken');
  assert.equal(single.body.tasks[0].assignee.id, bob.id);
  assert.equal(single.body.tasks[0].batchId, null);

  const batch = await request(app)
    .post('/api/checklist/tasks/todo')
    .send({ playerId: alice.id, title: 'Mehrfachsteckdosen', assigneePlayerIds: [bob.id, carol.id] });
  assert.equal(batch.status, 201);
  assert.equal(batch.body.tasks.length, 2);
  assert.ok(batch.body.tasks[0].batchId);
  assert.equal(batch.body.tasks[0].batchId, batch.body.tasks[1].batchId);
  const assignees = batch.body.tasks.map((t: { assignee: { id: string } }) => t.assignee.id).sort();
  assert.deepEqual(assignees, [bob.id, carol.id].sort());
});

test('claim: cannot claim your own task/request, unknown task 404, exactly one winner on a race', async () => {
  const missing = await request(app).post('/api/checklist/tasks/nope/claim').send({ playerId: bob.id });
  assert.equal(missing.status, 404);

  const selfClaim = await request(app).post(`/api/checklist/tasks/${requestTaskId}/claim`).send({ playerId: alice.id });
  assert.equal(selfClaim.status, 409);

  const ghost = await request(app).post(`/api/checklist/tasks/${requestTaskId}/claim`).send({ playerId: 'ghost' });
  assert.equal(ghost.status, 404);

  const results = await Promise.all([
    request(app).post(`/api/checklist/tasks/${requestTaskId}/claim`).send({ playerId: bob.id }),
    request(app).post(`/api/checklist/tasks/${requestTaskId}/claim`).send({ playerId: carol.id }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);

  const winner = results.find((r) => r.status === 200)!;
  assert.equal(winner.body.status, 'taken');
  assert.ok([bob.id, carol.id].includes(winner.body.assignee.id));

  const alreadyTaken = await request(app).post(`/api/checklist/tasks/${requestTaskId}/claim`).send({ playerId: alice.id });
  assert.equal(alreadyTaken.status, 409);
});

test('release: only the assignee can release, back to the open pool', async () => {
  const task = (await request(app).get('/api/checklist/tasks')).body.tasks.find((t: { id: string }) => t.id === requestTaskId);
  const assigneeId = task.assignee.id;
  const otherId = assigneeId === bob.id ? carol.id : bob.id;

  const notAssignee = await request(app).post(`/api/checklist/tasks/${requestTaskId}/release`).send({ playerId: otherId });
  assert.equal(notAssignee.status, 403);

  const released = await request(app).post(`/api/checklist/tasks/${requestTaskId}/release`).send({ playerId: assigneeId });
  assert.equal(released.status, 200);
  assert.equal(released.body.status, 'open');
  assert.equal(released.body.assignee, null);

  const alreadyOpen = await request(app).post(`/api/checklist/tasks/${requestTaskId}/release`).send({ playerId: assigneeId });
  assert.equal(alreadyOpen.status, 403);
});

test('done: only assignee/creator/admin, requires a taken task, then locks further changes', async () => {
  const claimed = await request(app).post(`/api/checklist/tasks/${requestTaskId}/claim`).send({ playerId: bob.id });
  assert.equal(claimed.status, 200);

  const notAllowed = await request(app).patch(`/api/checklist/tasks/${requestTaskId}/done`).send({ playerId: carol.id });
  assert.equal(notAllowed.status, 403);

  const missing = await request(app).patch('/api/checklist/tasks/nope/done').send({ playerId: bob.id });
  assert.equal(missing.status, 404);

  const done = await request(app).patch(`/api/checklist/tasks/${requestTaskId}/done`).send({ playerId: bob.id });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'done');
  assert.ok(done.body.doneAt);

  const alreadyDone = await request(app).patch(`/api/checklist/tasks/${requestTaskId}/done`).send({ playerId: bob.id });
  assert.equal(alreadyDone.status, 409);

  const releaseAfterDone = await request(app).post(`/api/checklist/tasks/${requestTaskId}/release`).send({ playerId: bob.id });
  assert.equal(releaseAfterDone.status, 409);
});

test('cancel (DELETE): creator/admin only, blocked once done, not re-cancellable', async () => {
  const created = await request(app)
    .post('/api/checklist/tasks')
    .send({ playerId: alice.id, title: 'Wird storniert' });
  const cancelTaskId = created.body.id;

  const notAllowed = await request(app).delete(`/api/checklist/tasks/${cancelTaskId}`).send({ playerId: bob.id });
  assert.equal(notAllowed.status, 403);

  const missing = await request(app).delete('/api/checklist/tasks/nope').send({ playerId: alice.id });
  assert.equal(missing.status, 404);

  const cancelled = await request(app).delete(`/api/checklist/tasks/${cancelTaskId}`).send({ playerId: alice.id });
  assert.equal(cancelled.status, 204);

  const secondCancel = await request(app).delete(`/api/checklist/tasks/${cancelTaskId}`).send({ playerId: alice.id });
  assert.equal(secondCancel.status, 409);

  const list = await request(app).get('/api/checklist/tasks');
  assert.ok(!list.body.tasks.some((t: { id: string }) => t.id === cancelTaskId));

  const doneAlready = await request(app).patch(`/api/checklist/tasks/${requestTaskId}/done`).send({ playerId: bob.id });
  assert.equal(doneAlready.status, 409);
  const cancelDoneTask = await request(app).delete(`/api/checklist/tasks/${requestTaskId}`).send({ playerId: alice.id });
  assert.equal(cancelDoneTask.status, 409);
});
