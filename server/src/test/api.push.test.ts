// Integration tests for Web Push subscription management and the
// notify-hooks that fire real push notifications alongside the existing
// socket toasts. `pushTransport.send` is stubbed so tests never make a real
// network call to a push service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { pushTransport } from '../push';

const app = createApp();
let playerId: string;

test('setup: a player', async () => {
  const p = await request(app).post('/api/players').send({ name: 'Push Tester' });
  playerId = p.body.id;
});

test('GET /api/push/vapid-public-key returns a key', async () => {
  const res = await request(app).get('/api/push/vapid-public-key');
  assert.equal(res.status, 200);
  assert.ok(res.body.publicKey && res.body.publicKey.length > 0);
});

test('POST /api/push/subscribe rejects a missing playerId', async () => {
  const res = await request(app)
    .post('/api/push/subscribe')
    .send({ subscription: { endpoint: 'https://example.com/x', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(res.status, 400);
});

test('POST /api/push/subscribe rejects an unknown player', async () => {
  const res = await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId: 'ghost',
      subscription: { endpoint: 'https://example.com/x', keys: { p256dh: 'a', auth: 'b' } },
    });
  assert.equal(res.status, 404);
});

test('POST /api/push/subscribe rejects a malformed subscription', async () => {
  const res = await request(app).post('/api/push/subscribe').send({ playerId, subscription: { endpoint: 'x' } });
  assert.equal(res.status, 400);
});

test('POST /api/push/subscribe stores a valid subscription', async () => {
  const res = await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId,
      subscription: { endpoint: 'https://push.example.com/sub-1', keys: { p256dh: 'p-key', auth: 'a-key' } },
    });
  assert.equal(res.status, 201);
});

test('starting a new vote round pushes to subscribed players', async (t) => {
  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app).post('/api/votes/start');
  await request(app).post('/api/votes/cancel'); // leave votes clean for other test files

  assert.equal(sendMock.mock.calls.length, 1);
  const [subscription, payloadJson] = sendMock.mock.calls[0]!.arguments;
  assert.equal((subscription as { endpoint: string }).endpoint, 'https://push.example.com/sub-1');
  const payload = JSON.parse(payloadJson as string);
  assert.match(payload.title, /Abstimmung/);
});

test('a subscription that comes back as gone (410) is pruned', async (t) => {
  t.mock.method(pushTransport, 'send', async () => {
    const err = new Error('gone') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  });

  await request(app).post('/api/votes/start');
  // Give the fire-and-forget rejection handler a tick to run.
  await new Promise((r) => setTimeout(r, 20));
  await request(app).post('/api/votes/cancel');

  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app).post('/api/votes/start');
  await request(app).post('/api/votes/cancel');
  assert.equal(sendMock.mock.calls.length, 0, 'expired subscription should have been removed');
});

test('finishing a round-robin round pushes the next round\'s teams', async (t) => {
  // Mocked from the start: tournament creation fires its own "Neues Turnier"
  // push immediately, and the real webpush transport hitting these fake
  // endpoints would come back as gone (404/410) and prune the subscription
  // before we get to the assertion below.
  t.mock.method(pushTransport, 'send', async () => {});

  const game = await request(app).post('/api/games').send({ name: 'RR Push Test Game' });
  const gameId = game.body.id;
  const teamPlayerIds: string[] = [];
  for (const name of ['RR1', 'RR2', 'RR3']) {
    const p = await request(app).post('/api/players').send({ name });
    teamPlayerIds.push(p.body.id);
  }
  // The subscribed player (`playerId`, from the module-level setup test)
  // needs a subscription to receive this — reuse a fresh subscription so
  // this test doesn't depend on state left over from earlier ones.
  await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId,
      subscription: { endpoint: 'https://push.example.com/sub-rr', keys: { p256dh: 'p', auth: 'a' } },
    });

  // 3 solo teams, single-leg: circle method gives 3 rounds of 1 match each,
  // so team `playerId` is placed in a fixture for round 2 or 3, guaranteeing
  // there's a "next round" to be pushed once an earlier round completes.
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId,
      format: 'round_robin',
      teams: [{ playerIds: [playerId] }, { playerIds: [teamPlayerIds[0]] }, { playerIds: [teamPlayerIds[1]] }],
    });
  const tournamentId = created.body.id;
  const matches = created.body.matches; // ordered by round, slot

  // Re-mock to isolate just the calls made by recording this result (the
  // tournament creation above already triggered its own "Neues Turnier" push).
  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app)
    .post(`/api/tournaments/${tournamentId}/matches/${matches[0].id}/result`)
    .send({ winnerTeamId: matches[0].teamAId });

  assert.ok(sendMock.mock.calls.length >= 1, 'expected a push once round 1 completed');
  const payloads = sendMock.mock.calls.map((c) => JSON.parse(c.arguments[1] as string));
  assert.ok(payloads.some((p) => /nächstes Match/.test(p.body)));

  // Leave no subscription behind for `playerId` — later tests in this file
  // assert exact push counts and would otherwise pick up this extra device.
  await request(app).post('/api/push/unsubscribe').send({ endpoint: 'https://push.example.com/sub-rr' });
});

test('a match-ready push names the lobby and its default host (the upper bracket team)', async (t) => {
  t.mock.method(pushTransport, 'send', async () => {});

  const game = await request(app).post('/api/games').send({ name: 'Lobby Push Test Game' });
  const gameId = game.body.id;
  const teamPlayerIds: string[] = [];
  for (const name of ['LB1', 'LB2', 'LB3', 'LB4']) {
    const p = await request(app).post('/api/players').send({ name });
    teamPlayerIds.push(p.body.id);
  }
  await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId,
      subscription: { endpoint: 'https://push.example.com/sub-lobby', keys: { p256dh: 'p', auth: 'a' } },
    });

  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId,
      format: 'single_elimination',
      lobbyName: 'LAN2026',
      lobbyPassword: 'geheim',
      teams: [
        { name: 'HostTeam', playerIds: [playerId] },
        { name: 'OtherTeam', playerIds: [teamPlayerIds[0]] },
        { playerIds: [teamPlayerIds[1]] },
        { playerIds: [teamPlayerIds[2]] },
      ],
    });
  const tournamentId = created.body.id;
  const round1 = created.body.matches.filter((m: { round: number }) => m.round === 1);

  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  // Decide both round-1 matches so the final's teams (and thus a "match
  // ready" push) become known.
  await request(app)
    .post(`/api/tournaments/${tournamentId}/matches/${round1[0].id}/result`)
    .send({ winnerTeamId: round1[0].teamAId });
  await request(app)
    .post(`/api/tournaments/${tournamentId}/matches/${round1[1].id}/result`)
    .send({ winnerTeamId: round1[1].teamAId });

  const payloads = sendMock.mock.calls.map((c) => JSON.parse(c.arguments[1] as string));
  const matchReady = payloads.find((p) => /nächstes Match/.test(p.body));
  assert.ok(matchReady, 'expected a match-ready push once the final\'s teams were known');
  assert.match(matchReady.body, /Lobby "LAN2026"/);
  assert.match(matchReady.body, /PW: geheim/);
  assert.match(matchReady.body, /HostTeam eröffnet die Lobby/);

  await request(app).post('/api/push/unsubscribe').send({ endpoint: 'https://push.example.com/sub-lobby' });
});

test('POST /api/push/unsubscribe requires an endpoint', async () => {
  const res = await request(app).post('/api/push/unsubscribe');
  assert.equal(res.status, 400);
});

test('POST /api/push/unsubscribe removes a subscription', async (t) => {
  await request(app)
    .post('/api/push/subscribe')
    .send({
      playerId,
      subscription: { endpoint: 'https://push.example.com/sub-2', keys: { p256dh: 'p', auth: 'a' } },
    });

  const res = await request(app).post('/api/push/unsubscribe').send({ endpoint: 'https://push.example.com/sub-2' });
  assert.equal(res.status, 204);

  const sendMock = t.mock.method(pushTransport, 'send', async () => {});
  await request(app).post('/api/votes/start');
  await request(app).post('/api/votes/cancel');
  assert.equal(sendMock.mock.calls.length, 0);
});
