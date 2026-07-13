// Integration tests for Web Push subscription management and the
// notify-hooks that fire real push notifications alongside the existing
// socket toasts. `pushTransport.send` is stubbed so tests never make a real
// network call to a push service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';
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

test('GET /api/push/last reflects the most recently sent notification, regardless of feature', async () => {
  await request(app).post('/api/votes/start');

  const afterVotes = await request(app).get('/api/push/last');
  assert.equal(afterVotes.status, 200);
  assert.match(afterVotes.body.entry.title, /Abstimmung/);

  await request(app).post('/api/votes/cancel');
  const afterCancel = await request(app).get('/api/push/last');
  assert.equal(afterCancel.status, 200);
  assert.equal(afterCancel.body.entry, null, 'a cancelled vote must leave the active banner');

  // A different feature's notifyPlayers() call (Durchsage) becomes the new
  // "last" entry — the log isn't scoped to one feature.
  const durchsage = await request(app).post('/api/broadcasts').send({ playerId, message: 'Pizza ist da!' });
  assert.equal(durchsage.status, 201);

  const afterBroadcast = await request(app).get('/api/push/last');
  assert.equal(afterBroadcast.status, 200);
  assert.match(afterBroadcast.body.entry.title, /📢/);
  assert.match(afterBroadcast.body.entry.body, /Pizza ist da!/);
  assert.ok(afterBroadcast.body.entry.createdAt > 0);
});

test('GET /api/push/current validates identity and skips resolved topics without deleting history', async () => {
  const missing = await request(app).get('/api/push/current');
  assert.equal(missing.status, 400);
  const unknown = await request(app).get('/api/push/current?playerId=ghost');
  assert.equal(unknown.status, 404);

  await request(app).post('/api/votes/start');
  const whileOpen = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.match(whileOpen.body.entry.title, /Abstimmung/);

  await request(app).post('/api/votes/close');
  const afterClose = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.ok(!/Abstimmung/.test(afterClose.body.entry?.title ?? ''));

  const history = await request(app).get(`/api/push/log?playerId=${playerId}`);
  assert.ok(history.body.entries.some((entry: { title: string }) => /Abstimmung/.test(entry.title)));
});

test('POST /api/push/:id/seen dismisses only this player\'s banner and keeps notification history', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Push Seen Other' });
  const created = await request(app).post('/api/broadcasts').send({ playerId, message: 'Persönlich wegklickbar' });
  assert.equal(created.status, 201);

  const current = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.match(current.body.entry.body, /Persönlich wegklickbar/);
  const pushId = current.body.entry.id as string;

  const missingPlayer = await request(app).post(`/api/push/${pushId}/seen`).send({});
  assert.equal(missingPlayer.status, 400);
  const unknownPlayer = await request(app).post(`/api/push/${pushId}/seen`).send({ playerId: 'ghost' });
  assert.equal(unknownPlayer.status, 404);
  const missingPush = await request(app).post('/api/push/missing/seen').send({ playerId });
  assert.equal(missingPush.status, 404);

  const seen = await request(app).post(`/api/push/${pushId}/seen`).send({ playerId });
  assert.equal(seen.status, 204);
  const repeated = await request(app).post(`/api/push/${pushId}/seen`).send({ playerId });
  assert.equal(repeated.status, 204);

  const ownAfter = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.notEqual(ownAfter.body.entry?.id, pushId);
  const otherAfter = await request(app).get(`/api/push/current?playerId=${other.body.id}`);
  assert.equal(otherAfter.body.entry.id, pushId);

  const history = await request(app).get(`/api/push/log?playerId=${playerId}`);
  assert.ok(history.body.entries.some((entry: { id: string }) => entry.id === pushId));
});

test('broadcast pushes disappear when ended by their creator or after their deadline', async () => {
  const ended = await request(app).post('/api/broadcasts').send({ playerId, message: 'Vorzeitig beenden' });
  assert.equal(ended.status, 201);
  let current = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.match(current.body.entry.body, /Vorzeitig beenden/);

  await request(app).post(`/api/broadcasts/${ended.body.id}/end`).send({ playerId });
  current = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.ok(!/Vorzeitig beenden/.test(current.body.entry?.body ?? ''));

  const expiring = await request(app)
    .post('/api/broadcasts')
    .send({ playerId, message: 'Automatisch ablaufen', endsAt: Date.now() + 50 });
  assert.equal(expiring.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 75));
  current = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.ok(!/Automatisch ablaufen/.test(current.body.entry?.body ?? ''));
});

test('closed and expired food-order pushes are omitted from active banners', async () => {
  const order = await request(app)
    .post('/api/food-orders')
    .send({ playerId, title: 'Push-Lifecycle-Pizza', sendAt: Date.now() + 60_000 });
  assert.equal(order.status, 201);

  const whileOpen = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.match(whileOpen.body.entry.body, /Push-Lifecycle-Pizza/);

  await request(app).post(`/api/food-orders/${order.body.id}/close`);
  const afterClose = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.ok(!/Push-Lifecycle-Pizza/.test(afterClose.body.entry?.body ?? ''));

  const expired = await request(app)
    .post('/api/food-orders')
    .send({ playerId, title: 'Schon-abgelaufen', sendAt: Date.now() - 1 });
  assert.equal(expired.status, 201);
  const afterExpiry = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.ok(!/Schon-abgelaufen/.test(afterExpiry.body.entry?.body ?? ''));
});

test('completed and cancelled drafts leave active banners', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Push Draft Game' });
  const players = await Promise.all(
    ['Draft Captain A', 'Draft Captain B', 'Draft Pick A', 'Draft Pick B'].map((name) =>
      request(app).post('/api/players').send({ name })
    )
  );
  const ids = players.map((player) => player.body.id as string);

  const first = await request(app)
    .post('/api/draft/start')
    .send({ gameId: game.body.id, captainIds: ids.slice(0, 2), poolPlayerIds: ids.slice(2) });
  assert.equal(first.status, 201);
  const active = await request(app).get(`/api/push/current?playerId=${ids[0]}`);
  assert.match(active.body.entry.title, /Captain-Draft/);

  await request(app).post('/api/draft/pick').send({ playerId: ids[0], pickPlayerId: ids[2] });
  const completed = await request(app).get(`/api/push/current?playerId=${ids[0]}`);
  assert.ok(!/Captain-Draft/.test(completed.body.entry?.title ?? ''));

  const second = await request(app)
    .post('/api/draft/start')
    .send({ gameId: game.body.id, captainIds: ids.slice(0, 2), poolPlayerIds: ids.slice(2) });
  assert.equal(second.status, 201);
  await request(app).post('/api/draft/cancel');
  const cancelled = await request(app).get(`/api/push/current?playerId=${ids[0]}`);
  assert.ok(!/Captain-Draft/.test(cancelled.body.entry?.title ?? ''));
});

test('GET /api/push/log returns entries relevant to the player, with deep-link url', async () => {
  const missing = await request(app).get('/api/push/log');
  assert.equal(missing.status, 400);
  const unknown = await request(app).get('/api/push/log?playerId=ghost');
  assert.equal(unknown.status, 404);

  await request(app).post('/api/broadcasts').send({ playerId, message: 'Feed-Eintrag für alle' });

  const res = await request(app).get(`/api/push/log?playerId=${playerId}`);
  assert.equal(res.status, 200);
  const entry = res.body.entries[0];
  assert.match(entry.body, /Feed-Eintrag für alle/);
  assert.equal(entry.url, '/#broadcast');
  assert.equal(entry.audience, 'all');
  assert.ok(entry.createdAt > 0);
});

test('GET /api/push/log hides entries the player was not a recipient of, and marks targeted ones as direct', async (t) => {
  t.mock.method(pushTransport, 'send', async () => {});

  // A tournament between two *other* players: its "dein Match ist bereit"
  // push targets only them, so it must appear in their feed (audience
  // 'direct') and never in the uninvolved subscriber's.
  const game = await request(app).post('/api/games').send({ name: 'Feed Filter Test Game' });
  const p1 = await request(app).post('/api/players').send({ name: 'Feed P1' });
  const p2 = await request(app).post('/api/players').send({ name: 'Feed P2' });
  const p3 = await request(app).post('/api/players').send({ name: 'Feed P3' });
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: game.body.id,
      name: 'Feed Filter Turnier',
      format: 'round_robin',
      teams: [{ playerIds: [p1.body.id] }, { playerIds: [p2.body.id] }, { playerIds: [p3.body.id] }],
    });
  const matches = created.body.matches;
  // Deciding round 1 sends the round-2 pairing their match-ready push.
  await request(app)
    .post(`/api/tournaments/${created.body.id}/matches/${matches[0].id}/result`)
    .send({ winnerTeamId: matches[0].teamAId });

  // Neither the created-push (recipients: the tournament's participants) nor
  // the match-ready push (recipients: the two paired teams) involved this
  // player, so their feed shows none of it.
  const uninvolved = await request(app).get(`/api/push/log?playerId=${playerId}`);
  assert.ok(
    !uninvolved.body.entries.some((e: { title: string }) => /Match ist bereit/.test(e.title)),
    'match-ready push must not appear for a player who was not a recipient'
  );
  assert.ok(!uninvolved.body.entries.some((e: { body: string }) => /Feed Filter Turnier/.test(e.body)));

  const round2 = matches.filter((m: { round: number }) => m.round === 2);
  const readyTeamIds = [round2[0].teamAId, round2[0].teamBId];
  const teamPlayers = created.body.teams
    .filter((team: { id: string }) => readyTeamIds.includes(team.id))
    .flatMap((team: { players: Array<{ id: string }> }) => team.players.map((p) => p.id));
  const involved = await request(app).get(`/api/push/log?playerId=${teamPlayers[0]}`);
  // Positive check that participant-scoped entries do land in a recipient's
  // feed: the created-push (audience 'all' within its recipient list) ...
  assert.ok(involved.body.entries.some((e: { body: string }) => /Feed Filter Turnier/.test(e.body)));
  // ... and the personally-targeted match-ready push, marked 'direct'.
  const matchReady = involved.body.entries.find((e: { title: string }) => /Match ist bereit/.test(e.title));
  assert.ok(matchReady, 'match-ready push must appear for a recipient');
  assert.equal(matchReady.audience, 'direct');
  assert.equal(matchReady.url, '/#tournaments');
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

  // GET /api/push/last is the Kiosk's shared-screen banner - a personally-
  // targeted push ("dein Match ist bereit", audience 'direct') would read as
  // if it applied to everyone glancing at the screen, so it must be skipped
  // in favor of the last 'all'-audience entry (this tournament's own
  // creation push), even though the direct one is chronologically newer.
  const last = await request(app).get('/api/push/last');
  assert.match(last.body.entry.title, /Neues Turnier/);

  const ready = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.match(ready.body.entry.title, /Match ist bereit/);

  const detail = await request(app).get(`/api/tournaments/${tournamentId}`);
  const finalMatch = detail.body.matches.find((match: { round: number }) => match.round === 2);
  assert.ok(finalMatch?.teamAId && finalMatch?.teamBId);
  await request(app)
    .post(`/api/tournaments/${tournamentId}/matches/${finalMatch.id}/result`)
    .send({ winnerTeamId: finalMatch.teamAId });

  const afterResult = await request(app).get(`/api/push/current?playerId=${playerId}`);
  assert.ok(!/Lobby "LAN2026"/.test(afterResult.body.entry?.body ?? ''));

  const unresolvedTournamentTopics = db
    .prepare("SELECT COUNT(*) AS count FROM push_log WHERE topic_key LIKE ? AND resolved_at IS NULL")
    .get(`tournament:${tournamentId}%`) as { count: number };
  assert.equal(unresolvedTournamentTopics.count, 0);

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
