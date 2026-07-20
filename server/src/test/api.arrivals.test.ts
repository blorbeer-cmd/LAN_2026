// Integration tests for An-/Abreise + Fahrgemeinschaften: self-service
// arrival rows and carpool group lifecycle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

let alice: { id: string };
let bob: { id: string };
let carpoolId: string;

test('setup: two players', async () => {
  alice = (await request(app).post('/api/players').send({ name: 'Anreise Alice' })).body;
  bob = (await request(app).post('/api/players').send({ name: 'Anreise Bob' })).body;
});

test('GET /api/arrivals starts empty', async () => {
  const res = await request(app).get('/api/arrivals');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.arrivals, []);
  assert.deepEqual(res.body.carpools.arrival, []);
  assert.deepEqual(res.body.carpools.departure, []);
});

test('PUT /api/arrivals/mine upserts a player arrival row', async () => {
  const arrivalAt = Date.now() + 60_000;
  const departureAt = arrivalAt + 3_600_000;
  const res = await request(app)
    .put('/api/arrivals/mine')
    .send({ playerId: alice.id, arrivalAt, departureAt, note: 'komme nach der Arbeit' });
  assert.equal(res.status, 200);
  const row = res.body.arrivals.find((a: { player_id: string }) => a.player_id === alice.id);
  assert.ok(row);
  assert.equal(row.arrival_at, arrivalAt);
  assert.equal(row.departure_at, departureAt);
  assert.equal(row.note, 'komme nach der Arbeit');

  const update = await request(app).put('/api/arrivals/mine').send({ playerId: alice.id, arrivalAt: null, departureAt: null, note: '' });
  assert.equal(update.status, 200);
  const updated = update.body.arrivals.find((a: { player_id: string }) => a.player_id === alice.id);
  assert.equal(updated.arrival_at, null);
  assert.equal(updated.note, null);
});

test('PUT /api/arrivals/mine validates player and timestamps', async () => {
  const ghost = await request(app).put('/api/arrivals/mine').send({ playerId: 'ghost' });
  assert.equal(ghost.status, 404);
  const badTime = await request(app).put('/api/arrivals/mine').send({ playerId: alice.id, arrivalAt: 'soon' });
  assert.equal(badTime.status, 400);
});

test('POST /api/arrivals/carpools creates a group, joins the creator as driver, defaults 3 seats', async () => {
  const badDirection = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: alice.id, direction: 'sideways', label: 'Auto' });
  assert.equal(badDirection.status, 400);

  const badSeats = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: alice.id, direction: 'arrival', label: 'Auto', seatsTotal: 0 });
  assert.equal(badSeats.status, 400);

  const startAt = Date.now() + 3_600_000;
  const etaAt = startAt + 7_200_000;
  const res = await request(app)
    .post('/api/arrivals/carpools')
    .send({
      playerId: alice.id,
      direction: 'arrival',
      label: 'Auto Alice',
      startAt,
      startLocation: 'Hamburg',
      etaAt,
      seatsTotal: 2,
    });
  assert.equal(res.status, 201);
  carpoolId = res.body.id;
  assert.equal(res.body.direction, 'arrival');
  assert.equal(res.body.driverId, alice.id);
  assert.equal(res.body.startAt, startAt);
  assert.equal(res.body.startLocation, 'Hamburg');
  assert.equal(res.body.etaAt, etaAt);
  assert.equal(res.body.seatsTotal, 2);
  assert.equal(res.body.seatsFree, 2);
  assert.equal(res.body.members.length, 1);
  assert.equal(res.body.members[0].id, alice.id);

  const noSeatsGiven = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: bob.id, direction: 'departure', label: 'Auto Bob' });
  assert.equal(noSeatsGiven.status, 201);
  assert.equal(noSeatsGiven.body.seatsTotal, 3);
});

test('joining fills up seats; the driver can never leave, only delete', async () => {
  const joined = await request(app).post(`/api/arrivals/carpools/${carpoolId}/join`).send({ playerId: bob.id });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.members.length, 2);
  assert.equal(joined.body.seatsFree, 1);

  const carol = (await request(app).post('/api/players').send({ name: 'Anreise Carol' })).body;
  const dave = (await request(app).post('/api/players').send({ name: 'Anreise Dave' })).body;
  const joinedCarol = await request(app).post(`/api/arrivals/carpools/${carpoolId}/join`).send({ playerId: carol.id });
  assert.equal(joinedCarol.status, 200);
  assert.equal(joinedCarol.body.seatsFree, 0);

  // 2 seats total, already taken by bob + carol - dave can't fit.
  const full = await request(app).post(`/api/arrivals/carpools/${carpoolId}/join`).send({ playerId: dave.id });
  assert.equal(full.status, 409);

  const driverLeaves = await request(app).post(`/api/arrivals/carpools/${carpoolId}/leave`).send({ playerId: alice.id });
  assert.equal(driverLeaves.status, 400);

  const leftBob = await request(app).post(`/api/arrivals/carpools/${carpoolId}/leave`).send({ playerId: bob.id });
  assert.equal(leftBob.status, 200);
  assert.equal(leftBob.body.seatsFree, 1);

  // Freed seat lets dave in now.
  const joinedDave = await request(app).post(`/api/arrivals/carpools/${carpoolId}/join`).send({ playerId: dave.id });
  assert.equal(joinedDave.status, 200);
});

test('PATCH /api/arrivals/carpools/:id lets the driver update the plan, not passengers, not below current headcount', async () => {
  const notDriver = await request(app).patch(`/api/arrivals/carpools/${carpoolId}`).send({ playerId: bob.id, startLocation: 'Berlin' });
  assert.equal(notDriver.status, 403);

  // Currently 2 passengers seated (carol + dave) - can't shrink below that.
  const tooFew = await request(app).patch(`/api/arrivals/carpools/${carpoolId}`).send({ playerId: alice.id, seatsTotal: 1 });
  assert.equal(tooFew.status, 400);

  const ok = await request(app)
    .patch(`/api/arrivals/carpools/${carpoolId}`)
    .send({ playerId: alice.id, startLocation: 'Berlin', seatsTotal: 4 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.startLocation, 'Berlin');
  assert.equal(ok.body.seatsTotal, 4);
  assert.equal(ok.body.seatsFree, 2);
});

test('DELETE /api/arrivals/carpools/:id is driver-only', async () => {
  const created = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: alice.id, direction: 'departure', label: 'Zurück mit Alice' });
  assert.equal(created.status, 201);

  const foreignDelete = await request(app).delete(`/api/arrivals/carpools/${created.body.id}`).send({ playerId: bob.id });
  assert.equal(foreignDelete.status, 403);

  const ownDelete = await request(app).delete(`/api/arrivals/carpools/${created.body.id}`).send({ playerId: alice.id });
  assert.equal(ownDelete.status, 204);
});

test('creating and editing a carpool syncs the driver own arrival/departure', async () => {
  const erin = (await request(app).post('/api/players').send({ name: 'Anreise Erin' })).body;
  const etaAt = Date.now() + 5_000_000;
  const created = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: erin.id, direction: 'arrival', label: 'Auto Erin', etaAt });
  assert.equal(created.status, 201);

  let list = await request(app).get('/api/arrivals');
  let row = list.body.arrivals.find((a: { player_id: string }) => a.player_id === erin.id);
  assert.equal(row.arrival_at, etaAt);

  const newEta = etaAt + 1_000;
  const patched = await request(app).patch(`/api/arrivals/carpools/${created.body.id}`).send({ playerId: erin.id, etaAt: newEta });
  assert.equal(patched.status, 200);

  list = await request(app).get('/api/arrivals');
  row = list.body.arrivals.find((a: { player_id: string }) => a.player_id === erin.id);
  assert.equal(row.arrival_at, newEta);
});

test('joining syncs the passenger own arrival/departure; leaving and deleting reset it', async () => {
  const frank = (await request(app).post('/api/players').send({ name: 'Anreise Frank' })).body;
  const gina = (await request(app).post('/api/players').send({ name: 'Anreise Gina' })).body;
  const startAt = Date.now() + 2_000_000;
  const created = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: frank.id, direction: 'departure', label: 'Zurück Frank', startAt });
  assert.equal(created.status, 201);

  const joined = await request(app).post(`/api/arrivals/carpools/${created.body.id}/join`).send({ playerId: gina.id });
  assert.equal(joined.status, 200);
  let list = await request(app).get('/api/arrivals');
  let ginaRow = list.body.arrivals.find((a: { player_id: string }) => a.player_id === gina.id);
  assert.equal(ginaRow.departure_at, startAt);

  const left = await request(app).post(`/api/arrivals/carpools/${created.body.id}/leave`).send({ playerId: gina.id });
  assert.equal(left.status, 200);
  list = await request(app).get('/api/arrivals');
  ginaRow = list.body.arrivals.find((a: { player_id: string }) => a.player_id === gina.id);
  assert.equal(ginaRow.departure_at, null);

  let frankRow = list.body.arrivals.find((a: { player_id: string }) => a.player_id === frank.id);
  assert.equal(frankRow.departure_at, startAt);

  const deleted = await request(app).delete(`/api/arrivals/carpools/${created.body.id}`).send({ playerId: frank.id });
  assert.equal(deleted.status, 204);
  list = await request(app).get('/api/arrivals');
  frankRow = list.body.arrivals.find((a: { player_id: string }) => a.player_id === frank.id);
  assert.equal(frankRow.departure_at, null);
});
