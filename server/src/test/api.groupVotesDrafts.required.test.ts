// Phase 5c Votes/Drafts tenant-boundary suite. A required-auth child process
// enables two groups and exercises group-local state, roles, player-reference
// validation, aggregates, history and export without changing delivery paths.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'votes-drafts-recovery-code';

test('votes and drafts stay isolated across two groups, roles, players, aggregates and exports', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db } = require(${JSON.stringify(DB_JS_PATH)});

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
        name: 'Votes Alice',
        password: 'votes alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'votes alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }

      const bob = await register('Votes Bob', 'votes bob secure passphrase');
      const carol = await register('Votes Carol', 'votes carol secure passphrase');
      const dave = await register('Votes Dave', 'votes dave secure passphrase');
      const eve = await register('Votes Eve', 'votes eve secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie).send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Votes Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Votes Group B' });
      assert.equal(groupAResponse.status, 201, JSON.stringify(groupAResponse.body));
      assert.equal(groupBResponse.status, 201, JSON.stringify(groupBResponse.body));
      const groupA = groupAResponse.body.id;
      const groupB = groupBResponse.body.id;

      async function addMember(owner, groupId, target) {
        const invite = await request(app)
          .post('/api/groups/' + groupId + '/invites')
          .set('Cookie', owner.cookie)
          .send({ targetPlayerId: target.account.id });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const accepted = await request(app)
          .post('/api/groups/invites/' + invite.body.code + '/accept')
          .set('Cookie', target.cookie);
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      }

      await addMember(alice, groupA, bob);
      await addMember(alice, groupA, eve);
      await addMember(carol, groupB, dave);
      await addMember(carol, groupB, alice);

      for (const user of [alice, carol]) {
        const reauth = await request(app).post('/api/auth/reauth').set('Cookie', user.cookie).send({ password: user.password });
        assert.equal(reauth.status, 204);
      }

      const gameA = await scoped(app, 'post', '/api/games', alice, groupA).send({ name: 'Vote Game A', status: 'catalog' });
      const gameB = await scoped(app, 'post', '/api/games', carol, groupB).send({ name: 'Vote Game B', status: 'catalog' });
      assert.equal(gameA.status, 201, JSON.stringify(gameA.body));
      assert.equal(gameB.status, 201, JSON.stringify(gameB.body));

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice, groupA).send({ name: 'Vote Event A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol, groupB).send({ name: 'Vote Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice, groupA)
        .send({ playerIds: [alice.account.id, bob.account.id, eve.account.id] })).status, 200);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', carol, groupB)
        .send({ playerIds: [carol.account.id, dave.account.id, alice.account.id] })).status, 200);

      // Vertical role checks: Bob is only A/member. Alice is the global
      // instance admin but only B/member; neither can moderate that group.
      assert.equal((await scoped(app, 'post', '/api/votes/start', bob, groupA).send({})).status, 403);
      assert.equal((await scoped(app, 'post', '/api/draft/start', bob, groupA).send({
        gameId: gameA.body.id, captainIds: [alice.account.id, bob.account.id], poolPlayerIds: [eve.account.id],
      })).status, 403);
      assert.equal((await scoped(app, 'post', '/api/votes/start', alice, groupB).send({})).status, 403);

      // Start A resources while A's event tracks, then switch tracking and
      // start B resources. Both vote rounds remain independently open.
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice, groupA).send({})).status, 200);
      const voteA = await scoped(app, 'post', '/api/votes/start', alice, groupA).send({ mode: 'single', title: 'A vote' });
      assert.equal(voteA.status, 201, JSON.stringify(voteA.body));
      assert.equal(voteA.body.eventId, eventA.body.id);

      const foreignDraft = await scoped(app, 'post', '/api/draft/start', alice, groupA).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [carol.account.id],
      });
      assert.equal(foreignDraft.status, 404);
      const draftA = await scoped(app, 'post', '/api/draft/start', alice, groupA).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [eve.account.id],
      });
      assert.equal(draftA.status, 201, JSON.stringify(draftA.body));
      assert.equal(draftA.body.draft.eventId, eventA.body.id);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice, groupA).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol, groupB).send({})).status, 200);
      const voteB = await scoped(app, 'post', '/api/votes/start', carol, groupB).send({ mode: 'single', title: 'B vote' });
      assert.equal(voteB.status, 201, JSON.stringify(voteB.body));
      assert.equal(voteB.body.round, 1, 'round counters are group-local');
      assert.equal(voteB.body.eventId, eventB.body.id);
      const draftB = await scoped(app, 'post', '/api/draft/start', carol, groupB).send({
        gameId: gameB.body.id,
        captainIds: [carol.account.id, dave.account.id],
        poolPlayerIds: [alice.account.id],
      });
      assert.equal(draftB.status, 201, JSON.stringify(draftB.body));

      // Members participate, while all tallies remain group-local even with
      // the same round number in both groups.
      assert.equal((await scoped(app, 'post', '/api/votes', bob, groupA).send({ gameId: gameA.body.id })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/votes', alice, groupB).send({ gameId: gameB.body.id })).status, 200);
      const tallyA = await scoped(app, 'get', '/api/votes', alice, groupA);
      const tallyB = await scoped(app, 'get', '/api/votes', carol, groupB);
      assert.equal(tallyA.body.totalVoters, 1);
      assert.equal(tallyB.body.totalVoters, 1);
      assert.deepEqual(tallyA.body.results.map((entry) => entry.gameId), [gameA.body.id]);
      assert.deepEqual(tallyB.body.results.map((entry) => entry.gameId), [gameB.body.id]);
      assert.equal((await scoped(app, 'post', '/api/votes/close', alice, groupA).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/votes/close', carol, groupB).send({})).status, 200);

      assert.equal((await scoped(app, 'post', '/api/draft/pick', alice, groupA).send({ pickPlayerId: eve.account.id })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/draft/pick', carol, groupB).send({ pickPlayerId: alice.account.id })).status, 200);

      const historyA = await scoped(app, 'get', '/api/votes/history', alice, groupA).query({ eventId: eventA.body.id });
      const historyB = await scoped(app, 'get', '/api/votes/history', carol, groupB).query({ eventId: eventB.body.id });
      assert.deepEqual(historyA.body.history.map((round) => round.title), ['A vote']);
      assert.deepEqual(historyB.body.history.map((round) => round.title), ['B vote']);
      const draftHistoryA = await scoped(app, 'get', '/api/draft/history', alice, groupA).query({ eventId: eventA.body.id });
      const draftHistoryB = await scoped(app, 'get', '/api/draft/history', carol, groupB).query({ eventId: eventB.body.id });
      assert.equal(draftHistoryA.body.history.length, 1);
      assert.equal(draftHistoryB.body.history.length, 1);
      assert.equal(draftHistoryA.body.history[0].gameId, gameA.body.id);
      assert.equal(draftHistoryB.body.history[0].gameId, gameB.body.id);

      const exportA = await scoped(app, 'get', '/api/export', alice, groupA).query({ eventId: eventA.body.id });
      const exportB = await scoped(app, 'get', '/api/export', carol, groupB).query({ eventId: eventB.body.id });
      assert.equal(exportA.status, 200, JSON.stringify(exportA.body));
      assert.equal(exportB.status, 200, JSON.stringify(exportB.body));
      assert.deepEqual(exportA.body.voteRounds.map((round) => round.title), ['A vote']);
      assert.deepEqual(exportB.body.voteRounds.map((round) => round.title), ['B vote']);
      assert.deepEqual(exportA.body.drafts.map((draft) => draft.gameId), [gameA.body.id]);
      assert.deepEqual(exportB.body.drafts.map((draft) => draft.gameId), [gameB.body.id]);

      // Cancel paths are group-bound moderation operations too.
      const cancelVote = await scoped(app, 'post', '/api/votes/start', alice, groupA).send({ title: 'cancel me' });
      assert.equal(cancelVote.status, 201);
      assert.equal((await scoped(app, 'post', '/api/votes/cancel', bob, groupA).send({})).status, 403);
      assert.equal((await scoped(app, 'post', '/api/votes/cancel', alice, groupA).send({})).status, 200);
      const cancelDraft = await scoped(app, 'post', '/api/draft/start', alice, groupA).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [eve.account.id],
      });
      assert.equal(cancelDraft.status, 201);
      assert.equal((await scoped(app, 'post', '/api/draft/cancel', bob, groupA).send({})).status, 403);
      assert.equal((await scoped(app, 'post', '/api/draft/cancel', alice, groupA).send({})).status, 200);

      const membershipDraft = await scoped(app, 'post', '/api/draft/start', alice, groupA).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [eve.account.id],
      });
      assert.equal(membershipDraft.status, 201);

      // Mutable references are rechecked after membership removal, while
      // completed history continues to use its immutable snapshots.
      assert.equal((await request(app).delete('/api/groups/' + groupA + '/members/' + eve.account.id).set('Cookie', alice.cookie)).status, 204);
      assert.equal((await scoped(app, 'post', '/api/draft/pick', alice, groupA).send({ pickPlayerId: eve.account.id })).status, 409);
      assert.equal((await scoped(app, 'post', '/api/draft/cancel', alice, groupA).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/votes/start', alice, groupA).send({ title: 'membership check' })).status, 201);
      assert.equal((await scoped(app, 'post', '/api/votes', eve, groupA).send({ gameId: gameA.body.id })).status, 404);
      assert.equal((await scoped(app, 'post', '/api/votes/cancel', alice, groupA).send({})).status, 200);
      const stableHistory = await scoped(app, 'get', '/api/draft/history', alice, groupA).query({ eventId: eventA.body.id });
      assert.equal(stableHistory.body.history[0].teams.flatMap((team) => team.players).some((player) => player.name === 'Votes Eve'), true);

      // Database constraints reject group/event drift and player references
      // that lack even a historical membership row in the owning group.
      assert.throws(() => db.prepare(
        'INSERT INTO vote_rounds (group_id, round, event_id, started_at, mode) VALUES (?, ?, ?, ?, ?)'
      ).run(groupA, 999, eventB.body.id, Date.now(), 'single'), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO drafts (id, group_id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at) VALUES ('bad-draft', ?, ?, ?, 'active', '[]', '[]', '[]', ?)"
      ).run(groupA, eventB.body.id, gameA.body.id, Date.now()), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO draft_player_refs (draft_id, group_id, player_id, role, player_name_snapshot, player_color_snapshot) VALUES (?, ?, ?, 'pool', 'Foreign', '#000')"
      ).run(draftA.body.draft.id, groupA, carol.account.id), /FOREIGN KEY/);
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
      `group votes/drafts child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
