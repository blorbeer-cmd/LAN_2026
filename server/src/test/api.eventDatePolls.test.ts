import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';

const app = createTestApp();

function createMember(id: string, name: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO players (id, name, color, api_key, created_at)
     VALUES (?, ?, '#4f9dff', ?, ?)`,
  ).run(id, name, `${id}-api-key`, Date.now());
  ensureDefaultGroupMembership(id);
}

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

async function createEvent(name: string, participants: string[]): Promise<string> {
  const startsAt = Date.now() + 20 * 86_400_000;
  const created = await request(app)
    .post('/api/events')
    .set('x-test-player-id', TEST_ADMIN_ID)
    .send({ name, startsAt, endsAt: startsAt + 2 * 86_400_000, location: 'Bonn' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  for (const playerId of participants) {
    const invited = await request(app)
      .post(`/api/events/${eventId}/invitations`)
      .set('x-test-player-id', TEST_ADMIN_ID)
      .send({ playerId });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    const accepted = await request(app)
      .post(`/api/events/${eventId}/invitation/accept`)
      .set('x-test-player-id', playerId);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  }
  return eventId;
}

interface PollOverrides {
  title?: string;
  responseMode?: 'feasibility' | 'single_choice' | 'multiple_choice';
  maxSelections?: number | null;
  decisionKey?: string;
  options?: Array<{ label: string }>;
  responseDueOn?: string;
}

async function createPoll(eventId: string, creatorId: string, overrides: PollOverrides = {}) {
  return request(app)
    .post(`/api/events/${eventId}/polls`)
    .set('x-test-player-id', creatorId)
    .send({
      topic: 'custom',
      title: overrides.title ?? 'Wo treffen wir uns?',
      responseMode: overrides.responseMode ?? 'feasibility',
      maxSelections: overrides.maxSelections,
      decisionKey: overrides.decisionKey,
      responseDueOn: overrides.responseDueOn ?? isoDate(5),
      options: overrides.options ?? [{ label: 'Köln' }, { label: 'Hamburg' }],
    });
}

function responsesFor(
  poll: { options: Array<{ id: string }> },
  values: Array<'can' | 'if_needed' | 'cannot'>,
) {
  return poll.options.map((option, index) => ({ optionId: option.id, response: values[index] }));
}

test('only confirmed event participants can see, create and answer polls; every participant may create one', async () => {
  const alice = 'poll-access-alice';
  const bob = 'poll-access-bob';
  const outsider = 'poll-access-outsider';
  createMember(alice, 'Poll Access Alice');
  createMember(bob, 'Poll Access Bob');
  createMember(outsider, 'Poll Access Outsider');
  const eventId = await createEvent('Poll Access Event', [alice, bob]);

  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.createdBy, alice);
  assert.deepEqual(
    created.body.invitees.map((entry: { playerId: string }) => entry.playerId).sort(),
    [alice, bob].sort(),
    'the roster is derived from accepted event participants',
  );
  const pollId = created.body.id as string;

  assert.equal(
    (await request(app).get(`/api/events/${eventId}/polls`).set('x-test-player-id', bob)).status,
    200,
  );
  assert.equal(
    (await request(app).get(`/api/events/${eventId}/polls/${pollId}`).set('x-test-player-id', outsider)).status,
    404,
  );
  assert.equal(
    (await request(app).get(`/api/events/${eventId}/polls`).set('x-test-player-id', TEST_ADMIN_ID)).status,
    404,
    'an administrator who is not a participant gets no visibility bypass',
  );
  const outsiderCreate = await createPoll(eventId, outsider, { title: 'Nicht sichtbar' });
  assert.equal(outsiderCreate.status, 404);

  const bobPoll = await createPoll(eventId, bob, { title: 'Was essen wir?', options: [{ label: 'Pizza' }, { label: 'Curry' }] });
  assert.equal(bobPoll.status, 201, JSON.stringify(bobPoll.body));
  assert.equal(bobPoll.body.createdBy, bob);

  const customInvitees = await request(app)
    .post(`/api/events/${eventId}/polls`)
    .set('x-test-player-id', alice)
    .send({
      topic: 'custom',
      title: 'Unzulässige Auswahl',
      responseMode: 'single_choice',
      responseDueOn: isoDate(5),
      options: [{ label: 'A' }, { label: 'B' }],
      inviteePlayerIds: [alice],
    });
  assert.equal(customInvitees.status, 400, 'the client cannot narrow the participant roster');
});

test('feasibility, single choice and limited multiple choice enforce their distinct response semantics', async () => {
  const alice = 'poll-modes-alice';
  const bob = 'poll-modes-bob';
  createMember(alice, 'Poll Modes Alice');
  createMember(bob, 'Poll Modes Bob');
  const eventId = await createEvent('Poll Modes Event', [alice, bob]);

  const feasibility = await createPoll(eventId, alice, { title: 'Welche Tage passen?' });
  assert.equal(feasibility.status, 201, JSON.stringify(feasibility.body));
  const partial = await request(app)
    .put(`/api/events/${eventId}/polls/${feasibility.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: [{ optionId: feasibility.body.options[0].id, response: 'can' }] });
  assert.equal(partial.status, 200, JSON.stringify(partial.body));
  assert.equal(partial.body.invitees.find((entry: { playerId: string }) => entry.playerId === bob).hasAnswered, false);
  assert.deepEqual(partial.body.myResponses, { [feasibility.body.options[0].id]: 'can' });
  assert.equal(partial.body.options[1].counts.open, 2, 'an explicit Open answer remains open and reminder-eligible');
  const rated = await request(app)
    .put(`/api/events/${eventId}/polls/${feasibility.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(feasibility.body, ['can', 'if_needed']) });
  assert.equal(rated.status, 200, JSON.stringify(rated.body));
  assert.equal(rated.body.options[0].counts.can, 1);
  assert.equal(rated.body.options[1].counts.ifNeeded, 1);
  assert.equal(rated.body.options[0].counts.open, 1, 'the creator has not rated yet');

  const single = await createPoll(eventId, alice, {
    title: 'Genau eine Küche',
    responseMode: 'single_choice',
    options: [{ label: 'Italienisch' }, { label: 'Indisch' }, { label: 'Japanisch' }],
  });
  assert.equal(single.status, 201, JSON.stringify(single.body));
  const twoSingleVotes = await request(app)
    .put(`/api/events/${eventId}/polls/${single.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(single.body, ['can', 'can', 'cannot']) });
  assert.equal(twoSingleVotes.status, 400);
  const oneSingleVote = await request(app)
    .put(`/api/events/${eventId}/polls/${single.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(single.body, ['cannot', 'can', 'cannot']) });
  assert.equal(oneSingleVote.status, 200, JSON.stringify(oneSingleVote.body));

  const multiple = await createPoll(eventId, alice, {
    title: 'Bis zu zwei Spiele',
    responseMode: 'multiple_choice',
    maxSelections: 2,
    options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
  });
  assert.equal(multiple.status, 201, JSON.stringify(multiple.body));
  assert.equal(multiple.body.maxSelections, 2);
  const noVote = await request(app)
    .put(`/api/events/${eventId}/polls/${multiple.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(multiple.body, ['cannot', 'cannot', 'cannot']) });
  assert.equal(noVote.status, 400);
  const tooMany = await request(app)
    .put(`/api/events/${eventId}/polls/${multiple.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(multiple.body, ['can', 'can', 'can']) });
  assert.equal(tooMany.status, 400);
  const twoVotes = await request(app)
    .put(`/api/events/${eventId}/polls/${multiple.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(multiple.body, ['can', 'cannot', 'can']) });
  assert.equal(twoVotes.status, 200, JSON.stringify(twoVotes.body));
});

test('poll results never modify event data or participation and the old schedule action is unavailable', async () => {
  const alice = 'poll-independent-alice';
  const bob = 'poll-independent-bob';
  createMember(alice, 'Poll Independent Alice');
  createMember(bob, 'Poll Independent Bob');
  const eventId = await createEvent('Poll Independent Event', [alice, bob]);
  const before = db
    .prepare('SELECT starts_at AS startsAt, ends_at AS endsAt, location, schedule_revision AS revision FROM events WHERE id = ?')
    .get(eventId) as { startsAt: number; endsAt: number; location: string; revision: number };

  const created = await createPoll(eventId, alice, { title: 'Welcher Ort?', responseMode: 'single_choice' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const scheduleAttempt = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/schedule`)
    .set('x-test-player-id', alice)
    .send({ optionId: created.body.options[0].id });
  assert.equal(scheduleAttempt.status, 404, 'polls expose no action that applies a result to the event');

  const decideWhileOpen = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/decide`)
    .set('x-test-player-id', alice)
    .send({ optionIds: [created.body.options[0].id] });
  assert.equal(decideWhileOpen.status, 409, 'the creator first ends voting, matching the UI workflow');
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/polls/${created.body.id}/close`).set('x-test-player-id', alice)).status,
    200,
  );
  const decided = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/decide`)
    .set('x-test-player-id', alice)
    .send({ optionIds: [created.body.options[0].id] });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));

  const afterDecision = db
    .prepare('SELECT starts_at AS startsAt, ends_at AS endsAt, location, schedule_revision AS revision FROM events WHERE id = ?')
    .get(eventId) as typeof before;
  assert.deepEqual(afterDecision, before);
  const participationBeforeChange = db
    .prepare('SELECT status, confirmed_schedule_revision AS revision FROM event_participants WHERE event_id = ? AND player_id = ?')
    .get(eventId, bob) as { status: string; revision: number };

  const changed = await request(app)
    .patch(`/api/events/${eventId}`)
    .set('x-test-player-id', TEST_ADMIN_ID)
    .send({ location: 'Berlin', startsAt: before.startsAt + 86_400_000, endsAt: before.endsAt + 86_400_000 });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.scheduleRevision, before.revision, 'editing event details does not require a fresh acceptance');
  const participationAfterChange = db
    .prepare('SELECT status, confirmed_schedule_revision AS revision FROM event_participants WHERE event_id = ? AND player_id = ?')
    .get(eventId, bob) as typeof participationBeforeChange;
  assert.deepEqual(participationAfterChange, participationBeforeChange);
  const notification = db
    .prepare("SELECT body FROM push_log WHERE title = 'Eventtermin geändert' ORDER BY created_at DESC LIMIT 1")
    .get() as { body: string };
  assert.match(notification.body, /Deine Zusage bleibt bestehen/);
});

test('rounds are numbered per poll and earlier rounds remain in history', async () => {
  const alice = 'poll-rounds-alice';
  createMember(alice, 'Poll Rounds Alice');
  const eventId = await createEvent('Poll Rounds Event', [alice]);
  const key = 'poll_round_history';

  const first = await createPoll(eventId, alice, { decisionKey: key, title: 'Unterkunft' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.roundNumber, 1);
  await request(app).post(`/api/events/${eventId}/polls/${first.body.id}/close`).set('x-test-player-id', alice);
  const firstDecision = await request(app)
    .post(`/api/events/${eventId}/polls/${first.body.id}/decide`)
    .set('x-test-player-id', alice)
    .send({ optionIds: [first.body.options[0].id] });
  assert.equal(firstDecision.status, 200, JSON.stringify(firstDecision.body));

  const unrelated = await createPoll(eventId, alice, { title: 'Unabhängige Abstimmung' });
  assert.equal(unrelated.status, 201);
  assert.equal(unrelated.body.roundNumber, 1, 'a different poll starts with its own round 1');

  const second = await createPoll(eventId, alice, {
    decisionKey: key,
    title: 'Unterkunft',
    options: [{ label: 'Haus A' }, { label: 'Haus B' }],
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.roundNumber, 2);
  await request(app).post(`/api/events/${eventId}/polls/${second.body.id}/close`).set('x-test-player-id', alice);
  const secondDecision = await request(app)
    .post(`/api/events/${eventId}/polls/${second.body.id}/decide`)
    .set('x-test-player-id', alice)
    .send({ optionIds: [second.body.options[1].id] });
  assert.equal(secondDecision.status, 200, JSON.stringify(secondDecision.body));

  const list = await request(app).get(`/api/events/${eventId}/polls`).set('x-test-player-id', alice);
  assert.equal(list.status, 200);
  const rounds = list.body.filter((poll: { decisionKey: string }) => poll.decisionKey === key);
  assert.deepEqual(rounds.map((poll: { roundNumber: number }) => poll.roundNumber), [2, 1]);
  assert.equal(rounds[0].status, 'scheduled');
  assert.equal(rounds[1].status, 'superseded');
  assert.deepEqual(rounds[0].selectedOptionIds, [second.body.options[1].id]);
});

test('manual reminders target only confirmed participants who have not answered and respect cooldown', async () => {
  const alice = 'poll-reminder-alice';
  const bob = 'poll-reminder-bob';
  const carol = 'poll-reminder-carol';
  createMember(alice, 'Poll Reminder Alice');
  createMember(bob, 'Poll Reminder Bob');
  createMember(carol, 'Poll Reminder Carol');
  const eventId = await createEvent('Poll Reminder Event', [alice, bob, carol]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  for (const playerId of [alice, bob]) {
    const answer = await request(app)
      .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
      .set('x-test-player-id', playerId)
      .send({ responses: responsesFor(created.body, ['can', 'cannot']) });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
  }
  const firstReminder = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/reminders`)
    .set('x-test-player-id', alice);
  assert.equal(firstReminder.status, 200);
  assert.deepEqual(firstReminder.body.remindedPlayerIds, [carol]);
  const secondReminder = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/reminders`)
    .set('x-test-player-id', alice);
  assert.deepEqual(secondReminder.body.remindedPlayerIds, [], 'the shared 24-hour cooldown prevents duplicate reminders');
});

test('newly accepted participants join an open poll automatically; removed participants lose access', async () => {
  const alice = 'poll-roster-alice';
  const bob = 'poll-roster-bob';
  createMember(alice, 'Poll Roster Alice');
  createMember(bob, 'Poll Roster Bob');
  const eventId = await createEvent('Poll Roster Event', [alice]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.invitees.map((entry: { playerId: string }) => entry.playerId), [alice]);

  const invitation = await request(app)
    .post(`/api/events/${eventId}/invitations`)
    .set('x-test-player-id', TEST_ADMIN_ID)
    .send({ playerId: bob });
  assert.equal(invitation.status, 201);
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitation/accept`).set('x-test-player-id', bob)).status,
    200,
  );
  const bobPoll = await request(app)
    .get(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', bob);
  assert.equal(bobPoll.status, 200, JSON.stringify(bobPoll.body));
  assert.ok(bobPoll.body.invitees.some((entry: { playerId: string }) => entry.playerId === bob));
  assert.equal(
    (await request(app)
      .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
      .set('x-test-player-id', bob)
      .send({ responses: responsesFor(created.body, ['can', 'cannot']) })).status,
    200,
  );

  const removed = await request(app)
    .delete(`/api/events/${eventId}/participants/${bob}`)
    .set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(removed.status, 204);
  assert.equal(
    (await request(app).get(`/api/events/${eventId}/polls/${created.body.id}`).set('x-test-player-id', bob)).status,
    404,
  );
});

test('only the poll creator manages a round, with accepted owner fallback after creator deactivation', async () => {
  const alice = 'poll-manager-alice';
  const bob = 'poll-manager-bob';
  createMember(alice, 'Poll Manager Alice');
  createMember(bob, 'Poll Manager Bob');
  const eventId = await createEvent('Poll Manager Event', [alice, bob, TEST_ADMIN_ID]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const bobClose = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', bob);
  assert.equal(bobClose.status, 403);
  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), alice);
  const ownerClose = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(ownerClose.status, 200, JSON.stringify(ownerClose.body));
});

test('an expired round closes lazily and idempotently on read', async () => {
  const alice = 'poll-expiry-alice';
  createMember(alice, 'Poll Expiry Alice');
  const eventId = await createEvent('Poll Expiry Event', [alice]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  db.prepare('UPDATE event_date_polls SET response_due_at = ? WHERE id = ?').run(Date.now() - 1_000, created.body.id);

  const first = await request(app).get(`/api/events/${eventId}/polls/${created.body.id}`).set('x-test-player-id', alice);
  const second = await request(app).get(`/api/events/${eventId}/polls/${created.body.id}`).set('x-test-player-id', alice);
  assert.equal(first.body.status, 'closed');
  assert.equal(second.body.status, 'closed');
  const auditCount = db
    .prepare("SELECT COUNT(*) AS count FROM admin_log WHERE action = 'event_date_poll_deadline_closed' AND target_id = ?")
    .get(created.body.id) as { count: number };
  assert.equal(auditCount.count, 1);
});
