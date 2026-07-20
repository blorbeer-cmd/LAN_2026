// Required-auth tenant-boundary coverage for the legacy event-owned arrival
// and food-order tables. Their ownership is derived through events.group_id;
// a selected group must never reuse another group's globally active event.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const REALTIME_JS_PATH = path.join(__dirname, '..', 'realtime.js');
const RECOVERY_CODE = 'arrivals-food-orders-recovery-code';

test('arrivals and food orders resolve the current event and known resource ids inside the selected group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});
    const { setIo } = require(${JSON.stringify(REALTIME_JS_PATH)});

    function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
    function scoped(app, method, url, user, groupId) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', groupId);
    }

    (async () => {
      const app = createApp();
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Scope Alice',
        password: 'scope alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = {
        account: aliceResponse.body,
        cookie: cookie(aliceResponse),
        password: 'scope alice secure passphrase',
      };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie)
        .send({ password: alice.password })).status, 204);
      const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
      assert.equal(invite.status, 201, JSON.stringify(invite.body));
      const bobResponse = await request(app).post('/api/auth/register').send({
        code: invite.body.code,
        name: 'Scope Bob',
        password: 'scope bob secure passphrase',
      });
      assert.equal(bobResponse.status, 201, JSON.stringify(bobResponse.body));
      const bob = {
        account: bobResponse.body,
        cookie: cookie(bobResponse),
        password: 'scope bob secure passphrase',
      };

      for (const user of [alice, bob]) {
        assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', user.cookie)
          .send({ password: user.password })).status, 204);
      }
      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Arrival Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', bob.cookie).send({ name: 'Arrival Group B' });
      assert.equal(groupAResponse.status, 201, JSON.stringify(groupAResponse.body));
      assert.equal(groupBResponse.status, 201, JSON.stringify(groupBResponse.body));
      const groupA = groupAResponse.body.id;
      const groupB = groupBResponse.body.id;

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupA)
        .send({ name: 'Arrival Event A', startsAt: now - 1_000, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', bob, groupB)
        .send({ name: 'Arrival Event B', startsAt: now - 1_000, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice, groupA)
        .send({ playerIds: [alice.account.id] })).status, 200);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', bob, groupB)
        .send({ playerIds: [bob.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice, groupA)).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', bob, groupB)).status, 200);

      const deliveries = [];
      function fakeSocket(label, groupId, playerId) {
        return {
          data: { groupId, authPlayerId: playerId },
          emit(event, payload) { deliveries.push({ label, event, payload }); },
        };
      }
      setIo({
        sockets: { sockets: new Map([
          ['a', fakeSocket('A', groupA, alice.account.id)],
          ['b', fakeSocket('B', groupB, bob.account.id)],
        ]) },
        emit(event, payload) { deliveries.push({ label: 'global', event, payload }); },
      });

      try {
        const arrivalA = await scoped(app, 'put', '/api/arrivals/mine', alice, groupA)
          .send({ playerId: alice.account.id, arrivalAt: now + 1_000 });
        const arrivalB = await scoped(app, 'put', '/api/arrivals/mine', bob, groupB)
          .send({ playerId: bob.account.id, arrivalAt: now + 2_000 });
        assert.equal(arrivalA.status, 200, JSON.stringify(arrivalA.body));
        assert.equal(arrivalB.status, 200, JSON.stringify(arrivalB.body));
        assert.equal(arrivalA.body.eventId, eventA.body.id);
        assert.equal(arrivalB.body.eventId, eventB.body.id);
        assert.deepEqual(arrivalA.body.arrivals.map((row) => row.player_id), [alice.account.id]);
        assert.deepEqual(arrivalB.body.arrivals.map((row) => row.player_id), [bob.account.id]);

        const carpoolA = await scoped(app, 'post', '/api/arrivals/carpools', alice, groupA).send({
          playerId: alice.account.id,
          direction: 'arrival',
          label: 'A only carpool',
        });
        const carpoolB = await scoped(app, 'post', '/api/arrivals/carpools', bob, groupB).send({
          playerId: bob.account.id,
          direction: 'departure',
          label: 'B only carpool',
        });
        assert.equal(carpoolA.status, 201, JSON.stringify(carpoolA.body));
        assert.equal(carpoolB.status, 201, JSON.stringify(carpoolB.body));
        assert.equal(db.prepare('SELECT event_id FROM carpools WHERE id = ?').get(carpoolA.body.id).event_id, eventA.body.id);
        assert.equal(db.prepare('SELECT event_id FROM carpools WHERE id = ?').get(carpoolB.body.id).event_id, eventB.body.id);

        const orderA = await scoped(app, 'post', '/api/food-orders', alice, groupA).send({
          playerId: alice.account.id,
          title: 'A only order',
        });
        const orderB = await scoped(app, 'post', '/api/food-orders', bob, groupB).send({
          playerId: bob.account.id,
          title: 'B only order',
        });
        assert.equal(orderA.status, 201, JSON.stringify(orderA.body));
        assert.equal(orderB.status, 201, JSON.stringify(orderB.body));
        assert.equal(db.prepare('SELECT event_id FROM food_orders WHERE id = ?').get(orderA.body.id).event_id, eventA.body.id);
        assert.equal(db.prepare('SELECT event_id FROM food_orders WHERE id = ?').get(orderB.body.id).event_id, eventB.body.id);
        assert.deepEqual((await scoped(app, 'get', '/api/food-orders', alice, groupA)).body.orders.map((row) => row.title), ['A only order']);
        assert.deepEqual((await scoped(app, 'get', '/api/food-orders', bob, groupB)).body.orders.map((row) => row.title), ['B only order']);

        const itemId = 'known-a-item';
        db.prepare(
          'INSERT INTO food_order_items (id, order_id, player_id, description, quantity, price_cents, paid, created_at) VALUES (?, ?, ?, ?, 1, NULL, 0, ?)'
        ).run(itemId, orderA.body.id, alice.account.id, 'A private item', now);

        const snapshots = () => ({
          carpool: db.prepare('SELECT label, seats_total FROM carpools WHERE id = ?').get(carpoolA.body.id),
          members: db.prepare('SELECT player_id FROM carpool_members WHERE carpool_id = ? ORDER BY player_id').all(carpoolA.body.id),
          order: db.prepare('SELECT title, send_at, closed_at, finalized_at FROM food_orders WHERE id = ?').get(orderA.body.id),
          items: db.prepare('SELECT id, player_id, description, paid FROM food_order_items WHERE order_id = ? ORDER BY id').all(orderA.body.id),
        });
        const before = snapshots();

        async function foreign(method, url, body) {
          deliveries.length = 0;
          const response = await scoped(app, method, url, bob, groupB).send(body ?? {});
          assert.equal(response.status, 404, method.toUpperCase() + ' ' + url + ': ' + JSON.stringify(response.body));
          assert.deepEqual(deliveries, [], method.toUpperCase() + ' ' + url + ' emitted a realtime signal');
        }

        await foreign('patch', '/api/arrivals/carpools/' + carpoolA.body.id, {
          playerId: bob.account.id,
          label: 'foreign patch',
        });
        await foreign('post', '/api/arrivals/carpools/' + carpoolA.body.id + '/join', { playerId: bob.account.id });
        await foreign('post', '/api/arrivals/carpools/' + carpoolA.body.id + '/leave', { playerId: bob.account.id });
        await foreign('delete', '/api/arrivals/carpools/' + carpoolA.body.id, { playerId: bob.account.id });

        await foreign('patch', '/api/food-orders/' + orderA.body.id, { notes: 'foreign patch' });
        await foreign('post', '/api/food-orders/' + orderA.body.id + '/items', {
          playerId: bob.account.id,
          description: 'foreign item',
        });
        await foreign('delete', '/api/food-orders/' + orderA.body.id + '/items/' + itemId, { playerId: bob.account.id });
        await foreign('patch', '/api/food-orders/' + orderA.body.id + '/items/' + itemId, { paid: true });
        await foreign('post', '/api/food-orders/' + orderA.body.id + '/close');
        await foreign('post', '/api/food-orders/' + orderA.body.id + '/reopen');
        await foreign('post', '/api/food-orders/' + orderA.body.id + '/finalize');
        await foreign('delete', '/api/food-orders/' + orderA.body.id);

        assert.deepEqual(snapshots(), before, 'foreign-id requests changed group A data');
      } finally {
        setIo(null);
      }
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
      `group arrivals/food-orders child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
