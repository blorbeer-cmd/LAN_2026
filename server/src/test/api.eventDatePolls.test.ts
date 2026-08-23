import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';

const app = createTestApp();

function createMember(id: string, name: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO players (id, name, color, api_key, created_at) VALUES (?, ?, '#4f9dff', ?, ?)`,
  ).run(id, name, `${id}-api-key`, Date.now());
  ensureDefaultGroupMembership(id);
}

function isoDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test('planning event lifecycle: create, poll, respond, schedule, reconfirm', async () => {
  const bob = 'poll-bob';
  const carol = 'poll-carol';
  createMember(bob, 'Poll Bob');
  createMember(carol, 'Poll Carol');

  const planning = await request(app).post('/api/events/planning').send({ name: 'LAN Herbst', description: 'Planung läuft' });
  assert.equal(planning.status, 201, JSON.stringify(planning.body));
  assert.equal(planning.body.status, 'draft');
  assert.equal(planning.body.startsAt, null);
  assert.equal(planning.body.endsAt, null);
  const eventId = planning.body.id;

  // No "Invalid Date": listing and fetching a dateless draft event must not blow up.
  const list = await request(app).get('/api/events');
  assert.equal(list.status, 200);
  const getDraft = await request(app).get(`/api/events/${eventId}`);
  assert.equal(getDraft.status, 200);
  assert.equal(getDraft.body.startsAt, null);

  const optionA = { startsOn: isoDate(10), endsOn: isoDate(12) };
  const optionB = { startsOn: isoDate(17), endsOn: isoDate(19) };
  const createPoll = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({ options: [optionA, optionB], responseDueOn: isoDate(5), inviteePlayerIds: [bob, carol] });
  assert.equal(createPoll.status, 201, JSON.stringify(createPoll.body));
  assert.equal(createPoll.body.roundNumber, 1);
  assert.equal(createPoll.body.status, 'open');
  assert.equal(createPoll.body.options.length, 2);
  const pollId = createPoll.body.id;
  const optAId = createPoll.body.options[0].id;
  const optBId = createPoll.body.options[1].id;

  // Only invitees can see/answer; a non-invited member gets 404.
  const stranger = 'poll-stranger';
  createMember(stranger, 'Poll Stranger');
  const strangerGet = await request(app).get(`/api/events/${eventId}/date-polls/${pollId}`).set('x-test-player-id', stranger);
  assert.equal(strangerGet.status, 404);

  // A poll invitee has no event_participants row yet, so the draft event
  // must surface through plannedEvents (not availableEvents, which stays the
  // switchable-workspace list) in the plain member's own GET /api/events —
  // otherwise they would have no way to find their way into the poll at all.
  const bobList = await request(app).get('/api/events').set('x-test-player-id', bob);
  assert.equal(bobList.status, 200);
  assert.ok(!bobList.body.availableEvents.some((e: { id: string }) => e.id === eventId));
  assert.deepEqual(bobList.body.plannedEvents.map((e: { id: string }) => e.id), [eventId]);
  assert.equal(bobList.body.plannedEvents[0].status, 'draft');
  assert.equal(bobList.body.plannedEvents[0].myParticipation, null, 'not an event participant yet, only a poll invitee');
  const strangerList = await request(app).get('/api/events').set('x-test-player-id', stranger);
  assert.deepEqual(strangerList.body.plannedEvents, [], 'a non-invited member sees nothing planned');
  // Owner/admin already see every draft through managedEvents.
  const adminList = await request(app).get('/api/events').set('x-test-player-id', TEST_ADMIN_ID);
  assert.deepEqual(adminList.body.plannedEvents, []);
  assert.ok(adminList.body.managedEvents.some((e: { id: string }) => e.id === eventId));

  // Bob answers "can" for A, "cannot" for B.
  const bobRespond = await request(app)
    .put(`/api/events/${eventId}/date-polls/${pollId}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: [{ optionId: optAId, response: 'can' }, { optionId: optBId, response: 'cannot' }] });
  assert.equal(bobRespond.status, 200, JSON.stringify(bobRespond.body));

  // Carol answers "if_needed" for A, "can" for B.
  const carolRespond = await request(app)
    .put(`/api/events/${eventId}/date-polls/${pollId}/my-responses`)
    .set('x-test-player-id', carol)
    .send({ responses: [{ optionId: optAId, response: 'if_needed' }, { optionId: optBId, response: 'can' }] });
  assert.equal(carolRespond.status, 200);

  const detail = await request(app).get(`/api/events/${eventId}/date-polls/${pollId}`);
  assert.equal(detail.status, 200);
  const detailOptA = detail.body.options.find((o: { id: string }) => o.id === optAId);
  assert.equal(detailOptA.counts.can, 1);
  assert.equal(detailOptA.counts.ifNeeded, 1);
  assert.equal(detailOptA.counts.cannot, 0);
  assert.equal(detailOptA.isRecommended, true, 'A has 1 can + 1 if_needed vs B has 1 can + 1 cannot -> A recommended');

  // Creator schedules option A.
  const schedule = await request(app)
    .post(`/api/events/${eventId}/date-polls/${pollId}/schedule`)
    .send({ optionId: optAId });
  assert.equal(schedule.status, 200, JSON.stringify(schedule.body));
  assert.equal(schedule.body.event.scheduleRevision, 1);
  assert.ok(schedule.body.event.startsAt > 0);

  const afterSchedule = await request(app).get(`/api/events/${eventId}`);
  assert.equal(afterSchedule.body.status, 'draft', 'still draft until creator publishes regular invitations');
  assert.equal(afterSchedule.body.scheduleRevision, 1);
  assert.ok(afterSchedule.body.startsAt > 0);

  // Idempotent retry of the same schedule choice must not bump the revision again.
  const retrySchedule = await request(app)
    .post(`/api/events/${eventId}/date-polls/${pollId}/schedule`)
    .send({ optionId: optAId });
  assert.equal(retrySchedule.status, 200);
  assert.equal(retrySchedule.body.event.scheduleRevision, 1, 'idempotent retry must not create a second revision');

  // Regular invitation flow: creator invites Bob & Carol as event participants, both accept.
  // x-test-player-id is set explicitly here even for the default admin actor:
  // the test harness (createTestApp) otherwise sniffs a body.playerId field as
  // "act as this player" (for routes like PATCH /api/players/:id), which would
  // misfire on this endpoint's own {playerId: <invitee>} body.
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitations`).set('x-test-player-id', TEST_ADMIN_ID).send({ playerId: bob })).status,
    201,
  );
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitations`).set('x-test-player-id', TEST_ADMIN_ID).send({ playerId: carol })).status,
    201,
  );
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitation/accept`).set('x-test-player-id', bob)).status,
    200,
  );
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitation/accept`).set('x-test-player-id', carol)).status,
    200,
  );

  const acceptedAfterFirstAccept = await request(app).get(`/api/events/${eventId}`);
  assert.equal(acceptedAfterFirstAccept.body.acceptedParticipants.length, 2, 'both confirmed for current revision 1');

  // --- Reschedule: a new round supersedes the old one, prior acceptances go stale ---
  const round2 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [
        { startsOn: isoDate(24), endsOn: isoDate(26) },
        { startsOn: isoDate(31), endsOn: isoDate(33) },
      ],
      responseDueOn: isoDate(20),
      inviteePlayerIds: [bob, carol],
    });
  assert.equal(round2.status, 201, JSON.stringify(round2.body));
  assert.equal(round2.body.roundNumber, 2);
  const round2OptA = round2.body.options[0].id;

  // Starting round 2 (still open, not yet scheduled) must not itself touch
  // the previous acceptances — only actually choosing a date does.
  const whileRound2Open = await request(app).get(`/api/events/${eventId}`);
  assert.equal(whileRound2Open.body.acceptedParticipants.length, 2, 'existing acceptances stay current until a new date is actually scheduled');

  const scheduleRound2 = await request(app)
    .post(`/api/events/${eventId}/date-polls/${round2.body.id}/schedule`)
    .send({ optionId: round2OptA });
  assert.equal(scheduleRound2.status, 200);
  assert.equal(scheduleRound2.body.event.scheduleRevision, 2);

  const round1After = await request(app).get(`/api/events/${eventId}/date-polls/${pollId}`);
  assert.equal(round1After.body.status, 'superseded', 'round 1 stays as history, superseded by round 2');

  // Stale acceptances no longer count as current participation.
  const duringReconfirm = await request(app).get(`/api/events/${eventId}`);
  assert.equal(duringReconfirm.body.acceptedParticipants.length, 0, 'stale acceptances must not count until reconfirmed');
  const bobRow = duringReconfirm.body.participants.find((p: { playerId: string }) => p.playerId === bob);
  assert.equal(bobRow.status, 'accepted');
  assert.equal(bobRow.confirmedScheduleRevision, 1, 'old confirmation is visible but stale (revision 1 while event is now on 2 after scheduling)');

  // The same staleness that excludes Bob from acceptedParticipants also
  // excludes the event from his own availableEvents (the join is
  // revision-gated) — without plannedEvents picking it back up, his event
  // card (and with it the "please reconfirm" chip) would vanish entirely,
  // leaving him no way to even discover he needs to act.
  const bobListWhileStale = await request(app).get('/api/events').set('x-test-player-id', bob);
  assert.ok(!bobListWhileStale.body.availableEvents.some((e: { id: string }) => e.id === eventId));
  assert.deepEqual(bobListWhileStale.body.plannedEvents.map((e: { id: string }) => e.id), [eventId]);
  const bobPlannedEntry = bobListWhileStale.body.plannedEvents[0];
  assert.equal(bobPlannedEntry.status, 'published');
  assert.equal(bobPlannedEntry.scheduleRevision, 2);
  assert.deepEqual(bobPlannedEntry.myParticipation, { status: 'accepted', confirmedScheduleRevision: 1 });
  // Carol hasn't answered round 2 at all yet but is still an invitee of it,
  // so canReadPoll's staleness carve-out covers her too — same visibility.
  const carolListWhileStale = await request(app).get('/api/events').set('x-test-player-id', carol);
  assert.deepEqual(carolListWhileStale.body.plannedEvents.map((e: { id: string }) => e.id), [eventId]);

  // Bob reconfirms for the new revision.
  const bobReconfirm = await request(app)
    .post(`/api/events/${eventId}/invitation/accept`)
    .set('x-test-player-id', bob);
  assert.equal(bobReconfirm.status, 200);
  const afterBobReconfirm = await request(app).get(`/api/events/${eventId}`);
  assert.equal(afterBobReconfirm.body.acceptedParticipants.length, 1);
  assert.equal(afterBobReconfirm.body.acceptedParticipants[0].playerId, bob);

  // Reconfirming moves Bob back from plannedEvents into the normal
  // availableEvents workspace list, now current for revision 2.
  const bobListAfterReconfirm = await request(app).get('/api/events').set('x-test-player-id', bob);
  assert.deepEqual(bobListAfterReconfirm.body.plannedEvents, []);
  const bobAvailableEntry = bobListAfterReconfirm.body.availableEvents.find((e: { id: string }) => e.id === eventId);
  assert.ok(bobAvailableEntry, 'reconfirming moves the event back into availableEvents');
  assert.deepEqual(bobAvailableEntry.myParticipation, {
    status: 'accepted',
    confirmedScheduleRevision: 2,
  });
});

test('a reschedule leaves existing payments and accommodation accounting untouched', async () => {
  const payer = 'poll-payer';
  createMember(payer, 'Poll Payer');

  const planning = await request(app).post('/api/events/planning').send({ name: 'LAN mit Kosten' });
  const eventId = planning.body.id;
  const withCosts = await request(app)
    .patch(`/api/events/${eventId}`)
    .send({ costCents: 5000, accommodationCostCents: 40000 });
  assert.equal(withCosts.status, 200, JSON.stringify(withCosts.body));

  const round1 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }],
      responseDueOn: isoDate(3),
      inviteePlayerIds: [payer],
    });
  await request(app).post(`/api/events/${eventId}/date-polls/${round1.body.id}/schedule`).send({ optionId: round1.body.options[0].id });

  // Regular invitation, acceptance and a recorded payment for revision 1.
  assert.equal(
    (await request(app).post(`/api/events/${eventId}/invitations`).set('x-test-player-id', TEST_ADMIN_ID).send({ playerId: payer })).status,
    201,
  );
  assert.equal((await request(app).post(`/api/events/${eventId}/invitation/accept`).set('x-test-player-id', payer)).status, 200);
  const paymentRecord = await request(app)
    .patch(`/api/events/${eventId}/participants/${payer}/payment`)
    .set('x-test-player-id', payer)
    .send({ paid: true });
  assert.equal(paymentRecord.status, 200, JSON.stringify(paymentRecord.body));

  const beforeReschedule = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(beforeReschedule.body.settlementPaidCents, 5000);
  assert.equal(beforeReschedule.body.settlementPaidCount, 1);
  assert.equal(beforeReschedule.body.accommodationCostCents, 40000);
  const payerRowBefore = beforeReschedule.body.participants.find((p: { playerId: string }) => p.playerId === payer);
  assert.equal(payerRowBefore.paid, true);
  assert.equal(payerRowBefore.paidAmountCents, 5000);

  // Reschedule: a new round supersedes the old one and bumps schedule_revision.
  const round2 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(24), endsOn: isoDate(26) }, { startsOn: isoDate(31), endsOn: isoDate(33) }],
      responseDueOn: isoDate(20),
      inviteePlayerIds: [payer],
    });
  await request(app).post(`/api/events/${eventId}/date-polls/${round2.body.id}/schedule`).send({ optionId: round2.body.options[0].id });

  const afterReschedule = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(afterReschedule.body.scheduleRevision, 2);
  // The roster view that only shows currently-confirmed participants hides
  // the now-stale payer (unrelated to payments — this is the same visibility
  // rule the reconfirmation flow relies on elsewhere in this file)...
  assert.equal(afterReschedule.body.acceptedParticipants.length, 0);
  // ...but the payment itself and the accommodation figures are untouched:
  // scheduleDatePoll() never writes to event_participants, so nothing about
  // a reschedule can reset paid/paidAmountCents.
  assert.equal(afterReschedule.body.settlementPaidCents, 5000, 'the recorded payment still counts toward the settlement total');
  assert.equal(afterReschedule.body.settlementPaidCount, 1);
  assert.equal(afterReschedule.body.accommodationCostCents, 40000, 'accommodation accounting survives the reschedule');
  const payerRowAfter = afterReschedule.body.participants.find((p: { playerId: string }) => p.playerId === payer);
  assert.equal(payerRowAfter.paid, true, 'the payer\'s own roster row keeps its paid state');
  assert.equal(payerRowAfter.paidAmountCents, 5000);
  assert.equal(payerRowAfter.confirmedScheduleRevision, 1, 'stale for the new revision, but the row itself is untouched');
});

test('creating a second undecided round while one is open is rejected with 409', async () => {
  const planning = await request(app).post('/api/events/planning').send({ name: 'Doppel-Runde' });
  const eventId = planning.body.id;
  const first = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({ options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }], responseDueOn: isoDate(3) });
  assert.equal(first.status, 201);
  const second = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({ options: [{ startsOn: isoDate(12), endsOn: isoDate(13) }, { startsOn: isoDate(15), endsOn: isoDate(16) }], responseDueOn: isoDate(3) });
  assert.equal(second.status, 409);
});

test('options require 2-8 entries, no backwards or duplicate ranges', async () => {
  const planning = await request(app).post('/api/events/planning').send({ name: 'Validierung' });
  const eventId = planning.body.id;
  const tooFew = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({ options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }], responseDueOn: isoDate(3) });
  assert.equal(tooFew.status, 400);

  const backwards = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({ options: [{ startsOn: isoDate(6), endsOn: isoDate(5) }, { startsOn: isoDate(8), endsOn: isoDate(9) }], responseDueOn: isoDate(3) });
  assert.equal(backwards.status, 400);

  const dup = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(5), endsOn: isoDate(6) }],
      responseDueOn: isoDate(3),
    });
  assert.equal(dup.status, 400);
});

test('responseDueOn must be in the future both on creation and when editing an open round', async () => {
  const planning = await request(app).post('/api/events/planning').send({ name: 'Frist-Validierung' });
  const eventId = planning.body.id;
  const options = [{ startsOn: isoDate(20), endsOn: isoDate(21) }, { startsOn: isoDate(25), endsOn: isoDate(26) }];

  // A round created with an already-past deadline could never be answered
  // and would get lazily (and silently) closed on first read.
  const pastCreate = await request(app).post(`/api/events/${eventId}/date-polls`).send({ options, responseDueOn: isoDate(-1) });
  assert.equal(pastCreate.status, 400);

  const created = await request(app).post(`/api/events/${eventId}/date-polls`).send({ options, responseDueOn: isoDate(3) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const pollId = created.body.id;

  const pastPatch = await request(app).patch(`/api/events/${eventId}/date-polls/${pollId}`).send({ responseDueOn: isoDate(-1) });
  assert.equal(pastPatch.status, 400);

  // The round itself must remain untouched by the rejected edit.
  const unchanged = await request(app).get(`/api/events/${eventId}/date-polls/${pollId}`);
  assert.equal(unchanged.body.responseDueAt, created.body.responseDueAt);
});

test('concurrent schedule requests: exactly one wins, no double revision bump', async () => {
  const planning = await request(app).post('/api/events/planning').send({ name: 'Race Event' });
  const eventId = planning.body.id;
  const created = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }],
      responseDueOn: isoDate(3),
    });
  const pollId = created.body.id;
  const optA = created.body.options[0].id;
  const optB = created.body.options[1].id;

  const [r1, r2] = await Promise.all([
    request(app).post(`/api/events/${eventId}/date-polls/${pollId}/schedule`).send({ optionId: optA }),
    request(app).post(`/api/events/${eventId}/date-polls/${pollId}/schedule`).send({ optionId: optB }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  // one succeeds (200), the other is a conflict (409) since it picked a different option
  assert.deepEqual(statuses, [200, 409]);
  const finalEvent = await request(app).get(`/api/events/${eventId}`);
  assert.equal(finalEvent.body.scheduleRevision, 1, 'exactly one revision bump from the race');
});

test('a new round can be cancelled without touching the previously scheduled date', async () => {
  const planning = await request(app).post('/api/events/planning').send({ name: 'Abbruch Event' });
  const eventId = planning.body.id;
  const round1 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }],
      responseDueOn: isoDate(3),
    });
  await request(app).post(`/api/events/${eventId}/date-polls/${round1.body.id}/schedule`).send({ optionId: round1.body.options[0].id });
  const afterFirst = await request(app).get(`/api/events/${eventId}`);
  const originalStartsAt = afterFirst.body.startsAt;

  const round2 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(20), endsOn: isoDate(21) }, { startsOn: isoDate(25), endsOn: isoDate(26) }],
      responseDueOn: isoDate(15),
    });
  assert.equal(round2.status, 201);
  const cancelled = await request(app).post(`/api/events/${eventId}/date-polls/${round2.body.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');

  const afterCancel = await request(app).get(`/api/events/${eventId}`);
  assert.equal(afterCancel.body.startsAt, originalStartsAt, 'cancelling round 2 must not change the existing event date');
  assert.equal(afterCancel.body.scheduleRevision, 1, 'no revision bump from a cancelled round');
});

test('only the creator (or owner fallback) may manage a round; non-invitees cannot see it', async () => {
  const bob = 'poll-perm-bob';
  const carol = 'poll-perm-carol';
  createMember(bob, 'Perm Bob');
  createMember(carol, 'Perm Carol');

  const planning = await request(app).post('/api/events/planning').send({ name: 'Berechtigungen' });
  const eventId = planning.body.id;
  const created = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }],
      responseDueOn: isoDate(3),
      inviteePlayerIds: [bob],
    });
  assert.equal(created.status, 201);
  const pollId = created.body.id;
  const optionId = created.body.options[0].id;

  // Bob is invited (can read/answer) but is not the creator, so management
  // actions are refused even though he is a regular active member.
  const bobRead = await request(app).get(`/api/events/${eventId}/date-polls/${pollId}`).set('x-test-player-id', bob);
  assert.equal(bobRead.status, 200);
  assert.equal(bobRead.body.canManage, false);
  const bobSchedule = await request(app)
    .post(`/api/events/${eventId}/date-polls/${pollId}/schedule`)
    .set('x-test-player-id', bob)
    .send({ optionId });
  assert.equal(bobSchedule.status, 403);
  const bobClose = await request(app).post(`/api/events/${eventId}/date-polls/${pollId}/close`).set('x-test-player-id', bob);
  assert.equal(bobClose.status, 403);

  // Carol was never invited and has no other relationship to this event -
  // the round (and the still-draft event itself) must not be visible to her.
  const carolPoll = await request(app).get(`/api/events/${eventId}/date-polls/${pollId}`).set('x-test-player-id', carol);
  assert.equal(carolPoll.status, 404);
  const carolEvent = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', carol);
  assert.equal(carolEvent.status, 404);
});

test('the group owner takes over round management once the creator is deactivated', async () => {
  const creator = 'poll-owner-fallback-creator';
  createMember(creator, 'Fallback Creator');
  // requireGroupRole('admin') gates POST /api/events/planning, so the
  // creator needs an admin role of their own to start the planning event.
  db.prepare(`UPDATE group_memberships SET role = 'admin' WHERE player_id = ? AND group_id = 'default-group'`).run(creator);

  const planning = await request(app)
    .post('/api/events/planning')
    .set('x-test-player-id', creator)
    .send({ name: 'Vertretung' });
  assert.equal(planning.status, 201);
  const eventId = planning.body.id;

  const created = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .set('x-test-player-id', creator)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }],
      responseDueOn: isoDate(3),
    });
  assert.equal(created.status, 201);
  const pollId = created.body.id;

  // While the creator is still active, TEST_ADMIN_ID (the group owner) gets
  // no extra rights over this round.
  const ownerTooEarly = await request(app).post(`/api/events/${eventId}/date-polls/${pollId}/close`);
  assert.equal(ownerTooEarly.status, 403);
  // The displayed canManage flag (what the frontend gates its "Termin
  // festlegen"/"Schließen" buttons on) must agree with that 403 — a stale
  // hardcoded viewerRole here previously left it permanently false even
  // after the fallback kicked in below, hiding the owner's actions in the UI
  // without the action endpoints themselves ever failing.
  const listTooEarly = await request(app).get(`/api/events/${eventId}/date-polls`);
  assert.equal(listTooEarly.body[0].canManage, false);

  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), creator);

  const ownerNow = await request(app).post(`/api/events/${eventId}/date-polls/${pollId}/close`);
  assert.equal(ownerNow.status, 200, JSON.stringify(ownerNow.body));
  assert.equal(ownerNow.body.canManage, true, 'the fallback must also be visible in the response, not only enforced');

  const listAfterFallback = await request(app).get(`/api/events/${eventId}/date-polls`);
  assert.equal(listAfterFallback.body[0].canManage, true);
});

test('an expired open round lazily and idempotently closes on first read, without a second audit entry', async () => {
  const planning = await request(app).post('/api/events/planning').send({ name: 'Fristablauf' });
  const eventId = planning.body.id;
  const created = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(20), endsOn: isoDate(21) }, { startsOn: isoDate(25), endsOn: isoDate(26) }],
      responseDueOn: isoDate(3),
    });
  const pollId = created.body.id;

  // Force the deadline into the past without going through the API (the
  // route layer only accepts a future-dated creation/extension).
  db.prepare('UPDATE event_date_polls SET response_due_at = ? WHERE id = ?').run(Date.now() - 1000, pollId);

  const [first, second] = await Promise.all([
    request(app).get(`/api/events/${eventId}/date-polls/${pollId}`),
    request(app).get(`/api/events/${eventId}/date-polls/${pollId}`),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.status, 'closed');
  assert.equal(second.body.status, 'closed');

  const closedAudits = db
    .prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'event_date_poll_deadline_closed' AND target_id = ?")
    .get(pollId) as { n: number };
  assert.equal(closedAudits.n, 1, 'exactly one lazy-close audit entry, even though two requests raced to materialize it');

  // Past the deadline, an answer is rejected even though the lazy transition
  // already ran once for a different request. No inviteePlayerIds was given
  // at creation, so it defaulted to every active group member — including
  // the default requester — so this is a 409 (closed), not a 404.
  const lateAnswer = await request(app)
    .put(`/api/events/${eventId}/date-polls/${pollId}/my-responses`)
    .send({ responses: created.body.options.map((o: { id: string }) => ({ optionId: o.id, response: 'can' })) });
  assert.equal(lateAnswer.status, 409);
});

test('manual reminders skip people who already answered and respect the 24h minimum spacing', async () => {
  const bob = 'poll-remind-bob';
  const carol = 'poll-remind-carol';
  createMember(bob, 'Remind Bob');
  createMember(carol, 'Remind Carol');

  const planning = await request(app).post('/api/events/planning').send({ name: 'Erinnerung' });
  const eventId = planning.body.id;
  const created = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(10), endsOn: isoDate(11) }, { startsOn: isoDate(15), endsOn: isoDate(16) }],
      responseDueOn: isoDate(7),
      inviteePlayerIds: [bob, carol],
    });
  const pollId = created.body.id;
  const options = created.body.options;

  // Bob answers fully; Carol stays open.
  await request(app)
    .put(`/api/events/${eventId}/date-polls/${pollId}/my-responses`)
    .set('x-test-player-id', bob)
    .send({ responses: options.map((o: { id: string }) => ({ optionId: o.id, response: 'can' })) });

  const firstRemind = await request(app).post(`/api/events/${eventId}/date-polls/${pollId}/reminders`);
  assert.equal(firstRemind.status, 200);
  assert.deepEqual(firstRemind.body.remindedPlayerIds, [carol], 'only the still-open invitee is reminded');

  // A second reminder inside the 24h window reminds nobody.
  const secondRemind = await request(app).post(`/api/events/${eventId}/date-polls/${pollId}/reminders`);
  assert.equal(secondRemind.status, 200);
  assert.deepEqual(secondRemind.body.remindedPlayerIds, [], 'the 24h minimum spacing blocks an immediate repeat');

  // Once the recorded reminder is old enough, Carol becomes eligible again.
  db.prepare('UPDATE event_date_poll_invitees SET last_reminder_at = ? WHERE poll_id = ? AND player_id = ?').run(
    Date.now() - 25 * 60 * 60 * 1000,
    pollId,
    carol,
  );
  const thirdRemind = await request(app).post(`/api/events/${eventId}/date-polls/${pollId}/reminders`);
  assert.deepEqual(thirdRemind.body.remindedPlayerIds, [carol]);
});

test('a stale poll-invitee row on a published event never outranks a declined or still-pending regular invitation', async () => {
  const dave = 'poll-declined-dave';
  const erin = 'poll-invited-erin';
  const finn = 'poll-accepted-finn';
  createMember(dave, 'Poll Dave');
  createMember(erin, 'Poll Erin');
  createMember(finn, 'Poll Finn');

  const planning = await request(app).post('/api/events/planning').send({ name: 'LAN Winter Sicherheit' });
  const eventId = planning.body.id;

  const round1 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(5), endsOn: isoDate(6) }, { startsOn: isoDate(8), endsOn: isoDate(9) }],
      responseDueOn: isoDate(3),
      inviteePlayerIds: [dave, erin, finn],
    });
  assert.equal(round1.status, 201);
  const schedule = await request(app)
    .post(`/api/events/${eventId}/date-polls/${round1.body.id}/schedule`)
    .send({ optionId: round1.body.options[0].id });
  assert.equal(schedule.status, 200);

  // Regular invitations publish the event; Dave declines, Erin never
  // responds, Finn accepts.
  for (const id of [dave, erin, finn]) {
    assert.equal(
      (await request(app).post(`/api/events/${eventId}/invitations`).set('x-test-player-id', TEST_ADMIN_ID).send({ playerId: id })).status,
      201,
    );
  }
  assert.equal((await request(app).post(`/api/events/${eventId}/invitation/decline`).set('x-test-player-id', dave)).status, 200);
  assert.equal((await request(app).post(`/api/events/${eventId}/invitation/accept`).set('x-test-player-id', finn)).status, 200);

  const publishedEvent = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', TEST_ADMIN_ID);
  assert.equal(publishedEvent.body.status, 'published');

  // A reschedule round is opened afterwards, keeping Dave and Erin as
  // invitees of a *currently open* round on the now-published event.
  const round2 = await request(app)
    .post(`/api/events/${eventId}/date-polls`)
    .send({
      options: [{ startsOn: isoDate(24), endsOn: isoDate(26) }, { startsOn: isoDate(31), endsOn: isoDate(33) }],
      responseDueOn: isoDate(20),
      inviteePlayerIds: [dave, erin, finn],
    });
  assert.equal(round2.status, 201);
  assert.equal(round2.body.status, 'open');

  // (a) Declined stays hidden even while listed as an open-round invitee.
  const daveGet = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', dave);
  assert.equal(daveGet.status, 404, 'a declined member must not regain participant visibility via a poll-invitee row');

  // (b) Merely invited (never responded) gets the teaser shape only.
  const erinGet = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', erin);
  assert.equal(erinGet.status, 200);
  assert.equal(erinGet.body.participationStatus, 'invited');
  assert.equal(erinGet.body.acceptedParticipants, undefined, 'teaser shape must not leak accepted-participant details');
  assert.equal(erinGet.body.createdBy, undefined, 'teaser shape must not leak the creator field');
  assert.equal(erinGet.body.paypalLink, undefined, 'teaser shape must not leak payment fields');

  // Sanity: Finn (accepted) still gets the full participant shape.
  const finnGet = await request(app).get(`/api/events/${eventId}`).set('x-test-player-id', finn);
  assert.equal(finnGet.status, 200);
  assert.ok(Array.isArray(finnGet.body.acceptedParticipants));
});
