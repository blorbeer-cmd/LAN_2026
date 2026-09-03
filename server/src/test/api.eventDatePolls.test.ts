import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { BASE_EVENT_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { advanceAutomaticReminder, dueAutomaticReminders } from '../eventDatePolls';
import { ensureAccountEventContext } from '../eventContext';
import { runEventDatePollReminderSweepOnce } from '../eventDatePollReminders';
import { Events, setIo } from '../realtime';
import { PUSH_LOG_LIMIT } from '../push';

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
  responseMode?: 'feasibility' | 'single_choice' | 'multiple_choice' | 'rating_1_5';
  maxSelections?: number | null;
  decisionKey?: string;
  previousPollId?: string;
  options?: Array<{ label: string; description?: string; payload?: { url?: string } }>;
  // undefined (the default) picks a 5-days-out deadline; explicit null omits
  // the field entirely so tests can exercise an open-ended poll.
  responseDueOn?: string | null;
  anonymous?: boolean;
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
      previousPollId: overrides.previousPollId,
      responseDueOn: overrides.responseDueOn === undefined ? isoDate(5) : overrides.responseDueOn,
      anonymous: overrides.anonymous,
      options: overrides.options ?? [{ label: 'Köln' }, { label: 'Hamburg' }],
    });
}

function responsesFor(
  poll: { options: Array<{ id: string }> },
  values: Array<'can' | 'if_needed' | 'cannot' | '1' | '2' | '3' | '4' | '5'>,
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

test('the permanent base event can host polls, visible to every accepted base participant', async () => {
  const alice = 'poll-base-alice';
  const bob = 'poll-base-bob';
  createMember(alice, 'Poll Base Alice');
  createMember(bob, 'Poll Base Bob');
  // Every active account is auto-accepted into the base event on login/registration
  // (ensureAccountEventContext/ensureBaseParticipation); this mirrors that runtime
  // path instead of relying on incidental setup order in earlier tests.
  ensureAccountEventContext(alice, BASE_EVENT_ID);
  ensureAccountEventContext(bob, BASE_EVENT_ID);

  const created = await createPoll(BASE_EVENT_ID, alice, { title: 'Allgemeine Basis-Abstimmung' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.createdBy, alice);
  assert.ok(
    created.body.invitees.map((entry: { playerId: string }) => entry.playerId).includes(bob),
    'the base event roster includes every other accepted base participant, not just the creator',
  );
  const pollId = created.body.id as string;

  assert.equal(
    (await request(app).get(`/api/events/${BASE_EVENT_ID}/polls/${pollId}`).set('x-test-player-id', bob)).status,
    200,
  );
});

test('polls accept one option and grow beyond the former eight-option cap', async () => {
  const alice = 'poll-option-count-alice';
  createMember(alice, 'Poll Option Count Alice');
  const eventId = await createEvent('Poll Option Count Event', [alice]);

  const singleOption = await createPoll(eventId, alice, {
    title: 'Eine Möglichkeit',
    options: [{ label: 'Nur diese' }],
  });
  assert.equal(singleOption.status, 201, JSON.stringify(singleOption.body));
  assert.equal(singleOption.body.options.length, 1);

  const expandedOptions = [
    { id: singleOption.body.options[0].id, label: 'Nur diese' },
    ...Array.from({ length: 9 }, (_, index) => ({ label: `Ergänzung ${index + 1}` })),
  ];
  const expanded = await request(app)
    .patch(`/api/events/${eventId}/polls/${singleOption.body.id}`)
    .set('x-test-player-id', alice)
    .send({ options: expandedOptions });
  assert.equal(expanded.status, 200, JSON.stringify(expanded.body));
  assert.equal(expanded.body.options.length, 10);

  const manyOptions = await createPoll(eventId, alice, {
    title: 'Viele Möglichkeiten',
    responseMode: 'multiple_choice',
    maxSelections: 9,
    options: Array.from({ length: 12 }, (_, index) => ({ label: `Möglichkeit ${index + 1}` })),
  });
  assert.equal(manyOptions.status, 201, JSON.stringify(manyOptions.body));
  assert.equal(manyOptions.body.options.length, 12);
  assert.equal(manyOptions.body.maxSelections, 9);
});

test('feasibility, choice and 1-5 rating modes enforce their distinct response semantics', async () => {
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

  const rating = await createPoll(eventId, alice, {
    title: 'Unterkünfte bewerten',
    responseMode: 'rating_1_5',
    options: [
      { label: 'Haus am See', description: 'Mit Sauna', payload: { url: 'https://example.com/haus' } },
      { label: 'Hütte im Wald' },
    ],
  });
  assert.equal(rating.status, 201, JSON.stringify(rating.body));
  assert.equal(rating.body.options[0].description, 'Mit Sauna');
  assert.equal(rating.body.options[0].payload.url, 'https://example.com/haus');
  const wrongRatingValue = await request(app)
    .put(`/api/events/${eventId}/polls/${rating.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(rating.body, ['can', '5']) });
  assert.equal(wrongRatingValue.status, 400);
  const incompleteRating = await request(app)
    .put(`/api/events/${eventId}/polls/${rating.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: [{ optionId: rating.body.options[0].id, response: '5' }] });
  assert.equal(incompleteRating.status, 400);
  const completeRating = await request(app)
    .put(`/api/events/${eventId}/polls/${rating.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(rating.body, ['5', '3']) });
  assert.equal(completeRating.status, 200, JSON.stringify(completeRating.body));
  assert.equal(completeRating.body.options[0].counts.ratings['5'], 1);
  assert.equal(completeRating.body.options[0].counts.average, 5);
  assert.equal(completeRating.body.options[0].isRecommended, true);

  const unsafeLink = await createPoll(eventId, alice, {
    title: 'Ungültiger Link',
    options: [{ label: 'Unsicher', payload: { url: 'javascript:alert(1)' } }, { label: 'Sicher' }],
  });
  assert.equal(unsafeLink.status, 400);
});

test('voter identities appear only after a non-anonymous poll has ended', async () => {
  const alice = 'poll-privacy-alice';
  const bob = 'poll-privacy-bob';
  createMember(alice, 'Poll Privacy Alice');
  createMember(bob, 'Poll Privacy Bob');
  const eventId = await createEvent('Poll Privacy Event', [alice, bob]);

  const publicPoll = await createPoll(eventId, alice, {
    title: 'Nicht anonyme Abstimmung',
    responseMode: 'single_choice',
  });
  assert.equal(publicPoll.status, 201, JSON.stringify(publicPoll.body));
  const publicAnswer = await request(app)
    .put(`/api/events/${eventId}/polls/${publicPoll.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(publicPoll.body, ['can', 'cannot']) });
  assert.equal(publicAnswer.status, 200, JSON.stringify(publicAnswer.body));
  assert.equal(publicAnswer.body.responseDetailsVisible, false);
  assert.deepEqual(publicAnswer.body.options[0].people.can, [], 'an open poll never reveals voter identities');
  assert.deepEqual(publicAnswer.body.myResponses, { [publicPoll.body.options[0].id]: 'can', [publicPoll.body.options[1].id]: 'cannot' });

  const closedPublicPoll = await request(app)
    .post(`/api/events/${eventId}/polls/${publicPoll.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closedPublicPoll.status, 200, JSON.stringify(closedPublicPoll.body));
  assert.equal(closedPublicPoll.body.responseDetailsVisible, true);
  assert.deepEqual(
    closedPublicPoll.body.options[0].people.can.map((person: { playerId: string }) => person.playerId),
    [bob],
  );
  assert.equal(typeof closedPublicPoll.body.options[0].people.can[0].updatedAt, 'number');

  const anonymousPoll = await createPoll(eventId, alice, {
    title: 'Anonyme Abstimmung',
    responseMode: 'single_choice',
    anonymous: true,
  });
  assert.equal(anonymousPoll.status, 201, JSON.stringify(anonymousPoll.body));
  assert.equal(anonymousPoll.body.anonymous, true);
  const anonymousAnswer = await request(app)
    .put(`/api/events/${eventId}/polls/${anonymousPoll.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(anonymousPoll.body, ['cannot', 'can']) });
  assert.equal(anonymousAnswer.status, 200, JSON.stringify(anonymousAnswer.body));
  assert.deepEqual(anonymousAnswer.body.myResponses, {
    [anonymousPoll.body.options[0].id]: 'cannot',
    [anonymousPoll.body.options[1].id]: 'can',
  }, 'participants can still edit their own anonymous response while voting is open');

  const closedAnonymousPoll = await request(app)
    .post(`/api/events/${eventId}/polls/${anonymousPoll.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closedAnonymousPoll.status, 200, JSON.stringify(closedAnonymousPoll.body));
  assert.equal(closedAnonymousPoll.body.responseDetailsVisible, false);
  assert.equal(closedAnonymousPoll.body.myResponses, null);
  assert.deepEqual(closedAnonymousPoll.body.options[1].people.can, []);

  const invalidAnonymous = await request(app)
    .post(`/api/events/${eventId}/polls`)
    .set('x-test-player-id', alice)
    .send({
      topic: 'custom',
      title: 'Ungültige Anonymität',
      responseMode: 'single_choice',
      anonymous: 'ja',
      responseDueOn: isoDate(5),
      options: [{ label: 'A' }, { label: 'B' }],
    });
  assert.equal(invalidAnonymous.status, 400);
});

test('ending a poll exposes its result without a separate decision action or event side effects', async () => {
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
  assert.equal(decideWhileOpen.status, 404, 'the separate result-recording endpoint no longer exists');
  const closed = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.status, 'closed');
  assert.ok(closed.body.options.every((option: { counts: object }) => option.counts), 'the closed response is the result overview');
  assert.equal(closed.body.selectedOptionIds, undefined, 'legacy result-selection fields are not part of the poll API');
  const decideAfterClose = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/decide`)
    .set('x-test-player-id', alice)
    .send({ optionIds: [created.body.options[0].id] });
  assert.equal(decideAfterClose.status, 404);

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
  const key = 'Poll_Round_History';

  const first = await createPoll(eventId, alice, { decisionKey: key, title: 'Unterkunft' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.roundNumber, 1);
  await request(app).post(`/api/events/${eventId}/polls/${first.body.id}/close`).set('x-test-player-id', alice);

  const unrelated = await createPoll(eventId, alice, { title: 'Unabhängige Abstimmung' });
  assert.equal(unrelated.status, 201);
  assert.equal(unrelated.body.roundNumber, 1, 'a different poll starts with its own round 1');

  const second = await createPoll(eventId, alice, {
    previousPollId: first.body.id,
    title: 'Unterkunft',
    options: [{ label: 'Haus A' }, { label: 'Haus B' }],
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.roundNumber, 2);
  await request(app).post(`/api/events/${eventId}/polls/${second.body.id}/close`).set('x-test-player-id', alice);

  const list = await request(app).get(`/api/events/${eventId}/polls`).set('x-test-player-id', alice);
  assert.equal(list.status, 200);
  const rounds = list.body.filter((poll: { decisionKey: string }) => poll.decisionKey === key);
  assert.deepEqual(rounds.map((poll: { roundNumber: number }) => poll.roundNumber), [2, 1]);
  assert.equal(rounds[0].status, 'closed');
  assert.equal(rounds[1].status, 'closed');
});

test('only a series manager can repeat it, legacy ended states reopen, and deleting removes every round', async () => {
  const alice = 'poll-lifecycle-alice';
  const bob = 'poll-lifecycle-bob';
  createMember(alice, 'Poll Lifecycle Alice');
  createMember(bob, 'Poll Lifecycle Bob');
  const eventId = await createEvent('Poll Lifecycle Event', [alice, bob]);
  const first = await createPoll(eventId, alice, { decisionKey: 'Legacy_Key_AbC', title: 'Gemeinsames Ziel' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await request(app).post(`/api/events/${eventId}/polls/${first.body.id}/close`).set('x-test-player-id', alice)).status, 200);

  const forbiddenRepeat = await createPoll(eventId, bob, { previousPollId: first.body.id, title: 'Fremde Wiederholung' });
  assert.equal(forbiddenRepeat.status, 403);
  const second = await createPoll(eventId, alice, { previousPollId: first.body.id, title: 'Gemeinsames Ziel' });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.decisionKey, 'Legacy_Key_AbC');
  assert.equal(second.body.roundNumber, 2);
  const reopenOldRound = await request(app)
    .post(`/api/events/${eventId}/polls/${first.body.id}/reopen`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: isoDate(7) });
  assert.equal(reopenOldRound.status, 409, 'only the latest round can be reopened');
  assert.equal((await request(app).post(`/api/events/${eventId}/polls/${second.body.id}/close`).set('x-test-player-id', alice)).status, 200);

  db.prepare("UPDATE event_date_polls SET status = 'scheduled' WHERE id = ?").run(second.body.id);
  const reopenedLegacy = await request(app)
    .post(`/api/events/${eventId}/polls/${second.body.id}/reopen`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: isoDate(7) });
  assert.equal(reopenedLegacy.status, 200, JSON.stringify(reopenedLegacy.body));
  assert.equal(reopenedLegacy.body.status, 'open');

  const forbiddenDelete = await request(app)
    .delete(`/api/events/${eventId}/polls/${second.body.id}`)
    .set('x-test-player-id', bob);
  assert.equal(forbiddenDelete.status, 403);
  const deleted = await request(app)
    .delete(`/api/events/${eventId}/polls/${second.body.id}`)
    .set('x-test-player-id', alice);
  assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
  const rows = db.prepare('SELECT id FROM event_date_polls WHERE event_id = ? AND decision_key = ?').all(eventId, 'Legacy_Key_AbC');
  assert.deepEqual(rows, []);
});

test('an open poll can update option notes and links, add options and notify only previous voters', async () => {
  const alice = 'poll-edit-alice';
  const bob = 'poll-edit-bob';
  const carol = 'poll-edit-carol';
  createMember(alice, 'Poll Edit Alice');
  createMember(bob, 'Poll Edit Bob');
  createMember(carol, 'Poll Edit Carol');
  const eventId = await createEvent('Poll Edit Event', [alice, bob, carol]);
  const created = await createPoll(eventId, alice, { responseMode: 'single_choice' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bobAnswer = await request(app)
    .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(created.body, ['can', 'cannot']) });
  assert.equal(bobAnswer.status, 200, JSON.stringify(bobAnswer.body));

  const editPayload = {
    title: 'Bearbeitete Abstimmung',
    note: 'Mehr Kontext',
    responseDueOn: isoDate(6),
    options: [
      {
        id: created.body.options[0].id,
        label: 'Köln',
        description: 'Zentral gelegen',
        payload: { url: 'https://example.com/koeln' },
      },
      { id: created.body.options[1].id, label: 'Hamburg', description: null, payload: {} },
      { label: 'Bremen', description: 'Neue Möglichkeit', payload: { url: 'https://example.com/bremen' } },
    ],
  };
  const forbidden = await request(app)
    .patch(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', bob)
    .send(editPayload);
  assert.equal(forbidden.status, 403);
  const edited = await request(app)
    .patch(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', alice)
    .send(editPayload);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.title, 'Bearbeitete Abstimmung');
  assert.equal(edited.body.note, 'Mehr Kontext');
  assert.equal(edited.body.options.length, 3);
  assert.equal(edited.body.options[0].description, 'Zentral gelegen');
  assert.equal(edited.body.options[0].payload.url, 'https://example.com/koeln');
  assert.equal(edited.body.invitees.find((entry: { playerId: string }) => entry.playerId === bob).hasAnswered, false);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key = ?').get(`event-poll-updated:${created.body.id}:${bob}`) as { count: number }).count,
    1,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM push_log WHERE topic_key LIKE ?").get(`event-poll-updated:${created.body.id}:%`) as { count: number }).count,
    1,
    'the creator and participants who had not voted receive no edit notification',
  );

  const missingExistingOption = await request(app)
    .patch(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', alice)
    .send({ options: editPayload.options.slice(0, 2) });
  assert.equal(missingExistingOption.status, 400, 'editing cannot silently delete an option with response history');
  const removedOptionAttempt = await request(app)
    .delete(`/api/events/${eventId}/polls/${created.body.id}/options/${created.body.options[0].id}`)
    .set('x-test-player-id', alice);
  assert.equal(removedOptionAttempt.status, 404, 'the legacy option-removal endpoint cannot bypass edit integrity');
  await request(app).post(`/api/events/${eventId}/polls/${created.body.id}/close`).set('x-test-player-id', alice);
  const editClosed = await request(app)
    .patch(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', alice)
    .send({ note: 'Zu spät' });
  assert.equal(editClosed.status, 409);
});

test('concurrent option additions can grow a poll beyond the former eight-option cap', async () => {
  const alice = 'poll-edit-race-alice';
  createMember(alice, 'Poll Edit Race Alice');
  const eventId = await createEvent('Poll Edit Race Event', [alice]);
  const created = await createPoll(eventId, alice, {
    options: Array.from({ length: 8 }, (_, index) => ({ label: `Option ${index + 1}` })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const responses = await Promise.all([
    request(app)
      .post(`/api/events/${eventId}/polls/${created.body.id}/options`)
      .set('x-test-player-id', alice)
      .send({ label: 'Option A' }),
    request(app)
      .post(`/api/events/${eventId}/polls/${created.body.id}/options`)
      .set('x-test-player-id', alice)
      .send({ label: 'Option B' }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 201]);
  const current = await request(app).get(`/api/events/${eventId}/polls/${created.body.id}`).set('x-test-player-id', alice);
  assert.equal(current.body.options.length, 10);
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
  const topicKey = `event-poll-reminder:${created.body.id}:${carol}`;
  const firstPush = db
    .prepare('SELECT id, created_at AS createdAt FROM push_log WHERE topic_key = ?')
    .get(topicKey) as { id: string; createdAt: number };
  assert.ok(firstPush);
  const secondReminder = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/reminders`)
    .set('x-test-player-id', alice);
  assert.deepEqual(secondReminder.body.remindedPlayerIds, [], 'the shared 24-hour cooldown prevents duplicate reminders');

  db.prepare('UPDATE event_date_poll_invitees SET last_reminder_at = NULL WHERE poll_id = ? AND player_id = ?').run(
    created.body.id,
    carol,
  );
  db.prepare('UPDATE push_log SET created_at = 1 WHERE id = ?').run(firstPush.id);
  const repeatedReminder = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/reminders`)
    .set('x-test-player-id', alice);
  assert.deepEqual(repeatedReminder.body.remindedPlayerIds, [carol]);
  const repeatedPushes = db
    .prepare('SELECT id, created_at AS createdAt FROM push_log WHERE topic_key = ?')
    .all(topicKey) as Array<{ id: string; createdAt: number }>;
  assert.equal(repeatedPushes.length, 1, 'repeated poll reminders reuse one notification-center entry');
  assert.equal(repeatedPushes[0].id, firstPush.id);
  assert.ok(repeatedPushes[0].createdAt > 1, 'the existing reminder rises to the top');
});

// Regression for a notification-center gap: "Neue Abstimmung" used to carry
// no topic key at all, so closing the poll could never resolve it - it sat
// in a returning player's history looking exactly as actionable as it did
// the day the poll opened. Reopening must give the reused topic key a fresh,
// unresolved occurrence rather than leaving it stuck resolved from the
// earlier close.
test('closing a poll resolves its "Neue Abstimmung" notification; reopening reactivates it', async () => {
  const alice = 'poll-open-notify-alice';
  const bob = 'poll-open-notify-bob';
  createMember(alice, 'Poll Open Notify Alice');
  createMember(bob, 'Poll Open Notify Bob');
  const eventId = await createEvent('Poll Open Notify Event', [alice, bob]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const topicKey = `event-poll-open:${created.body.id}:${bob}`;

  const openLog = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const openEntry = openLog.body.entries.find((entry: { title: string }) => entry.title === 'Neue Abstimmung');
  assert.ok(openEntry, 'bob was notified about the new poll');
  assert.equal(openEntry.resolvedAt, null);

  const closed = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const afterClose = db
    .prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ? AND resolved_at IS NOT NULL')
    .get(topicKey) as { resolvedAt: number } | undefined;
  assert.ok(afterClose, 'bob\'s "Neue Abstimmung" topic is resolved once the poll closes');
  const closedLog = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const closedEntry = closedLog.body.entries.find((entry: { id: string }) => entry.id === openEntry.id);
  assert.ok(closedEntry.resolvedAt, 'the notification center entry itself now reflects the resolution');

  const reopened = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/reopen`)
    .set('x-test-player-id', alice)
    .send({});
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  const reopenLog = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const reopenEntry = reopenLog.body.entries.find((entry: { title: string }) => entry.title === 'Abstimmung');
  assert.ok(reopenEntry, 'bob was notified the poll reopened');
  assert.equal(reopenEntry.resolvedAt, null, 'the reopened poll is actionable again, not stuck resolved');
  // The topic is deduplicated (isDeduplicatedPushTopic in push.ts), so the
  // reopen reuses and refreshes the same row instead of leaving the earlier,
  // now-resolved one behind as a second, permanently-obsolete entry.
  assert.equal(reopenEntry.id, openEntry.id, 'reopening reuses the same notification-center entry');
  const rowCountAfterReopen = db
    .prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key = ?')
    .get(topicKey) as { count: number };
  assert.equal(rowCountAfterReopen.count, 1, 'exactly one row backs the poll-open topic, not one per occurrence');

  const closedAgain = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closedAgain.status, 200, JSON.stringify(closedAgain.body));
  const finalLog = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const finalEntries = finalLog.body.entries.filter((entry: { id: string }) => entry.id === openEntry.id);
  assert.equal(finalEntries.length, 1, 'still exactly one entry for this poll after a second close');
  assert.ok(finalEntries[0].resolvedAt, 'and it is resolved again');
});

test('reopening a poll never rewrites a since-muted recipient\'s earlier notification', async () => {
  const alice = 'poll-reopen-recipients-alice';
  const bob = 'poll-reopen-recipients-bob';
  const carol = 'poll-reopen-recipients-carol';
  createMember(alice, 'Poll Reopen Recipients Alice');
  createMember(bob, 'Poll Reopen Recipients Bob');
  createMember(carol, 'Poll Reopen Recipients Carol');
  const eventId = await createEvent('Poll Reopen Recipients Event', [alice, bob, carol]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bobTopicKey = `event-poll-open:${created.body.id}:${bob}`;
  const carolTopicKey = `event-poll-open:${created.body.id}:${carol}`;

  const bobOpenLog = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const openEntry = bobOpenLog.body.entries.find((entry: { title: string }) => entry.title === 'Neue Abstimmung');
  assert.ok(openEntry, 'bob was notified about the new poll');

  const closed = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));

  // Bob mutes this event's notifications before the poll reopens - he stays
  // an accepted participant, so the reopen route still lists him as an
  // invitee, but push.ts's mute filter drops him from the actually-eligible
  // recipients this occurrence reaches.
  const group = db.prepare('SELECT id FROM groups LIMIT 1').get() as { id: string };
  db.prepare('INSERT INTO push_mutes (group_id, player_id, event_id, muted_at) VALUES (?, ?, ?, ?)').run(
    group.id,
    bob,
    eventId,
    Date.now(),
  );

  const reopened = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/reopen`)
    .set('x-test-player-id', alice)
    .send({});
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));

  // Each recipient keys to their own row (pollOpenTopicKey includes the
  // playerId), so an occurrence that skips bob cannot touch his row at all -
  // unlike a single row shared across recipients, which would either drop
  // him or rewrite his settled history into a reopening he never received.
  const bobRowAfterReopen = db
    .prepare('SELECT resolved_at AS resolvedAt, title FROM push_log WHERE topic_key = ?')
    .get(bobTopicKey) as { resolvedAt: number | null; title: string };
  assert.ok(bobRowAfterReopen.resolvedAt, 'bob\'s original notice is still resolved, not reactivated by an occurrence he was muted out of');
  assert.equal(bobRowAfterReopen.title, 'Neue Abstimmung', 'and its content still reflects what bob actually received');

  const carolRowAfterReopen = db
    .prepare('SELECT resolved_at AS resolvedAt, title FROM push_log WHERE topic_key = ?')
    .get(carolTopicKey) as { resolvedAt: number | null; title: string };
  assert.equal(carolRowAfterReopen.resolvedAt, null, 'carol is still eligible and reached by the reopen notice');
  assert.equal(carolRowAfterReopen.title, 'Abstimmung');

  const bobLogAfterReopen = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const bobEntryAfterReopen = bobLogAfterReopen.body.entries.find((entry: { id: string }) => entry.id === openEntry.id);
  assert.ok(bobEntryAfterReopen, 'bob still sees his original notification-center entry after the reopen');
  assert.ok(bobEntryAfterReopen.resolvedAt, 'and it still reads as resolved, matching the row it is backed by');
});

test('creating a poll invites everyone with one push-log row per recipient, well within the shared group cap', async () => {
  const alice = 'poll-burst-alice';
  const invitees = Array.from({ length: 10 }, (_, index) => `poll-burst-invitee-${index}`);
  createMember(alice, 'Poll Burst Alice');
  for (const id of invitees) createMember(id, `Poll Burst Invitee ${id}`);
  const eventId = await createEvent('Poll Burst Event', [alice, ...invitees]);

  const group = db.prepare('SELECT id FROM groups LIMIT 1').get() as { id: string };
  const beforeCount = (
    db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE group_id = ?').get(group.id) as { count: number }
  ).count;

  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const afterCount = (
    db.prepare('SELECT COUNT(*) AS count FROM push_log WHERE group_id = ?').get(group.id) as { count: number }
  ).count;
  assert.equal(
    afterCount - beforeCount,
    invitees.length,
    'one push_log row per invited recipient - the per-recipient topic keys (pollOpenTopicKey) that fix the ' +
      'reopen/expiry findings above trade a single shared row for one per invitee',
  );
  const ownRows = db
    .prepare('SELECT COUNT(*) AS count FROM push_log WHERE topic_key LIKE ?')
    .get(`event-poll-open:${created.body.id}:%`) as { count: number };
  assert.equal(ownRows.count, invitees.length);

  // PUSH_LOG_LIMIT is the shared history budget for the whole group across
  // every notification type. It must stay comfortably above what a single
  // full-group poll invite/reopen burst consumes, or that burst would evict
  // other players' unrelated recent history (event invitations, food-order
  // reminders, ...) out of the notification center.
  assert.ok(
    PUSH_LOG_LIMIT >= invitees.length * 10,
    'the shared cap has headroom for several poll-sized bursts, not just a single one',
  );
});

test('extending a poll\'s deadline keeps its "Neue Abstimmung" notification from expiring early', async () => {
  const alice = 'poll-expiry-sync-alice';
  const bob = 'poll-expiry-sync-bob';
  createMember(alice, 'Poll Expiry Sync Alice');
  createMember(bob, 'Poll Expiry Sync Bob');
  const eventId = await createEvent('Poll Expiry Sync Event', [alice, bob]);
  const created = await createPoll(eventId, alice, { responseDueOn: isoDate(2) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const topicKey = `event-poll-open:${created.body.id}:${bob}`;

  const before = db
    .prepare('SELECT expires_at AS expiresAt FROM push_log WHERE topic_key = ?')
    .get(topicKey) as { expiresAt: number };
  assert.equal(before.expiresAt, created.body.responseDueAt);

  const extendedDueOn = isoDate(10);
  const patched = await request(app)
    .patch(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: extendedDueOn });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.ok(patched.body.responseDueAt > before.expiresAt, 'the deadline actually moved further out');

  const after = db
    .prepare('SELECT expires_at AS expiresAt FROM push_log WHERE topic_key = ?')
    .get(topicKey) as { expiresAt: number };
  assert.equal(
    after.expiresAt,
    patched.body.responseDueAt,
    'the notification\'s own expiry follows the extended deadline, so it does not read as obsolete before the poll actually closes',
  );

  const log = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const entry = log.body.entries.find((item: { title: string }) => item.title === 'Neue Abstimmung');
  assert.ok(entry);
  assert.equal(entry.expiresAt, patched.body.responseDueAt);
});

test('extending a poll\'s deadline also keeps an outstanding "Abstimmung ergänzt" notice from expiring early', async () => {
  const alice = 'poll-update-expiry-sync-alice';
  const bob = 'poll-update-expiry-sync-bob';
  createMember(alice, 'Poll Update Expiry Sync Alice');
  createMember(bob, 'Poll Update Expiry Sync Bob');
  const eventId = await createEvent('Poll Update Expiry Sync Event', [alice, bob]);
  const created = await createPoll(eventId, alice, { responseDueOn: isoDate(2) });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const answered = await request(app)
    .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(created.body, ['can', 'if_needed']) });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));

  const addedOption = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/options`)
    .set('x-test-player-id', alice)
    .send({ label: 'Berlin' });
  assert.equal(addedOption.status, 201, JSON.stringify(addedOption.body));
  const updateTopicKey = `event-poll-updated:${created.body.id}:${bob}`;

  const before = db
    .prepare('SELECT expires_at AS expiresAt FROM push_log WHERE topic_key = ?')
    .get(updateTopicKey) as { expiresAt: number };
  assert.equal(
    before.expiresAt,
    created.body.responseDueAt,
    'bob was notified about the added option, expiring with the original deadline',
  );

  const extendedDueOn = isoDate(10);
  const patched = await request(app)
    .patch(`/api/events/${eventId}/polls/${created.body.id}`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: extendedDueOn });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.ok(patched.body.responseDueAt > before.expiresAt, 'the deadline actually moved further out');

  const after = db
    .prepare('SELECT expires_at AS expiresAt FROM push_log WHERE topic_key = ?')
    .get(updateTopicKey) as { expiresAt: number };
  assert.equal(
    after.expiresAt,
    patched.body.responseDueAt,
    'the outstanding "Abstimmung ergänzt" notice follows the extended deadline too, so it does not read as ' +
      'obsolete while bob\'s response to the added option is still outstanding',
  );

  const log = await request(app).get('/api/push/log').set('x-test-player-id', bob).query({ playerId: bob });
  const entry = log.body.entries.find((item: { title: string }) => item.title === 'Abstimmung ergänzt');
  assert.ok(entry);
  assert.equal(entry.expiresAt, patched.body.responseDueAt);
});

test('an "Abstimmung ergänzt" notice resolves once completed, or once the poll closes for anyone still outstanding', async () => {
  const alice = 'poll-update-resolve-alice';
  const bob = 'poll-update-resolve-bob';
  const carol = 'poll-update-resolve-carol';
  createMember(alice, 'Poll Update Resolve Alice');
  createMember(bob, 'Poll Update Resolve Bob');
  createMember(carol, 'Poll Update Resolve Carol');
  const eventId = await createEvent('Poll Update Resolve Event', [alice, bob, carol]);
  const created = await createPoll(eventId, alice);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  for (const playerId of [bob, carol]) {
    const answered = await request(app)
      .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
      .set('x-test-player-id', playerId)
      .send({ responses: responsesFor(created.body, ['can', 'if_needed']) });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
  }

  const addedOption = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/options`)
    .set('x-test-player-id', alice)
    .send({ label: 'Berlin' });
  assert.equal(addedOption.status, 201, JSON.stringify(addedOption.body));
  const bobUpdateTopicKey = `event-poll-updated:${created.body.id}:${bob}`;
  const carolUpdateTopicKey = `event-poll-updated:${created.body.id}:${carol}`;

  const bothOutstanding = db
    .prepare('SELECT topic_key AS topicKey, resolved_at AS resolvedAt FROM push_log WHERE topic_key IN (?, ?)')
    .all(bobUpdateTopicKey, carolUpdateTopicKey) as Array<{ topicKey: string; resolvedAt: number | null }>;
  assert.equal(bothOutstanding.length, 2);
  assert.ok(bothOutstanding.every((row) => row.resolvedAt === null), 'both notices start outstanding');

  // Bob completes the added option too - his own notice resolves immediately,
  // without waiting on carol or on the poll closing.
  const bobCompletes = await request(app)
    .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(addedOption.body, ['can', 'if_needed', 'can']) });
  assert.equal(bobCompletes.status, 200, JSON.stringify(bobCompletes.body));

  const bobRowAfterAnswer = db
    .prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
    .get(bobUpdateTopicKey) as { resolvedAt: number | null };
  assert.ok(bobRowAfterAnswer.resolvedAt, 'bob\'s notice resolves once his response is complete again');
  const carolRowAfterBobAnswers = db
    .prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
    .get(carolUpdateTopicKey) as { resolvedAt: number | null };
  assert.equal(carolRowAfterBobAnswers.resolvedAt, null, 'carol never answered Berlin, so hers is still outstanding');

  // Carol never gets around to it; closing the poll resolves her leftover
  // notice too, since no further response is possible once it is closed.
  const closed = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));

  const carolRowAfterClose = db
    .prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
    .get(carolUpdateTopicKey) as { resolvedAt: number | null };
  assert.ok(carolRowAfterClose.resolvedAt, 'the poll closing resolves carol\'s still-outstanding notice too');

  const carolLog = await request(app).get('/api/push/log').set('x-test-player-id', carol).query({ playerId: carol });
  const carolEntry = carolLog.body.entries.find((item: { title: string }) => item.title === 'Abstimmung ergänzt');
  assert.ok(carolEntry?.resolvedAt, 'and the notification-center entry reflects it, making it eligible for cleanup');
});

test('automatic poll reminders are scheduled two days and two hours before the deadline', async () => {
  const alice = 'poll-auto-reminder-alice';
  createMember(alice, 'Poll Auto Reminder Alice');
  const eventId = await createEvent('Poll Auto Reminder Event', [alice]);
  const created = await createPoll(eventId, alice, { responseDueOn: isoDate(6) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const poll = db
    .prepare('SELECT response_due_at AS responseDueAt FROM event_date_polls WHERE id = ?')
    .get(created.body.id) as { responseDueAt: number };
  const invitee = db
    .prepare(
      'SELECT automatic_reminder_due_at AS dueAt, automatic_reminder_stage AS stage FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?',
    )
    .get(created.body.id, alice) as { dueAt: number; stage: number };
  assert.equal(invitee.stage, 0);
  assert.equal(invitee.dueAt, poll.responseDueAt - 48 * 60 * 60 * 1000);

  db.prepare('UPDATE event_date_poll_invitees SET last_reminder_at = ? WHERE poll_id = ? AND player_id = ?').run(
    invitee.dueAt - 60 * 60 * 1000,
    created.body.id,
    alice,
  );
  const firstStage = dueAutomaticReminders(invitee.dueAt).find((entry) => entry.pollId === created.body.id);
  assert.equal(firstStage?.stage, 1, 'a manual reminder does not suppress the required automatic stage');
  advanceAutomaticReminder(created.body.id, alice, 1, invitee.dueAt);
  const secondPlan = db
    .prepare(
      'SELECT automatic_reminder_due_at AS dueAt, automatic_reminder_stage AS stage FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?',
    )
    .get(created.body.id, alice) as { dueAt: number; stage: number };
  assert.equal(secondPlan.stage, 1);
  assert.equal(secondPlan.dueAt, poll.responseDueAt - 2 * 60 * 60 * 1000);
  assert.equal(
    dueAutomaticReminders(secondPlan.dueAt).find((entry) => entry.pollId === created.body.id)?.stage,
    2,
  );
});

test('automatic reminder sweeps enroll newly accepted participants without a poll read', async () => {
  const alice = 'poll-late-reminder-alice';
  const bob = 'poll-late-reminder-bob';
  createMember(alice, 'Poll Late Reminder Alice');
  createMember(bob, 'Poll Late Reminder Bob');
  const eventId = await createEvent('Poll Late Reminder Event', [alice]);
  const created = await createPoll(eventId, alice, { responseDueOn: isoDate(6) });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const invitation = await request(app)
    .post(`/api/events/${eventId}/invitations`)
    .set('x-test-player-id', TEST_ADMIN_ID)
    .send({ playerId: bob });
  assert.equal(invitation.status, 201);
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitation/accept`).set('x-test-player-id', bob)).status,
    200,
  );
  assert.equal(
    db.prepare('SELECT 1 FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?').get(created.body.id, bob),
    undefined,
    'acceptance alone does not depend on opening the poll view',
  );

  dueAutomaticReminders(Date.now());
  const poll = db
    .prepare('SELECT response_due_at AS responseDueAt FROM event_date_polls WHERE id = ?')
    .get(created.body.id) as { responseDueAt: number };
  const invitee = db
    .prepare(
      'SELECT automatic_reminder_due_at AS dueAt FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?',
    )
    .get(created.body.id, bob) as { dueAt: number };
  assert.equal(invitee.dueAt, poll.responseDueAt - 48 * 60 * 60 * 1000);
  assert.ok(
    dueAutomaticReminders(invitee.dueAt).some(
      (entry) => entry.pollId === created.body.id && entry.playerId === bob && entry.stage === 1,
    ),
  );
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

test('closing freezes the result without responses from participants who already left', async () => {
  const alice = 'poll-close-roster-alice';
  const bob = 'poll-close-roster-bob';
  createMember(alice, 'Poll Close Roster Alice');
  createMember(bob, 'Poll Close Roster Bob');
  const eventId = await createEvent('Poll Close Roster Event', [alice, bob]);
  const created = await createPoll(eventId, alice, {
    responseMode: 'single_choice',
    options: [{ label: 'Variante A' }, { label: 'Variante B' }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const aliceAnswer = await request(app)
    .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
    .set('x-test-player-id', alice)
    .send({ responses: responsesFor(created.body, ['cannot', 'can']) });
  assert.equal(aliceAnswer.status, 200, JSON.stringify(aliceAnswer.body));
  const bobAnswer = await request(app)
    .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: responsesFor(created.body, ['can', 'cannot']) });
  assert.equal(bobAnswer.status, 200, JSON.stringify(bobAnswer.body));

  const removed = await request(app)
    .delete(`/api/events/${eventId}/participants/${bob}`)
    .set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(removed.status, 204);
  const closed = await request(app)
    .post(`/api/events/${eventId}/polls/${created.body.id}/close`)
    .set('x-test-player-id', alice);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.deepEqual(closed.body.invitees.map((entry: { playerId: string }) => entry.playerId), [alice]);
  assert.equal(closed.body.options[0].counts.can, 0);
  assert.equal(closed.body.options[0].isRecommended, false);
  assert.equal(closed.body.options[1].counts.can, 1);
  assert.equal(closed.body.options[1].isRecommended, true);
  assert.equal(
    db.prepare('SELECT 1 FROM event_date_poll_responses WHERE poll_id = ? AND player_id = ?').get(created.body.id, bob),
    undefined,
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

test('expired rounds close lazily with audit, realtime and reminder cleanup on list and detail reads', async () => {
  const alice = 'poll-expiry-alice';
  const bob = 'poll-expiry-bob';
  createMember(alice, 'Poll Expiry Alice');
  createMember(bob, 'Poll Expiry Bob');
  const eventId = await createEvent('Poll Expiry Event', [alice, bob]);
  const signals: string[] = [];
  setIo({ emit: (event: string) => signals.push(event) } as never);

  const prepareRound = async (title: string) => {
    const created = await createPoll(eventId, alice, { title });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const answered = await request(app)
      .put(`/api/events/${eventId}/polls/${created.body.id}/my-responses`)
      .set('x-test-player-id', alice)
      .send({ responses: responsesFor(created.body, ['can', 'cannot']) });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    const reminder = await request(app)
      .post(`/api/events/${eventId}/polls/${created.body.id}/reminders`)
      .set('x-test-player-id', alice);
    assert.deepEqual(reminder.body.remindedPlayerIds, [bob]);
    const topicKey = `event-poll-reminder:${created.body.id}:${bob}`;
    db.prepare('UPDATE push_log SET expires_at = NULL WHERE topic_key = ?').run(topicKey);
    return { pollId: created.body.id as string, topicKey };
  };

  const assertCompletedOnce = (pollId: string, topicKey: string) => {
    const auditCount = db
      .prepare("SELECT COUNT(*) AS count FROM admin_log WHERE action = 'event_date_poll_deadline_closed' AND target_id = ?")
      .get(pollId) as { count: number };
    assert.equal(auditCount.count, 1);
    const topic = db
      .prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
      .get(topicKey) as { resolvedAt: number | null };
    assert.ok(topic.resolvedAt, 'the reminder topic is no longer active after the deadline close');
    const openTopic = db
      .prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?')
      .get(`event-poll-open:${pollId}:${bob}`) as { resolvedAt: number | null };
    assert.ok(
      openTopic.resolvedAt,
      'the "Neue Abstimmung" notification is also resolved so a returning player sees the poll as no longer actionable',
    );
    assert.equal(signals.filter((event) => event === Events.eventsChanged).length, 1);
  };

  try {
    const listRound = await prepareRound('Lazy close through list');
    db.prepare('UPDATE event_date_polls SET response_due_at = ? WHERE id = ?').run(Date.now() - 1_000, listRound.pollId);
    signals.length = 0;
    const list = await request(app).get(`/api/events/${eventId}/polls`).set('x-test-player-id', alice);
    assert.equal(list.status, 200);
    assert.equal(list.body.find((poll: { id: string }) => poll.id === listRound.pollId)?.status, 'closed');
    assertCompletedOnce(listRound.pollId, listRound.topicKey);

    const detailRound = await prepareRound('Lazy close through detail');
    db.prepare('UPDATE event_date_polls SET response_due_at = ? WHERE id = ?').run(Date.now() - 1_000, detailRound.pollId);
    signals.length = 0;
    const first = await request(app).get(`/api/events/${eventId}/polls/${detailRound.pollId}`).set('x-test-player-id', alice);
    const second = await request(app).get(`/api/events/${eventId}/polls/${detailRound.pollId}`).set('x-test-player-id', alice);
    assert.equal(first.body.status, 'closed');
    assert.equal(second.body.status, 'closed');
    runEventDatePollReminderSweepOnce();
    assertCompletedOnce(detailRound.pollId, detailRound.topicKey);
  } finally {
    setIo(null);
  }
});

test('a poll can run without a deadline: it never lazily expires or schedules an automatic reminder, and a deadline can be added or cleared later', async () => {
  const alice = 'poll-open-ended-alice';
  const bob = 'poll-open-ended-bob';
  createMember(alice, 'Poll Open Ended Alice');
  createMember(bob, 'Poll Open Ended Bob');
  const eventId = await createEvent('Poll Open Ended Event', [alice, bob]);

  const created = await createPoll(eventId, alice, { responseDueOn: null });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.responseDueAt, null);
  const pollId = created.body.id as string;

  // A far-future "now" must not lazily close a poll with no deadline.
  const future = await request(app)
    .get(`/api/events/${eventId}/polls/${pollId}`)
    .set('x-test-player-id', alice);
  assert.equal(future.body.status, 'open');

  const dueRow = db
    .prepare('SELECT automatic_reminder_due_at AS dueAt FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?')
    .get(pollId, bob) as { dueAt: number | null };
  assert.equal(dueRow.dueAt, null, 'no automatic reminder is scheduled without a deadline');

  const withDeadline = await request(app)
    .patch(`/api/events/${eventId}/polls/${pollId}`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: isoDate(5) });
  assert.equal(withDeadline.status, 200, JSON.stringify(withDeadline.body));
  assert.ok(withDeadline.body.responseDueAt > Date.now());
  const scheduledRow = db
    .prepare('SELECT automatic_reminder_due_at AS dueAt FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?')
    .get(pollId, bob) as { dueAt: number | null };
  assert.ok(scheduledRow.dueAt !== null, 'adding a deadline schedules an automatic reminder');

  const cleared = await request(app)
    .patch(`/api/events/${eventId}/polls/${pollId}`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: null });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.responseDueAt, null);
  const clearedRow = db
    .prepare('SELECT automatic_reminder_due_at AS dueAt FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?')
    .get(pollId, bob) as { dueAt: number | null };
  assert.equal(clearedRow.dueAt, null, 'clearing the deadline also clears the scheduled automatic reminder');

  const closed = await request(app).post(`/api/events/${eventId}/polls/${pollId}/close`).set('x-test-player-id', alice);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));

  const reopened = await request(app)
    .post(`/api/events/${eventId}/polls/${pollId}/reopen`)
    .set('x-test-player-id', alice)
    .send({ responseDueOn: null });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.status, 'open');
  assert.equal(reopened.body.responseDueAt, null, 'reopening without a deadline keeps the poll open-ended');
});
