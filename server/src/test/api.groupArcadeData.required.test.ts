import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const ARCADE_DATA_JS_PATH = path.join(__dirname, '..', 'arcade', 'arcadeData.js');
const RECOVERY_CODE = 'arcade-data-recovery-code';

test('arcade data and REST history stay isolated across groups, events and player assignments', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});
    const { recordArcadeResult } = require(${JSON.stringify(ARCADE_DATA_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }
    function scoped(app, method, url, user, groupId) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', groupId);
    }

    (async () => {
      const app = createApp();
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Arcade Alice',
        password: 'arcade alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'arcade alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie)
        .send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }

      const bob = await register('Arcade Bob', 'arcade bob secure passphrase');
      const carol = await register('Arcade Carol', 'arcade carol secure passphrase');
      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Arcade Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Arcade Group B' });
      assert.equal(groupAResponse.status, 201, JSON.stringify(groupAResponse.body));
      assert.equal(groupBResponse.status, 201, JSON.stringify(groupBResponse.body));
      const groupA = groupAResponse.body.id;
      const groupB = groupBResponse.body.id;

      for (const user of [alice, carol]) {
        const reauth = await request(app).post('/api/auth/reauth').set('Cookie', user.cookie).send({ password: user.password });
        assert.equal(reauth.status, 204);
      }

      async function addMember(owner, groupId, target) {
        const invite = await request(app).post('/api/groups/' + groupId + '/invites')
          .set('Cookie', owner.cookie).send({ targetPlayerId: target.account.id });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const accepted = await request(app).post('/api/groups/invites/' + invite.body.code + '/accept')
          .set('Cookie', target.cookie);
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      }
      await addMember(alice, groupA, bob);
      await addMember(carol, groupB, alice);

      for (const user of [alice, carol]) {
        const reauth = await request(app).post('/api/auth/reauth').set('Cookie', user.cookie).send({ password: user.password });
        assert.equal(reauth.status, 204);
      }

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupA)
        .send({ name: 'Arcade Event A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol, groupB)
        .send({ name: 'Arcade Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice, groupA)
        .send({ playerIds: [alice.account.id, bob.account.id] })).status, 200);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', carol, groupB)
        .send({ playerIds: [carol.account.id, alice.account.id] })).status, 200);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice, groupA).send({})).status, 200);
      const resultA = recordArcadeResult({
        gameType: 'quiz', winnerId: alice.account.id,
        players: [{ id: alice.account.id, name: 'Arcade Alice' }, { id: bob.account.id, name: 'Arcade Bob' }],
        scores: [{ playerId: alice.account.id, name: 'Arcade Alice', score: 5 }, { playerId: bob.account.id, name: 'Arcade Bob', score: 3 }],
        reason: 'completed', startedAt: now, endedAt: now + 1000,
      });
      assert.ok(resultA);
      assert.equal(recordArcadeResult({
        gameType: 'quiz', winnerId: alice.account.id,
        players: [{ id: alice.account.id, name: 'Arcade Alice' }, { id: carol.account.id, name: 'Arcade Carol' }],
        scores: [{ playerId: alice.account.id, name: 'Arcade Alice', score: 5 }, { playerId: carol.account.id, name: 'Arcade Carol', score: 3 }],
        reason: 'completed', startedAt: now, endedAt: now + 1000,
      }), null, 'a foreign player must reject the whole result write');
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice, groupA).send({})).status, 200);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol, groupB).send({})).status, 200);
      const resultB = recordArcadeResult({
        gameType: 'pong', winnerId: carol.account.id,
        players: [{ id: carol.account.id, name: 'Arcade Carol' }, { id: alice.account.id, name: 'Arcade Alice' }],
        scores: [{ playerId: carol.account.id, name: 'Arcade Carol', score: 7 }, { playerId: alice.account.id, name: 'Arcade Alice', score: 4 }],
        reason: 'completed', startedAt: now + 2000, endedAt: now + 3000,
      });
      assert.ok(resultB);

      const historyA = await scoped(app, 'get', '/api/arcade/history', alice, groupA);
      const historyB = await scoped(app, 'get', '/api/arcade/results', carol, groupB);
      assert.deepEqual(historyA.body.results.map((row) => row.id), [resultA]);
      assert.deepEqual(historyB.body.results.map((row) => row.id), [resultB]);
      assert.equal((await scoped(app, 'get', '/api/arcade/results/' + resultB, alice, groupA)).status, 404);
      assert.equal((await scoped(app, 'get', '/api/arcade/history', alice, groupA).query({ eventId: eventB.body.id })).status, 404);
      assert.equal((await scoped(app, 'get', '/api/arcade/results', alice, groupA).query({ playerId: carol.account.id })).status, 404);

      const statsA = await scoped(app, 'get', '/api/arcade/stats', alice, groupA);
      const statsB = await scoped(app, 'get', '/api/arcade/stats', carol, groupB);
      assert.deepEqual(statsA.body.games.map((game) => game.gameType), ['quiz']);
      assert.deepEqual(statsB.body.games.map((game) => game.gameType), ['pong']);
      const analyticsA = await scoped(app, 'get', '/api/analytics/arcade', alice, groupA);
      const analyticsB = await scoped(app, 'get', '/api/analytics/arcade', carol, groupB);
      assert.deepEqual(analyticsA.body.games.map((game) => game.gameType), ['quiz']);
      assert.deepEqual(analyticsB.body.games.map((game) => game.gameType), ['pong']);
      const exportA = await scoped(app, 'get', '/api/export', alice, groupA).query({ eventId: eventA.body.id });
      const exportB = await scoped(app, 'get', '/api/export', carol, groupB).query({ eventId: eventB.body.id });
      assert.deepEqual(exportA.body.arcadeResults.map((result) => result.id), [resultA]);
      assert.deepEqual(exportB.body.arcadeResults.map((result) => result.id), [resultB]);

      const memberQuestion = await scoped(app, 'post', '/api/quiz/questions', bob, groupA)
        .send({ question: 'Nicht erlaubt?', answers: ['Nein'], category: 'Test', difficulty: 'leicht' });
      assert.equal(memberQuestion.status, 403);
      const questionA = await scoped(app, 'post', '/api/quiz/questions', alice, groupA)
        .send({ question: 'Nur Gruppe A?', answers: ['Ja'], category: 'Test', difficulty: 'leicht' });
      assert.equal(questionA.status, 201, JSON.stringify(questionA.body));
      const questionsB = await scoped(app, 'get', '/api/quiz/questions', carol, groupB);
      assert.equal(questionsB.body.questions.some((question) => question.question === 'Nur Gruppe A?'), false);

      assert.equal((await request(app).delete('/api/groups/' + groupA + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)).status, 204);
      const stableHistory = await scoped(app, 'get', '/api/arcade/results/' + resultA, alice, groupA);
      assert.equal(stableHistory.status, 200);
      assert.equal(stableHistory.body.players.some((player) => player.name === 'Arcade Bob'), true);

      const globalTitles = db.prepare('SELECT COUNT(*) AS count FROM games WHERE arcade_key IS NOT NULL AND group_id IS NULL').get();
      assert.ok(globalTitles.count > 0, 'immutable Arcade title definitions remain global');
      assert.throws(() => db.prepare(
        "INSERT INTO arcade_result_participants (result_id, group_id, player_id, participant_key, player_name_snapshot, score_snapshot) VALUES (?, ?, ?, ?, 'Foreign', '{}')"
      ).run(resultA, groupA, carol.account.id, carol.account.id), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO arcade_results (id, group_id, event_id, game_type, winner_id, players, scores, reason, started_at, ended_at) VALUES ('bad-event-result', ?, ?, 'quiz', NULL, '[]', '[]', 'completed', ?, ?)"
      ).run(groupA, eventB.body.id, now, now + 1), /event group mismatch/);
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
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
      `group arcade data child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
