// Single-group Votes/Drafts suite. A required-auth child process exercises
// group-local state, roles, player-reference validation, event scoping (two
// sequential events in the one real group), history and export.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const DB_JS_PATH = path.join(__dirname, '..', 'db.js');
const RECOVERY_CODE = 'votes-drafts-recovery-code';

test('votes and drafts stay roles-gated and event-scoped inside the one real group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { db, DEFAULT_GROUP_ID } = require(${JSON.stringify(DB_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }
    function scoped(app, method, url, user) {
      return request(app)[method](url).set('Cookie', user.cookie).set('x-group-id', DEFAULT_GROUP_ID);
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

      // Every account joins the one real group automatically.
      const bob = await register('Votes Bob', 'votes bob secure passphrase');
      const eve = await register('Votes Eve', 'votes eve secure passphrase');

      const gameA = await scoped(app, 'post', '/api/games', alice).send({ name: 'Vote Game A', status: 'catalog' });
      assert.equal(gameA.status, 201, JSON.stringify(gameA.body));

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice).send({ name: 'Vote Event A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice)
        .send({ playerIds: [alice.account.id, bob.account.id, eve.account.id] })).status, 200);

      // Vertical role checks: Bob is only a member.
      assert.equal((await scoped(app, 'post', '/api/votes/start', bob).send({})).status, 403);
      assert.equal((await scoped(app, 'post', '/api/draft/start', bob).send({
        gameId: gameA.body.id, captainIds: [alice.account.id, bob.account.id], poolPlayerIds: [eve.account.id],
      })).status, 403);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice).send({})).status, 200);
      const voteA = await scoped(app, 'post', '/api/votes/start', alice).send({ mode: 'single', title: 'A vote' });
      assert.equal(voteA.status, 201, JSON.stringify(voteA.body));
      assert.equal(voteA.body.eventId, eventA.body.id);
      assert.equal(voteA.body.round, 1);

      // A nonexistent player id can never be smuggled into a draft pool.
      const foreignDraft = await scoped(app, 'post', '/api/draft/start', alice).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: ['does-not-exist'],
      });
      assert.equal(foreignDraft.status, 404);
      const draftA = await scoped(app, 'post', '/api/draft/start', alice).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [eve.account.id],
      });
      assert.equal(draftA.status, 201, JSON.stringify(draftA.body));
      assert.equal(draftA.body.draft.eventId, eventA.body.id);

      assert.equal((await scoped(app, 'post', '/api/votes', bob).send({ gameId: gameA.body.id })).status, 200);
      const tallyA = await scoped(app, 'get', '/api/votes', alice);
      assert.equal(tallyA.body.totalVoters, 1);
      // results ranks every catalog game (including the pre-seeded default
      // titles), not just the ones actually voted for; the score itself is
      // redacted while the round stays open.
      assert.ok(tallyA.body.results.some((entry) => entry.gameId === gameA.body.id));
      assert.equal((await scoped(app, 'post', '/api/votes/close', alice).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/draft/pick', alice).send({ pickPlayerId: eve.account.id })).status, 200);

      const historyA = await scoped(app, 'get', '/api/votes/history', alice).query({ eventId: eventA.body.id });
      assert.deepEqual(historyA.body.history.map((round) => round.title), ['A vote']);
      const draftHistoryA = await scoped(app, 'get', '/api/draft/history', alice).query({ eventId: eventA.body.id });
      assert.equal(draftHistoryA.body.history.length, 1);
      assert.equal(draftHistoryA.body.history[0].gameId, gameA.body.id);

      const exportA = await scoped(app, 'get', '/api/export', alice).query({ eventId: eventA.body.id });
      assert.equal(exportA.status, 200, JSON.stringify(exportA.body));
      assert.deepEqual(exportA.body.voteRounds.map((round) => round.title), ['A vote']);
      assert.deepEqual(exportA.body.drafts.map((draft) => draft.gameId), [gameA.body.id]);

      // Switching the group's tracked event moves subsequent writes there too
      // - round numbers keep incrementing (they are group-local, not
      // event-local), while history/export stay filtered per event.
      const eventB = await scoped(app, 'post', '/api/events', alice).send({ name: 'Vote Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', alice)
        .send({ playerIds: [alice.account.id, bob.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', alice).send({})).status, 200);

      const voteB = await scoped(app, 'post', '/api/votes/start', alice).send({ mode: 'single', title: 'B vote' });
      assert.equal(voteB.status, 201, JSON.stringify(voteB.body));
      assert.equal(voteB.body.round, 2, 'round counters are group-local, not event-local');
      assert.equal(voteB.body.eventId, eventB.body.id);
      assert.equal((await scoped(app, 'post', '/api/votes/cancel', alice).send({})).status, 200);

      const historyAAfter = await scoped(app, 'get', '/api/votes/history', alice).query({ eventId: eventA.body.id });
      assert.deepEqual(historyAAfter.body.history.map((round) => round.title), ['A vote'], 'event A history stays put after switching tracking');

      // Cancel paths are moderation operations too.
      const cancelDraft = await scoped(app, 'post', '/api/draft/start', alice).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [eve.account.id],
      });
      assert.equal(cancelDraft.status, 201);
      assert.equal((await scoped(app, 'post', '/api/draft/cancel', bob).send({})).status, 403);
      assert.equal((await scoped(app, 'post', '/api/draft/cancel', alice).send({})).status, 200);

      const membershipDraft = await scoped(app, 'post', '/api/draft/start', alice).send({
        gameId: gameA.body.id,
        captainIds: [alice.account.id, bob.account.id],
        poolPlayerIds: [eve.account.id],
      });
      assert.equal(membershipDraft.status, 201);
      assert.equal((await scoped(app, 'post', '/api/draft/cancel', alice).send({})).status, 200);

      // Mutable references are rechecked after membership removal, while
      // completed history continues to use its immutable snapshots.
      assert.equal((await request(app).delete('/api/groups/' + DEFAULT_GROUP_ID + '/members/' + eve.account.id).set('Cookie', alice.cookie)).status, 409, 'the start group can never remove a member');

      // Database constraints reject event/group drift and player references
      // that lack even a historical membership row in the owning group.
      assert.throws(() => db.prepare(
        'INSERT INTO vote_rounds (group_id, round, event_id, started_at, mode) VALUES (?, ?, ?, ?, ?)'
      ).run(DEFAULT_GROUP_ID, 999, 'does-not-exist', Date.now(), 'single'), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO drafts (id, group_id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at) VALUES ('bad-draft', ?, ?, ?, 'active', '[]', '[]', '[]', ?)"
      ).run(DEFAULT_GROUP_ID, 'does-not-exist', gameA.body.id, Date.now()), /FOREIGN KEY/);
      assert.throws(() => db.prepare(
        "INSERT INTO draft_player_refs (draft_id, group_id, player_id, role, player_name_snapshot, player_color_snapshot) VALUES (?, ?, ?, 'pool', 'Foreign', '#000')"
      ).run(draftA.body.draft.id, DEFAULT_GROUP_ID, 'does-not-exist'), /FOREIGN KEY/);
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
      `group votes/drafts child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
