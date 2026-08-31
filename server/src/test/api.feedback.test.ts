// Integration tests for in-app feedback (POST /api/feedback, admin-only
// GET /api/feedback): validation, automatic view/event/device capture, and
// the admin-only read gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp } from './testApp';
import { db, BASE_EVENT_ID } from '../db';

const app = createTestApp();

test('POST /api/feedback validates message, view and device', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Feedback Validation' });
  const asPlayer = (body: Record<string, unknown>) =>
    request(app).post('/api/feedback').set('x-test-player-id', player.body.id).send(body);

  assert.equal((await asPlayer({ view: 'votes', device: 'mobile' })).status, 400);
  assert.equal((await asPlayer({ message: '   ', view: 'votes', device: 'mobile' })).status, 400);
  assert.equal((await asPlayer({ message: 'x'.repeat(501), view: 'votes', device: 'mobile' })).status, 400);
  assert.equal((await asPlayer({ message: 'Hallo', device: 'mobile' })).status, 400);
  assert.equal((await asPlayer({ message: 'Hallo', view: 'votes', device: 'toaster' })).status, 400);
  assert.equal((await asPlayer({ message: 'Hallo', view: 'votes', device: 'mobile', sentiment: 'angry' })).status, 400);
});

test('POST /api/feedback accepts the problem sentiment alongside positive, negative and idea', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Feedback Problem Sentiment' });
  const created = await request(app)
    .post('/api/feedback')
    .set('x-test-player-id', player.body.id)
    .send({ message: 'Der Speichern-Button reagiert manchmal nicht.', view: 'votes', device: 'mobile', sentiment: 'problem' });
  assert.equal(created.status, 201);

  const asAdmin = await request(app).get('/api/feedback');
  const entry = (asAdmin.body as Array<Record<string, unknown>>).find((e) => e.id === created.body.id);
  assert.ok(entry, 'created feedback entry should appear in the admin listing');
  assert.equal(entry!.sentiment, 'problem');
});

test('POST /api/feedback stores the entry with automatic event context, then is only readable by admins', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Feedback Sender' });

  const created = await request(app)
    .post('/api/feedback')
    .set('x-test-player-id', player.body.id)
    .send({ message: 'Der Genre-Filter in der Abstimmung ist schwer zu finden.', view: 'votes', device: 'mobile', sentiment: 'idea' });
  assert.equal(created.status, 201);
  assert.equal(typeof created.body.id, 'string');

  const asMember = await request(app).get('/api/feedback').set('x-test-player-id', player.body.id);
  assert.equal(asMember.status, 403);

  const asAdmin = await request(app).get('/api/feedback');
  assert.equal(asAdmin.status, 200);
  const entry = (asAdmin.body as Array<Record<string, unknown>>).find((e) => e.id === created.body.id);
  assert.ok(entry, 'created feedback entry should appear in the admin listing');
  assert.equal(entry!.view, 'votes');
  assert.equal(entry!.device, 'mobile');
  assert.equal(entry!.sentiment, 'idea');
  assert.equal(entry!.eventId, BASE_EVENT_ID);
  assert.equal(entry!.playerName, 'Feedback Sender');
});

test('POST /api/feedback rejects unauthenticated requests', async () => {
  const res = await request(app)
    .post('/api/feedback')
    .set('x-test-player-id', 'unknown-player-id')
    .send({ message: 'Hallo', view: 'votes', device: 'mobile' });
  assert.equal(res.status, 401);
});

test('PATCH /api/feedback/:id lets admins complete and reopen feedback idempotently', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Feedback Completion' });
  const created = await request(app)
    .post('/api/feedback')
    .set('x-test-player-id', player.body.id)
    .send({ message: 'Bitte als erledigt markieren.', view: 'adminFeedback', device: 'desktop', sentiment: 'problem' });
  assert.equal(created.status, 201);

  const asMember = await request(app)
    .patch(`/api/feedback/${created.body.id}`)
    .set('x-test-player-id', player.body.id)
    .send({ resolved: true });
  assert.equal(asMember.status, 403);
  assert.equal((await request(app).patch(`/api/feedback/${created.body.id}`).send({ resolved: 'yes' })).status, 400);
  assert.equal((await request(app).patch('/api/feedback/unknown-feedback').send({ resolved: true })).status, 404);

  const completed = await request(app).patch(`/api/feedback/${created.body.id}`).send({ resolved: true });
  assert.equal(completed.status, 200);
  assert.equal(typeof completed.body.resolvedAt, 'number');

  const completedAgain = await request(app).patch(`/api/feedback/${created.body.id}`).send({ resolved: true });
  assert.equal(completedAgain.status, 200);
  assert.equal(completedAgain.body.resolvedAt, completed.body.resolvedAt, 'repeated completion must keep the first timestamp');

  const listed = await request(app).get('/api/feedback');
  const entry = (listed.body as Array<Record<string, unknown>>).find((item) => item.id === created.body.id);
  assert.equal(entry?.resolvedAt, completed.body.resolvedAt);

  const reopened = await request(app).patch(`/api/feedback/${created.body.id}`).send({ resolved: false });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.resolvedAt, null);
});

test('GET /api/feedback keeps open entries ahead of newer completed history before limiting', async () => {
  const openId = 'feedback-open-before-limit';
  const completedId = 'feedback-completed-before-limit';
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO feedback_entries
       (id, group_id, event_id, player_id, view, sentiment, message, device, created_at, resolved_at)
     VALUES (?, 'default-group', ?, NULL, 'adminFeedback', 'problem', ?, 'desktop', ?, ?)`,
  );

  try {
    insert.run(openId, BASE_EVENT_ID, 'Älteres offenes Feedback', now + 1_000, null);
    insert.run(completedId, BASE_EVENT_ID, 'Neueres erledigtes Feedback', now + 2_000, now + 2_000);

    const listed = await request(app).get('/api/feedback?limit=1');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, openId, 'completed history must not hide actionable feedback behind the limit');
  } finally {
    db.prepare('DELETE FROM feedback_entries WHERE id IN (?, ?)').run(openId, completedId);
  }
});

test('deleting the account cascades to its feedback entries instead of orphaning them', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Feedback Deleted Account' });
  const created = await request(app)
    .post('/api/feedback')
    .set('x-test-player-id', player.body.id)
    .send({ message: 'Wird beim Löschen des Kontos mitgelöscht.', view: 'home', device: 'desktop' });
  assert.equal(created.status, 201);

  const deleteRes = await request(app).delete(`/api/players/${player.body.id}`);
  assert.equal(deleteRes.status, 204, JSON.stringify(deleteRes.body));

  const row = db.prepare('SELECT id FROM feedback_entries WHERE id = ?').get(created.body.id);
  assert.equal(row, undefined, 'the feedback row must be deleted, not orphaned with a NULL player_id');
});
