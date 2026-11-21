import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createEvent } from '../events';
import { createTestApp, DEFAULT_GROUP_ID, enableTestTracking, TEST_ADMIN_ID } from './testApp';

async function trackingFixture(name: string) {
  const app = createTestApp();
  const event = createEvent(name, {
    groupId: DEFAULT_GROUP_ID,
    startsAt: Date.now() - 60_000,
    endsAt: Date.now() + 3_600_000,
  });
  enableTestTracking(TEST_ADMIN_ID, event.id);

  return {
    app,
    stats: (gameId?: string) =>
      request(app).get('/api/stats/playtime').query({ eventId: event.id, ...(gameId && { gameId }) }).expect(200),
    async addPlayer(playerName: string) {
      const { body } = await request(app).post('/api/players').send({ name: playerName }).expect(201);
      const { id, api_key: apiKey } = body as { id: string; api_key: string };
      enableTestTracking(id, event.id);
      return {
        id,
        report: (processNames: string[], activity: { foregroundProcessName?: unknown; idleSeconds?: unknown } = {}) =>
          request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames, ...activity }),
      };
    },
  };
}

test('playtime counts open sessions, freezes closed sessions and sums by player and game', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  const { app, stats, addPlayer } = await trackingFixture('Playtime lifecycle');
  const alice = await addPlayer('Playtime Alice');
  const bob = await addPlayer('Playtime Bob');
  const { body: games } = await request(app).get('/api/games').expect(200);
  const cs2 = games.find((game: { name: string }) => game.name === 'Counter-Strike 2');
  assert.deepEqual((await stats()).body.entries, []);

  await alice.report(['cs2.exe']).expect(200);
  t.mock.timers.tick(12_000);
  assert.equal((await stats()).body.entries[0].totalMs, 12_000);
  await alice.report([]).expect(200);
  t.mock.timers.tick(5_000);
  assert.equal((await stats()).body.entries[0].totalMs, 12_000, 'closed sessions stop accumulating time');

  await alice.report(['cs2.exe', 'rocketleague.exe']).expect(200);
  t.mock.timers.tick(18_000);
  await alice.report([]).expect(200);
  await bob.report(['cs2.exe']).expect(200);
  t.mock.timers.tick(9_000);
  await bob.report([]).expect(200);

  const { body } = await stats();
  const aliceTotal = body.totals.find((row: { playerId: string }) => row.playerId === alice.id);
  const cs2Total = body.totalsByGame.find((row: { gameId: string }) => row.gameId === cs2.id);
  assert.equal(aliceTotal.totalMs, 48_000, 'Alice played CS2 for 30s and Rocket League for 18s');
  assert.equal(aliceTotal.formatted, '1m');
  assert.equal(cs2Total.totalMs, 39_000, 'Alice played CS2 for 30s and Bob for 9s');
  assert.equal(cs2Total.gameName, 'Counter-Strike 2');

  const filtered = await stats(cs2.id);
  const { body: aliceStats } = await request(app).get(`/api/players/${alice.id}/stats`).expect(200);
  const aliceCs2 = aliceStats.games.find((row: { gameId: string }) => row.gameId === cs2.id);
  assert.deepEqual(filtered.body.entries.map((row: { gameId: string }) => row.gameId), [cs2.id, cs2.id]);
  assert.equal(aliceCs2.totalMs, 30_000);
  assert.equal(aliceStats.totalMs, 48_000);
  assert.equal(aliceStats.sessionCount, 3);
  assert.equal(aliceStats.distinctGamesCount, 2);
  assert.equal(aliceStats.events.length, 1);
  assert.ok(aliceStats.longestSessions.length > 0);
});

test('only a matching foreground game with no excessive idle time earns active playtime', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  const { stats, addPlayer } = await trackingFixture('Focused playtime');
  const player = await addPlayer('Focused player');
  await player.report(['cs2.exe']).expect(200);

  for (const { activity, expectedActiveMs } of [
    { activity: {}, expectedActiveMs: 0 },
    { activity: { foregroundProcessName: 'CS2.EXE', idleSeconds: 0 }, expectedActiveMs: 1_000 },
    { activity: { foregroundProcessName: 'discord.exe', idleSeconds: 0 }, expectedActiveMs: 1_000 },
    { activity: { foregroundProcessName: 'cs2.exe', idleSeconds: 999 }, expectedActiveMs: 1_000 },
  ]) {
    t.mock.timers.tick(1_000);
    await player.report(['cs2.exe'], activity).expect(200);
    assert.equal((await stats()).body.entries[0].activeMs, expectedActiveMs, JSON.stringify(activity));
  }
  assert.equal((await stats()).body.entries[0].totalMs, 4_000);
});

test('agent reports reject malformed activity fields', async () => {
  const { addPlayer } = await trackingFixture('Invalid activity metadata');
  const player = await addPlayer('Invalid activity reporter');
  await player.report(['cs2.exe'], { foregroundProcessName: 123 }).expect(400);
  await player.report(['cs2.exe'], { idleSeconds: 'a lot' }).expect(400);
});
