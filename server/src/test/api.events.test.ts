import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, enableTestTracking, TEST_ADMIN_ID } from './testApp';
import { BASE_EVENT_ID, DEFAULT_GROUP_ID, db } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import { recordPushLog } from '../push';
import { EVENT_FEATURE_KEYS } from '../eventFeatureCatalog';

const app = createTestApp();

async function createEvent(name: string, durationMs = 60_000, fields: Record<string, unknown> = {}) {
  const now = Date.now();
  return request(app).post('/api/events').send({ name, startsAt: now, endsAt: now + durationMs, ...fields });
}

function accept(eventId: string, playerId: string): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted'`,
  ).run(eventId, playerId);
}

function createMember(id: string, name: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO players (id, name, color, api_key, created_at)
     VALUES (?, ?, '#4f9dff', ?, ?)`,
  ).run(id, name, `${id}-api-key`, Date.now());
  ensureDefaultGroupMembership(id);
}

test('every account starts in the permanent base event', async () => {
  const active = await request(app).get('/api/events/active');
  assert.equal(active.status, 200);
  assert.equal(active.body.id, BASE_EVENT_ID);
  assert.equal(active.body.isBase, true);
  assert.equal(active.body.eventType, 'lan');
  assert.equal(active.body.presetVersion, 1);
  assert.deepEqual(active.body.enabledFeatures, [...EVENT_FEATURE_KEYS]);

  const list = await request(app).get('/api/events');
  assert.equal(list.status, 200);
  assert.equal(list.body.activeEvent.id, BASE_EVENT_ID);
  assert.ok(list.body.availableEvents.some((event: { id: string }) => event.id === BASE_EVENT_ID));
  assert.ok(Array.isArray(list.body.invitations));
  assert.ok(Array.isArray(list.body.managedEvents));
  assert.equal(
    list.body.managedEvents.some((event: { id: string }) => event.id === BASE_EVENT_ID),
    false,
    'the immutable base workspace is not rendered as a manageable LAN event',
  );
});

test('new events persist and expose the complete backwards-compatible LAN feature snapshot', async () => {
  const created = await createEvent('LAN-Default mit Bereichen');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.eventType, 'lan');
  assert.equal(created.body.presetVersion, 1);
  assert.deepEqual(created.body.enabledFeatures, [...EVENT_FEATURE_KEYS]);

  const persistedEvent = db
    .prepare('SELECT event_type_key AS eventType, preset_version AS presetVersion FROM events WHERE id = ?')
    .get(created.body.id);
  assert.deepEqual(persistedEvent, { eventType: 'lan', presetVersion: 1 });
  const persistedFeatures = db
    .prepare(
      `SELECT feature_key AS featureKey, enabled, changed_by AS changedBy
       FROM event_features WHERE event_id = ? ORDER BY rowid`,
    )
    .all(created.body.id);
  assert.deepEqual(
    persistedFeatures,
    EVENT_FEATURE_KEYS.map((featureKey) => ({ featureKey, enabled: 1, changedBy: TEST_ADMIN_ID })),
  );
});

test('event creation validates name, required timestamps and ordering', async () => {
  assert.equal(
    (await request(app).post('/api/events').send({ name: '  ', startsAt: Date.now(), endsAt: Date.now() + 1_000 })).status,
    400,
  );
  assert.equal((await request(app).post('/api/events').send({ name: 'Missing end', startsAt: Date.now() })).status, 400);
  const startsAt = Date.now() + 60_000;
  assert.equal(
    (await request(app).post('/api/events').send({ name: 'Zeitreise', startsAt, endsAt: startsAt - 1 })).status,
    400,
  );
  for (const visibilityScope of ['group', 'public']) {
    const deprecated = await request(app)
      .post('/api/events')
      .send({ name: `Legacy ${visibilityScope}`, startsAt, endsAt: startsAt + 60_000, visibilityScope });
    assert.equal(deprecated.status, 400);
  }
  const participantsOnly = await request(app)
    .post('/api/events')
    .send({ name: 'Teilnehmende', startsAt, endsAt: startsAt + 60_000, visibilityScope: 'participants' });
  assert.equal(participantsOnly.status, 201, JSON.stringify(participantsOnly.body));
});

test('event type and feature snapshot fields stay explicitly read-only until enforcement is available', async () => {
  const startsAt = Date.now() + 60_000;
  const readOnlyFields: Array<[string, unknown]> = [
    ['eventType', 'celebration'],
    ['presetVersion', 2],
    ['enabledFeatures', ['food']],
  ];
  const eventCountBefore = (db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count;
  for (const [field, value] of readOnlyFields) {
    const rejected = await request(app)
      .post('/api/events')
      .send({
        name: `Nicht schreibbar: ${field}`,
        startsAt,
        endsAt: startsAt + 60_000,
        [field]: value,
      });
    assert.equal(rejected.status, 400, `${field} must not be silently ignored on create`);
    assert.match(rejected.body.error, /schreibgeschützt/);
  }
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count,
    eventCountBefore,
  );

  const created = await createEvent('Unveränderte Eventkonfiguration');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  const storedBefore = db
    .prepare('SELECT name, event_type_key, preset_version FROM events WHERE id = ?')
    .get(eventId);
  const featuresBefore = db
    .prepare('SELECT feature_key, enabled FROM event_features WHERE event_id = ? ORDER BY rowid')
    .all(eventId);
  const auditCountBefore = (
    db
      .prepare("SELECT COUNT(*) AS count FROM admin_log WHERE action = 'event_updated' AND target_id = ?")
      .get(eventId) as { count: number }
  ).count;

  for (const [field, value] of readOnlyFields) {
    const rejected = await request(app)
      .patch(`/api/events/${eventId}`)
      .send({ name: 'Darf nicht übernommen werden', [field]: value });
    assert.equal(rejected.status, 400, `${field} must not be silently ignored on update`);
    assert.match(rejected.body.error, /schreibgeschützt/);
  }
  assert.deepEqual(
    db.prepare('SELECT name, event_type_key, preset_version FROM events WHERE id = ?').get(eventId),
    storedBefore,
  );
  assert.deepEqual(
    db.prepare('SELECT feature_key, enabled FROM event_features WHERE event_id = ? ORDER BY rowid').all(eventId),
    featuresBefore,
  );
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM admin_log WHERE action = 'event_updated' AND target_id = ?")
        .get(eventId) as { count: number }
    ).count,
    auditCountBefore,
    'rejected configuration writes must not create an event_updated audit record',
  );
});

test('event creation and editing validate and expose contribution and accommodation costs', async () => {
  const startsAt = Date.now() + 60_000;
  const created = await request(app).post('/api/events').send({
    name: 'Event mit Kosten',
    startsAt,
    endsAt: startsAt + 60_000,
    costCents: 2550,
    accommodationCostCents: 120000,
    paypalLink: 'https://paypal.me/respawn',
    paymentDueAt: startsAt,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.costCents, 2550);
  assert.equal(created.body.accommodationCostCents, 120000);
  assert.equal(created.body.paypalLink, 'https://paypal.me/respawn');
  assert.equal(created.body.paymentDueAt, startsAt);
  assert.equal(created.body.createdBy, TEST_ADMIN_ID);

  for (const costCents of [0, 25.5, 1_000_001]) {
    const invalid = await request(app).post('/api/events').send({
      name: `Ungültige Kosten ${costCents}`,
      startsAt,
      endsAt: startsAt + 60_000,
      costCents,
    });
    assert.equal(invalid.status, 400);
  }
  for (const accommodationCostCents of [0, 25.5, 10_000_001]) {
    const invalid = await request(app).post('/api/events').send({
      name: `Ungültige Unterkunftskosten ${accommodationCostCents}`,
      startsAt,
      endsAt: startsAt + 60_000,
      accommodationCostCents,
    });
    assert.equal(invalid.status, 400);
  }
  assert.equal(
    (
      await request(app).post('/api/events').send({
        name: 'Link ohne Kosten',
        startsAt,
        endsAt: startsAt + 60_000,
        paypalLink: 'https://paypal.me/respawn',
      })
    ).status,
    400,
  );
  for (const paypalLink of [
    'http://paypal.me/respawn',
    'https://payments.example/respawn',
    'https://paypal.me/respawn/500EUR',
    'https://www.paypal.com/paypalme/respawn/500EUR',
    'https://www.paypal.com/paypalme/respawn/500EUR?locale.x=de_DE',
  ]) {
    const unsafePaypalLink = await request(app).post('/api/events').send({
      name: 'Unsicheres PayPal-Ziel',
      startsAt,
      endsAt: startsAt + 60_000,
      costCents: 2550,
      paypalLink,
    });
    assert.equal(unsafePaypalLink.status, 400);
  }
  const canonicalPaypalMe = await request(app)
    .patch(`/api/events/${created.body.id}`)
    .send({ paypalLink: 'https://www.paypal.com/paypalme/respawn' });
  assert.equal(canonicalPaypalMe.status, 200, JSON.stringify(canonicalPaypalMe.body));
  assert.equal(canonicalPaypalMe.body.paypalLink, 'https://www.paypal.com/paypalme/respawn');
  const emailBasedPaypal = await request(app).post('/api/events').send({
    name: 'PayPal per E-Mail-Adresse',
    startsAt,
    endsAt: startsAt + 60_000,
    costCents: 2550,
    paypalLink: 'https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=orga%40example.com',
  });
  assert.equal(emailBasedPaypal.status, 201, JSON.stringify(emailBasedPaypal.body));
  assert.match(emailBasedPaypal.body.paypalLink, /recipient=orga%40example\.com/);
  assert.equal(
    (
      await request(app).post('/api/events').send({
        name: 'Zahlungsziel ohne Kosten',
        startsAt,
        endsAt: startsAt + 60_000,
        paymentDueAt: startsAt,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app).post('/api/events').send({
        name: 'Ungültiger PayPal-Link',
        startsAt,
        endsAt: startsAt + 60_000,
        costCents: 2550,
        paypalLink: 'javascript:alert(1)',
      })
    ).status,
    400,
  );

  const cannotLeaveLinkBehind = await request(app)
    .patch(`/api/events/${created.body.id}`)
    .send({ costCents: null });
  assert.equal(cannotLeaveLinkBehind.status, 400);
  const cleared = await request(app)
    .patch(`/api/events/${created.body.id}`)
    .send({ costCents: null, accommodationCostCents: null, paypalLink: null, paymentDueAt: null });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.costCents, null);
  assert.equal(cleared.body.accommodationCostCents, null);
  assert.equal(cleared.body.paypalLink, null);
  assert.equal(cleared.body.paymentDueAt, null);
});

test('participants may update only themselves while the event creator may update everyone', async () => {
  const memberOneId = '__event-payment-member-one__';
  const memberTwoId = '__event-payment-member-two__';
  const memberThreeId = '__event-payment-member-three__';
  const uninvitedMemberId = '__event-payment-uninvited__';
  const invitedMemberId = '__event-payment-invited__';
  createMember(memberOneId, 'Payment Member One');
  createMember(memberTwoId, 'Payment Member Two');
  createMember(memberThreeId, 'Payment Member Three');
  createMember(uninvitedMemberId, 'Payment Uninvited');
  createMember(invitedMemberId, 'Payment Invited');
  db.prepare("UPDATE group_memberships SET role = 'admin' WHERE group_id = ? AND player_id = ?").run(
    DEFAULT_GROUP_ID,
    memberTwoId,
  );

  const created = await createEvent('Bezahlstatus Berechtigung', 60_000, {
    costCents: 2550,
    accommodationCostCents: 10000,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  accept(created.body.id, memberOneId);
  accept(created.body.id, memberTwoId);
  accept(created.body.id, memberThreeId);
  db.prepare(`INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'invited')`).run(
    created.body.id,
    invitedMemberId,
  );

  for (const hiddenMemberId of [uninvitedMemberId, invitedMemberId]) {
    const ownPayment = await request(app)
      .patch(`/api/events/${created.body.id}/participants/${hiddenMemberId}/payment`)
      .set('x-test-player-id', hiddenMemberId)
      .send({ paid: true });
    assert.equal(ownPayment.status, 404);
    assert.equal(ownPayment.body.error, 'Event nicht gefunden.');

  }
  const reminderTopic = `event-payment-reminder:${memberOneId}:${created.body.id}`;
  recordPushLog(
    [memberOneId],
    { title: 'Offener Event-Beitrag', body: 'Bitte bezahlen.' },
    'direct',
    { key: reminderTopic },
    { groupId: DEFAULT_GROUP_ID, eventId: created.body.id },
  );

  const selfPaid = await request(app)
    .patch(`/api/events/${created.body.id}/participants/${memberOneId}/payment`)
    .set('x-test-player-id', memberOneId)
    .send({ paid: true });
  assert.equal(selfPaid.status, 200, JSON.stringify(selfPaid.body));
  assert.equal(selfPaid.body.playerId, memberOneId);
  assert.equal(selfPaid.body.paid, true);
  assert.equal(selfPaid.body.paidBy, memberOneId);
  assert.equal(selfPaid.body.paidAmountCents, 2550);
  assert.ok(selfPaid.body.paidAt);
  assert.ok(
    (db.prepare('SELECT resolved_at AS resolvedAt FROM push_log WHERE topic_key = ?').get(reminderTopic) as {
      resolvedAt: number | null;
    }).resolvedAt,
    'recording payment resolves the active reminder immediately',
  );

  const cannotChangeOther = await request(app)
    .patch(`/api/events/${created.body.id}/participants/${memberOneId}/payment`)
    .set('x-test-player-id', memberTwoId)
    .send({ paid: false });
  assert.equal(cannotChangeOther.status, 403);

  const creatorPaid = await request(app)
    .patch(`/api/events/${created.body.id}/participants/${memberTwoId}/payment`)
    .send({ paid: true });
  assert.equal(creatorPaid.status, 200, JSON.stringify(creatorPaid.body));
  assert.equal(creatorPaid.body.paidBy, TEST_ADMIN_ID);

  const removedBulkAction = await request(app)
    .patch(`/api/events/${created.body.id}/participants/payment`)
    .send({ paid: true });
  assert.equal(removedBulkAction.status, 404);

  const memberList = await request(app).get('/api/events').set('x-test-player-id', memberOneId);
  const event = memberList.body.availableEvents.find((candidate: { id: string }) => candidate.id === created.body.id);
  assert.ok(event);
  const ownPayment = event.acceptedParticipants.find(
    (participant: { playerId: string }) => participant.playerId === memberOneId,
  );
  assert.equal(ownPayment.paid, true);
  assert.equal(ownPayment.paidBy, memberOneId);
  assert.equal(ownPayment.paidByName, 'Payment Member One');
  assert.equal(ownPayment.paidAmountCents, 2550);
  assert.ok(ownPayment.paidAt);
  assert.equal('accommodationCostCents' in event, false, 'members must not receive the organizer invoice');
  for (const participant of event.acceptedParticipants.filter(
    (candidate: { playerId: string }) => candidate.playerId !== memberOneId,
  )) {
    assert.equal('paid' in participant, false, 'members must not receive another participant payment state');
    assert.equal('paymentLocked' in participant, false, 'member rosters must not reveal another payment lock');
    assert.equal('paidBy' in participant, false);
    assert.equal('paidAt' in participant, false);
    assert.equal('paidAmountCents' in participant, false);
  }

  const nonCreatorAdminList = await request(app).get('/api/events').set('x-test-player-id', memberTwoId);
  const managedEvent = nonCreatorAdminList.body.managedEvents.find(
    (candidate: { id: string }) => candidate.id === created.body.id,
  );
  assert.ok(managedEvent);
  assert.equal(managedEvent.accommodationCostCents, 10000);
  const creatorPaymentView = (await request(app).get('/api/events')).body.managedEvents.find(
    (candidate: { id: string }) => candidate.id === created.body.id,
  );
  assert.equal(
    creatorPaymentView.acceptedParticipants.find(
      (participant: { playerId: string }) => participant.playerId === memberTwoId,
    ).paid,
    true,
  );
  assert.equal(
    creatorPaymentView.acceptedParticipants.find(
      (participant: { playerId: string }) => participant.playerId === memberTwoId,
    ).paidAmountCents,
    2550,
  );
  assert.equal(
    creatorPaymentView.acceptedParticipants.find(
      (participant: { playerId: string }) => participant.playerId === memberThreeId,
    ).paid,
    false,
  );
  for (const participant of managedEvent.acceptedParticipants.filter(
    (candidate: { playerId: string }) => candidate.playerId !== memberTwoId,
  )) {
    assert.equal('paid' in participant, false, 'non-creator admins must not receive foreign payment states');
    assert.equal('paidAmountCents' in participant, false);
  }
  for (const participant of managedEvent.participants.filter(
    (candidate: { playerId: string }) => candidate.playerId !== memberTwoId,
  )) {
    assert.equal('paid' in participant, false, 'management rows must apply the same privacy boundary');
    assert.equal('paidAmountCents' in participant, false);
  }
  assert.equal(
    managedEvent.participants.find((participant: { playerId: string }) => participant.playerId === memberOneId)
      .paymentLocked,
    true,
    'non-payment managers receive only the removal lock, not foreign payment details',
  );
  assert.equal(
    managedEvent.participants.find((participant: { playerId: string }) => participant.playerId === memberThreeId)
      .paymentLocked,
    false,
  );

  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${memberOneId}/payment`)
        .set('x-test-player-id', memberOneId)
        .send({ paid: 'yes' })
    ).status,
    400,
  );
});

test('payment snapshots survive price, roster, status, and account changes', async () => {
  const firstId = '__event-payment-snapshot-first__';
  const secondId = '__event-payment-snapshot-second__';
  createMember(firstId, 'Snapshot First');
  createMember(secondId, 'Snapshot Second');
  const created = await createEvent('Snapshot-Abrechnung', 60_000, {
    costCents: 2550,
    accommodationCostCents: 10000,
  });
  accept(created.body.id, firstId);
  accept(created.body.id, secondId);

  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${firstId}/payment`)
        .set('x-test-player-id', firstId)
        .send({ paid: true })
    ).status,
    200,
  );
  assert.equal((await request(app).patch(`/api/events/${created.body.id}`).send({ costCents: 4000 })).status, 200);
  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${secondId}/payment`)
        .set('x-test-player-id', secondId)
        .send({ paid: true })
    ).status,
    200,
  );

  const creatorEvent = () =>
    request(app).get('/api/events').then((response) =>
      response.body.managedEvents.find((event: { id: string }) => event.id === created.body.id),
    );
  let settlement = await creatorEvent();
  assert.equal(settlement.settlementPaidCents, 6550);
  assert.equal(settlement.settlementPaidCount, 2);
  assert.equal(
    settlement.acceptedParticipants.find((participant: { playerId: string }) => participant.playerId === firstId)
      .paidAmountCents,
    2550,
  );
  assert.equal(
    settlement.acceptedParticipants.find((participant: { playerId: string }) => participant.playerId === secondId)
      .paidAmountCents,
    4000,
  );

  const directRemoval = await request(app).delete(`/api/events/${created.body.id}/participants/${secondId}`);
  assert.equal(directRemoval.status, 409);
  const rosterReplacement = await request(app)
    .put(`/api/events/${created.body.id}/participants`)
    .send({ playerIds: [firstId] });
  assert.equal(rosterReplacement.status, 409);
  const accountDeletion = await request(app).delete(`/api/players/${secondId}`);
  assert.equal(accountDeletion.status, 409);
  assert.match(accountDeletion.body.error, /Event-Zahlung.*zurückgesetzt/);
  assert.ok(db.prepare('SELECT 1 FROM players WHERE id = ?').get(secondId));
  settlement = await creatorEvent();
  assert.equal(settlement.settlementPaidCents, 6550, 'a blocked account deletion preserves the settlement');

  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), secondId);
  db.prepare("UPDATE event_participants SET status = 'declined' WHERE event_id = ? AND player_id = ?").run(
    created.body.id,
    secondId,
  );
  settlement = await creatorEvent();
  assert.equal(settlement.settlementPaidCents, 6550);
  assert.equal(settlement.settlementPaidCount, 2);
  assert.equal(
    settlement.acceptedParticipants.some((participant: { playerId: string }) => participant.playerId === secondId),
    false,
  );

  db.prepare('UPDATE event_participants SET paid_amount_cents = NULL WHERE event_id = ? AND player_id = ?').run(
    created.body.id,
    secondId,
  );
  settlement = await creatorEvent();
  assert.equal(settlement.settlementPaidCents, 2550, 'an unknown legacy amount must not fall back to today\'s price');
  assert.equal(settlement.settlementMissingAmountCount, 1);

  db.prepare("UPDATE event_participants SET status = 'accepted' WHERE event_id = ? AND player_id = ?").run(
    created.body.id,
    secondId,
  );
  const reset = await request(app)
    .patch(`/api/events/${created.body.id}/participants/${secondId}/payment`)
    .send({ paid: false });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.paidAmountCents, null);
  assert.equal((await request(app).delete(`/api/events/${created.body.id}/participants/${secondId}`)).status, 204);
  assert.equal((await request(app).delete(`/api/players/${secondId}`)).status, 204);
});

test('a paid participant can reset after the contribution is cleared', async () => {
  const memberId = '__event-payment-reset-without-cost__';
  createMember(memberId, 'Reset Without Cost');
  const created = await createEvent('Zahlung ohne aktuellen Beitrag', 60_000, {
    costCents: 2550,
    accommodationCostCents: 10000,
  });
  accept(created.body.id, memberId);

  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${memberId}/payment`)
        .set('x-test-player-id', memberId)
        .send({ paid: true })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}`)
        .send({ costCents: null, accommodationCostCents: null, paypalLink: null, paymentDueAt: null })
    ).status,
    200,
  );

  const reset = await request(app)
    .patch(`/api/events/${created.body.id}/participants/${memberId}/payment`)
    .set('x-test-player-id', memberId)
    .send({ paid: false });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.paidAmountCents, null);
  assert.equal((await request(app).delete(`/api/events/${created.body.id}/participants/${memberId}`)).status, 204);
  assert.equal((await request(app).delete(`/api/players/${memberId}`)).status, 204);
});

test('the group owner takes over payment management when the event creator is inactive or missing', async () => {
  const creatorId = '__event-payment-inactive-creator__';
  const attendeeId = '__event-payment-fallback-attendee__';
  createMember(creatorId, 'Inactive Event Creator');
  createMember(attendeeId, 'Fallback Attendee');
  db.prepare("UPDATE group_memberships SET role = 'admin' WHERE group_id = ? AND player_id = ?").run(
    DEFAULT_GROUP_ID,
    creatorId,
  );
  const created = await request(app)
    .post('/api/events')
    .set('x-test-player-id', creatorId)
    .send({
      name: 'Vertretungsabrechnung',
      startsAt: Date.now() + 120_000,
      endsAt: Date.now() + 180_000,
      costCents: 3000,
      accommodationCostCents: 6000,
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  accept(created.body.id, attendeeId);
  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${attendeeId}/payment`)
        .set('x-test-player-id', creatorId)
        .send({ paid: true })
    ).status,
    200,
  );

  let ownerEvent = (await request(app).get('/api/events')).body.managedEvents.find(
    (event: { id: string }) => event.id === created.body.id,
  );
  assert.equal(ownerEvent.canManagePayments, false, 'an active creator keeps the owner fallback closed');
  assert.equal('settlementPaidCents' in ownerEvent, false);
  for (const collection of [ownerEvent.acceptedParticipants, ownerEvent.participants]) {
    const attendee = collection.find((participant: { playerId: string }) => participant.playerId === attendeeId);
    assert.equal('paid' in attendee, false);
    assert.equal('paidAmountCents' in attendee, false);
  }
  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${attendeeId}/payment`)
        .send({ paid: false })
    ).status,
    403,
    'the owner cannot change a foreign event payment while its creator is active',
  );

  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), creatorId);

  ownerEvent = (await request(app).get('/api/events')).body.managedEvents.find(
    (event: { id: string }) => event.id === created.body.id,
  );
  assert.equal(ownerEvent.canManagePayments, true);
  assert.equal(ownerEvent.settlementPaidCents, 3000);
  assert.equal(
    (
      await request(app)
        .patch(`/api/events/${created.body.id}/participants/${attendeeId}/payment`)
        .send({ paid: true })
    ).status,
    200,
  );

  db.prepare('UPDATE events SET created_by = NULL WHERE id = ?').run(created.body.id);
  ownerEvent = (await request(app).get('/api/events')).body.managedEvents.find(
    (event: { id: string }) => event.id === created.body.id,
  );
  assert.equal(ownerEvent.canManagePayments, true);
  assert.equal(ownerEvent.settlementPaidCents, 3000);
});

test("GET /api/events scopes the active event's participantIds to accepted participants, not the whole roster", async () => {
  // Regression: the Team-formation/Turnier/Draft player pickers filter to
  // this list client-side (see public/js/state.js eventPlayers()). Without
  // it, a picker offered the entire roster and submitting a non-participant
  // failed server-side (competitionPlayersBelongToGroup) with a confusing 404.
  const event = await createEvent('Testevent Rangliste');
  assert.equal(event.status, 201, JSON.stringify(event.body));
  const eventId = event.body.id;

  accept(eventId, TEST_ADMIN_ID);
  const acceptedPlayer = await request(app).post('/api/players').send({ name: 'Angenommen' });
  accept(eventId, acceptedPlayer.body.id);
  const invitedPlayer = await request(app).post('/api/players').send({ name: 'Nur eingeladen' });
  db.prepare(`INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'invited')`).run(
    eventId,
    invitedPlayer.body.id,
  );
  const outsidePlayer = await request(app).post('/api/players').send({ name: 'Nicht eingeladen' });

  const activated = await request(app).put('/api/me/active-event').send({ eventId });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));

  const list = await request(app).get('/api/events');
  assert.equal(list.status, 200);
  assert.equal(list.body.activeEvent.id, eventId);
  const participantIds: string[] = list.body.activeEvent.participantIds;
  assert.ok(participantIds.includes(TEST_ADMIN_ID));
  assert.ok(participantIds.includes(acceptedPlayer.body.id));
  assert.ok(!participantIds.includes(invitedPlayer.body.id));
  assert.ok(!participantIds.includes(outsidePlayer.body.id));

  const resetActive = await request(app).put('/api/me/active-event').send({ eventId: BASE_EVENT_ID });
  assert.equal(resetActive.status, 200, JSON.stringify(resetActive.body));
});

let eventAId: string;
let eventBId: string;

test('overlapping events coexist and can both enable tracking', async () => {
  const [eventA, eventB] = await Promise.all([createEvent('LAN Winter 2027'), createEvent('Parallel-Event')]);
  assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
  assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
  eventAId = eventA.body.id;
  eventBId = eventB.body.id;

  const [startA, startB] = await Promise.all([
    request(app).post(`/api/events/${eventAId}/tracking/start`),
    request(app).post(`/api/events/${eventBId}/tracking/start`),
  ]);
  assert.equal(startA.status, 200, JSON.stringify(startA.body));
  assert.equal(startB.status, 200, JSON.stringify(startB.body));
  assert.equal(startA.body.trackingEnabled, true);
  assert.equal(startB.body.trackingEnabled, true);
});

test('tracking follows the reporting account active event only', async () => {
  const tracked = await request(app).post('/api/players').send({ name: 'Event Tracking Player' });
  const baseOnly = await request(app).post('/api/players').send({ name: 'Base Tracking Player' });
  enableTestTracking(tracked.body.id, eventAId);

  const trackedReport = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', tracked.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  const baseReport = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', baseOnly.body.api_key)
    .send({ processNames: ['cs2.exe'] });
  assert.equal(trackedReport.body.tracked, true);
  assert.equal(baseReport.body.tracked, false);
  assert.equal(
    (db.prepare('SELECT event_id AS eventId FROM play_sessions WHERE player_id = ? AND ended_at IS NULL').get(
      tracked.body.id,
    ) as { eventId: string }).eventId,
    eventAId,
  );
});

test('operational writes use the requesting account active event', async () => {
  accept(eventAId, TEST_ADMIN_ID);
  const activated = await request(app).put('/api/me/active-event').send({ eventId: eventAId });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));

  const players = await Promise.all([
    request(app).post('/api/players').send({ name: 'Event Match A' }),
    request(app).post('/api/players').send({ name: 'Event Match B' }),
  ]);
  for (const player of players) accept(eventAId, player.body.id);
  const game = (await request(app).get('/api/games')).body[0];
  const match = await request(app).post('/api/matches').send({
    gameId: game.id,
    teams: [{ playerIds: [players[0].body.id] }, { playerIds: [players[1].body.id] }],
    winnerTeamIndex: 0,
  });
  assert.equal(match.status, 201, JSON.stringify(match.body));
  assert.equal(match.body.eventId, eventAId);
});

test('stopping tracking does not remove the event workspace', async () => {
  const stopped = await request(app).post(`/api/events/${eventAId}/tracking/stop`);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.trackingEnabled, false);
  assert.equal((await request(app).get('/api/events/active')).body.id, eventAId);
});

test('ending the active event falls the account back to the base event', async () => {
  const ended = await request(app).post(`/api/events/${eventAId}/end`);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal(ended.body.isEnded, true);
  assert.equal((await request(app).get('/api/events/active')).body.id, BASE_EVENT_ID);
  assert.equal((await request(app).post(`/api/events/${eventAId}/tracking/start`)).status, 400);
});

test('the base event cannot be ended, cancelled or removed from the roster', async () => {
  assert.equal((await request(app).post(`/api/events/${BASE_EVENT_ID}/end`)).status, 409);
  assert.equal((await request(app).delete(`/api/events/${BASE_EVENT_ID}`)).status, 409);
  assert.equal((await request(app).delete(`/api/events/${BASE_EVENT_ID}/participants/${TEST_ADMIN_ID}`)).status, 409);
});

test('event metadata remains editable without changing tracking state', async () => {
  const before = await request(app).get(`/api/events/${eventBId}`);
  const updated = await request(app).patch(`/api/events/${eventBId}`).send({ location: 'Neue Halle' });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.location, 'Neue Halle');
  assert.equal(updated.body.trackingEnabled, before.body.trackingEnabled);

  const invalid = await request(app).patch(`/api/events/${eventBId}`).send({ endsAt: updated.body.startsAt - 1 });
  assert.equal(invalid.status, 400);
});

test('an ended event can be restarted in an emergency', async () => {
  const normalStart = await request(app).post(`/api/events/${eventAId}/tracking/start`).send({});
  assert.equal(normalStart.status, 400);

  const otherStart = await request(app).post(`/api/events/${eventBId}/tracking/start`).send({});
  assert.equal(otherStart.status, 200);

  const res = await request(app).post(`/api/events/${eventAId}/restart`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.isEnded, false);
  assert.equal(res.body.trackingEnabled, true);
  assert.equal(res.body.status, 'published');

  await request(app).post(`/api/events/${eventAId}/tracking/stop`).send({});
});

test('ending and restarting an event are serialized when requested concurrently', async () => {
  const created = await createEvent('Concurrent lifecycle change');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  assert.equal((await request(app).post(`/api/events/${eventId}/end`)).status, 200);

  const [restart, end] = await Promise.all([
    request(app).post(`/api/events/${eventId}/restart`).send({}),
    request(app).post(`/api/events/${eventId}/end`).send({}),
  ]);
  assert.equal(restart.status, 200, JSON.stringify(restart.body));
  assert.equal(end.status, 200, JSON.stringify(end.body));

  const finalState = await request(app).get(`/api/events/${eventId}`);
  assert.equal(finalState.status, 200, JSON.stringify(finalState.body));
  assert.equal(finalState.body.isEnded, true, 'the later end request must not be undone by restart');
  assert.equal(finalState.body.trackingEnabled, false);
});

test('the management shape is a strict superset of the summary shape', async () => {
  // A member only ever receives the summary shape, an admin additionally the
  // management shape — and both render through the same frontend cards. When
  // the two disagreed on field names (`starts_at` vs. `startsAt`), every
  // member-visible event showed "Invalid Date" and "0 Teilnehmer".
  const created = await createEvent('Shape-Vergleich');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  accept(created.body.id, TEST_ADMIN_ID);
  const list = await request(app).get('/api/events');
  assert.equal(list.status, 200);

  const summary = list.body.availableEvents.find((event: { id: string }) => event.id === created.body.id);
  const managed = list.body.managedEvents.find((event: { id: string }) => event.id === created.body.id);
  assert.ok(summary, 'the accepted event is part of the personal workspace list');
  assert.ok(managed, 'the same event is part of the administrative catalog');

  for (const [key, value] of Object.entries(summary)) {
    assert.deepEqual(managed[key], value, `management and summary shape disagree on "${key}"`);
  }
  assert.equal(typeof summary.startsAt, 'number');
  assert.equal(managed.starts_at, undefined, 'the snake_case duplicate is gone for good');
  assert.equal(managed.ends_at, undefined, 'the snake_case duplicate is gone for good');
  assert.ok(Array.isArray(managed.participantIds), 'only the management shape carries participants');
  assert.equal(summary.participantIds, undefined, 'a member never receives the participant roster');

  // The lifecycle state itself is not management data: the workspace switcher
  // labels every event it offers with it, and a member only ever receives the
  // summary shape. It describes the event, never its participants — the
  // roster above stays management-only.
  assert.equal(typeof summary.trackingEnabled, 'boolean', 'the switcher needs the tracking state of every workspace');
  assert.equal(typeof summary.isEnded, 'boolean', 'the switcher distinguishes an ended event from a running one');
});

test('the workspace list reports the lifecycle state it labels events with', async () => {
  const created = await createEvent('Statusanzeige');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  accept(created.body.id, TEST_ADMIN_ID);

  const idle = await request(app).get('/api/events');
  const beforeTracking = idle.body.availableEvents.find((event: { id: string }) => event.id === created.body.id);
  assert.equal(beforeTracking.trackingEnabled, false);
  assert.equal(beforeTracking.isEnded, false);

  const started = await request(app).post(`/api/events/${created.body.id}/tracking/start`);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const tracking = await request(app).get('/api/events');
  const whileTracking = tracking.body.availableEvents.find((event: { id: string }) => event.id === created.body.id);
  assert.equal(whileTracking.trackingEnabled, true, 'a tracking event is distinguishable in the switcher');

  // The permanent base workspace is always offered and never reports as ended.
  const base = tracking.body.availableEvents.find((event: { isBase: boolean }) => event.isBase);
  assert.ok(base, 'the base workspace stays selectable');
  assert.equal(base.isEnded, false);
});

test('the participation history keeps a finished event available to personal analytics', async () => {
  // Two lists with two different jobs. `availableEvents` answers "where can I
  // work right now" and therefore drops an event the moment it ends;
  // `historicalEvents` answers "what did I take part in" and must keep it,
  // because a finished LAN is the main thing anyone opens an event filter
  // for. The analytics endpoints accept exactly the second list
  // (resolveAnalyticsEvents), so a filter built from it can never offer
  // something they answer with a 404.
  const created = await createEvent('Vergangene LAN');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  accept(eventId, TEST_ADMIN_ID);

  const beforeEnd = await request(app).get('/api/events');
  assert.ok(
    beforeEnd.body.historicalEvents.some((event: { id: string }) => event.id === eventId),
    'accepting an event records the participation immediately',
  );

  assert.equal((await request(app).post(`/api/events/${eventId}/end`)).status, 200);

  const afterEnd = await request(app).get('/api/events');
  assert.equal(
    afterEnd.body.availableEvents.some((event: { id: string }) => event.id === eventId),
    false,
    'an ended event is no longer a workspace anyone can switch into',
  );
  const historical = afterEnd.body.historicalEvents.find((event: { id: string }) => event.id === eventId);
  assert.ok(historical, 'but it stays in the participation history the event filters are built from');
  assert.equal(historical.isEnded, true, 'and it carries the state the filter labels it with');
  assert.ok(
    afterEnd.body.historicalEvents.some((event: { isBase: boolean }) => event.isBase),
    'the permanent base workspace is part of the history like any other accepted event',
  );

  // The contract the filter depends on: what the list offers, the analytics
  // endpoints accept.
  const scoped = await request(app).get(`/api/players/${TEST_ADMIN_ID}/stats?eventId=${eventId}`);
  assert.equal(scoped.status, 200, JSON.stringify(scoped.body));
  assert.equal(scoped.body.eventId, eventId);
});

test("a member's own ended event moves into their Historie with full card detail", async () => {
  // availableEvents intentionally excludes an ended event (see the test
  // above); the Events tab's own collapsed "Historie" for a plain member
  // needs the same rich accepted-participant/payment detail an active member
  // card has, which the lighter historicalEvents summary does not carry.
  // That is what `endedEvents` exists for (see events.js's renderEventSection).
  const memberId = 'historie-member';
  createMember(memberId, 'Historie Member');
  const created = await createEvent('Historie LAN');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  accept(eventId, memberId);

  const beforeEnd = await request(app).get('/api/events').set('x-test-player-id', memberId);
  assert.equal(beforeEnd.status, 200);
  assert.ok(beforeEnd.body.availableEvents.some((event: { id: string }) => event.id === eventId));
  assert.equal(beforeEnd.body.endedEvents.length, 0);

  assert.equal((await request(app).post(`/api/events/${eventId}/end`)).status, 200);

  const afterEnd = await request(app).get('/api/events').set('x-test-player-id', memberId);
  assert.equal(afterEnd.status, 200);
  assert.equal(
    afterEnd.body.availableEvents.some((event: { id: string }) => event.id === eventId),
    false,
    'still not a switchable workspace',
  );
  const ended = afterEnd.body.endedEvents.find((event: { id: string }) => event.id === eventId);
  assert.ok(ended, 'the ended event reaches the member through its own field');
  assert.equal(ended.isEnded, true);
  assert.ok(
    Array.isArray(ended.acceptedParticipants) &&
      ended.acceptedParticipants.some((p: { playerId: string }) => p.playerId === memberId),
    'the card needs the same accepted-participant detail an active member card has',
  );
});

test('the participation history drops an event that was called off', async () => {
  // Cancelling only flips events.status; roster and history rows survive, and
  // the server-side allowlist in historicallyParticipatedEventIds() does not
  // filter on status either. So an accepted-then-cancelled event would reach
  // the event filters and be labelled by eventStatus(), which knows no
  // "abgesagt" — it would read as "Nicht aktiv" and select an empty dataset
  // for a LAN that never took place.
  const created = await createEvent('Abgesagte LAN');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  accept(eventId, TEST_ADMIN_ID);
  assert.ok((await request(app).get('/api/events')).body.historicalEvents.some((e: { id: string }) => e.id === eventId));

  const cancelled = await request(app).delete(`/api/events/${eventId}`);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, 'cancelled');

  const afterCancel = await request(app).get('/api/events');
  assert.equal(
    afterCancel.body.historicalEvents.some((event: { id: string }) => event.id === eventId),
    false,
    'a cancelled event is not something anyone took part in',
  );
  assert.equal(
    afterCancel.body.availableEvents.some((event: { id: string }) => event.id === eventId),
    false,
  );
});

test('the participation history never offers an event this account only manages', async () => {
  const foreign = await createEvent('Fremdes Event');
  assert.equal(foreign.status, 201, JSON.stringify(foreign.body));
  const foreignId = foreign.body.id as string;
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(foreignId, TEST_ADMIN_ID);
  db.prepare('DELETE FROM event_participation_history WHERE event_id = ? AND player_id = ?').run(
    foreignId,
    TEST_ADMIN_ID,
  );

  const list = await request(app).get('/api/events');
  assert.ok(
    list.body.managedEvents.some((event: { id: string }) => event.id === foreignId),
    'an admin still manages it',
  );
  assert.equal(
    list.body.historicalEvents.some((event: { id: string }) => event.id === foreignId),
    false,
    'managing an event is not taking part in it, so it stays out of personal analytics',
  );
  assert.equal((await request(app).get(`/api/players/${TEST_ADMIN_ID}/stats?eventId=${foreignId}`)).status, 404);
});

test('unknown events stay non-enumerable', async () => {
  assert.equal((await request(app).get('/api/events/does-not-exist')).status, 404);
  assert.equal((await request(app).put('/api/me/active-event').send({ eventId: 'does-not-exist' })).status, 404);
});
