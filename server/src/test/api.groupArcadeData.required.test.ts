import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const ARCADE_DATA_JS_PATH = path.join(__dirname, '..', 'arcade', 'arcadeData.js');
const RECOVERY_CODE = 'arcade-data-recovery-code';

test('arcade data and REST history stay event-scoped inside the one real group', () => {
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
      const groupsResponse = await request(app).get('/api/groups').set('Cookie', alice.cookie);
      const groupId = groupsResponse.body[0].id;

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupId)
        .send({ name: 'Arcade Event A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice, groupId)
        .send({ playerIds: [alice.account.id, bob.account.id] })).status, 200);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice, groupId).send({})).status, 200);
      const resultA = recordArcadeResult({
        gameType: 'quiz', winnerId: alice.account.id,
        players: [{ id: alice.account.id, name: 'Arcade Alice' }, { id: bob.account.id, name: 'Arcade Bob' }],
        scores: [{ playerId: alice.account.id, name: 'Arcade Alice', score: 5 }, { playerId: bob.account.id, name: 'Arcade Bob', score: 3 }],
        reason: 'completed', startedAt: now, endedAt: now + 1000,
      });
      assert.ok(resultA);
      // A real player row with no active membership in this group (unlike a
      // merely nonexistent id, which recordArcadeResult silently drops
      // before the membership check even runs) must reject the whole write.
      const outsiderId = 'arcade-outsider';
      db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
        .run(outsiderId, 'Arcade Outsider', 'arcade-outsider-key', now);
      assert.equal(recordArcadeResult({
        gameType: 'quiz', winnerId: alice.account.id,
        players: [{ id: alice.account.id, name: 'Arcade Alice' }, { id: outsiderId, name: 'Arcade Outsider' }],
        scores: [{ playerId: alice.account.id, name: 'Arcade Alice', score: 5 }, { playerId: outsiderId, name: 'Arcade Outsider', score: 3 }],
        reason: 'completed', startedAt: now, endedAt: now + 1000,
      }), null, 'a player with no active membership must reject the whole result write');
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice, groupId).send({})).status, 200);

      // Only one event can track at a time - switch sequentially before
      // creating event B's own data.
      const eventB = await scoped(app, 'post', '/api/events', alice, groupId)
        .send({ name: 'Arcade Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', alice, groupId)
        .send({ playerIds: [alice.account.id, bob.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', alice, groupId).send({})).status, 200);
      const resultB = recordArcadeResult({
        gameType: 'pong', winnerId: bob.account.id,
        players: [{ id: bob.account.id, name: 'Arcade Bob' }, { id: alice.account.id, name: 'Arcade Alice' }],
        scores: [{ playerId: bob.account.id, name: 'Arcade Bob', score: 7 }, { playerId: alice.account.id, name: 'Arcade Alice', score: 4 }],
        reason: 'completed', startedAt: now + 2000, endedAt: now + 3000,
      });
      assert.ok(resultB);

      const historyA = await scoped(app, 'get', '/api/arcade/history', alice, groupId).query({ eventId: eventA.body.id });
      const historyB = await scoped(app, 'get', '/api/arcade/results', alice, groupId).query({ eventId: eventB.body.id });
      assert.deepEqual(historyA.body.results.map((row) => row.id), [resultA]);
      assert.deepEqual(historyB.body.results.map((row) => row.id), [resultB]);

      const statsA = await scoped(app, 'get', '/api/arcade/stats', alice, groupId);
      assert.ok(statsA.body.games.map((game) => game.gameType).includes('quiz'));
      assert.ok(statsA.body.games.map((game) => game.gameType).includes('pong'));

      const exportA = await scoped(app, 'get', '/api/export', alice, groupId).query({ eventId: eventA.body.id });
      const exportB = await scoped(app, 'get', '/api/export', alice, groupId).query({ eventId: eventB.body.id });
      assert.deepEqual(exportA.body.arcadeResults.map((result) => result.id), [resultA]);
      assert.deepEqual(exportB.body.arcadeResults.map((result) => result.id), [resultB]);

      const memberQuestion = await scoped(app, 'post', '/api/quiz/questions', bob, groupId)
        .send({ question: 'Nicht erlaubt?', answers: ['Nein'], category: 'Test', difficulty: 'leicht' });
      assert.equal(memberQuestion.status, 403);
      const questionA = await scoped(app, 'post', '/api/quiz/questions', alice, groupId)
        .send({ question: 'Eigene Gruppe?', answers: ['Ja'], category: 'Test', difficulty: 'leicht' });
      assert.equal(questionA.status, 201, JSON.stringify(questionA.body));

      // The start group can never remove a member (see routes/groups.ts) -
      // deactivating the account is the sanctioned path instead.
      assert.equal((await request(app).delete('/api/groups/' + groupId + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)).status, 409);

      const globalTitles = db.prepare('SELECT COUNT(*) AS count FROM games WHERE arcade_key IS NOT NULL AND group_id IS NULL').get();
      assert.ok(globalTitles.count > 0, 'immutable Arcade title definitions remain global');
      assert.throws(() => db.prepare(
        "INSERT INTO arcade_result_participants (result_id, group_id, player_id, participant_key, player_name_snapshot, score_snapshot) VALUES (?, ?, ?, ?, 'Foreign', '{}')"
      ).run(resultA, groupId, 'does-not-exist', 'does-not-exist'), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO arcade_results (id, group_id, event_id, game_type, winner_id, players, scores, reason, started_at, ended_at) VALUES ('bad-event-result', ?, ?, 'quiz', NULL, '[]', '[]', 'completed', ?, ?)"
      ).run(groupId, 'does-not-exist', now, now + 1), /event group mismatch/);
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
