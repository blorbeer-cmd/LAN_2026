// Phase 5c (cluster 1) tenant-boundary suite: game catalog, process-name
// mappings, skills/preferences and the live-status board must stay isolated
// per group, and an agent report (which carries no group selector of its
// own) must resolve process-name matches against the currently *tracking*
// group's catalog — see docs/KONZEPT-USER-MANAGEMENT.md 7.4 and
// routes/agent.ts. Runs like the sibling 5b suite: a real app in an isolated
// required-auth child process with MULTI_GROUPS_ENABLED=1.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const RECOVERY_CODE = 'catalog-presence-recovery-code';

test('game catalog, process names, skills/preferences and live status stay isolated across two groups', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});

    function cookie(response) {
      return response.headers['set-cookie'][0].split(';')[0];
    }
    function scoped(app, method, path, sessionCookie, groupId) {
      return request(app)[method](path).set('Cookie', sessionCookie).set('x-group-id', groupId);
    }

    (async () => {
      const app = createApp();
      const aliceResponse = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Catalog Alice',
        password: 'catalog alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'catalog alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }

      const bob = await register('Catalog Bob', 'catalog bob secure passphrase');
      const carol = await register('Catalog Carol', 'catalog carol secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie).send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Catalog Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Catalog Group B' });
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
      // Alice ends up in both groups (owner of A, member of B) — needed below
      // to exercise the agent's cross-group process-name resolution.
      await addMember(carol, groupB, alice);

      // Game names are scoped per group: the same title in two different
      // groups is not a 409, unlike within one group.
      const gameA = await scoped(app, 'post', '/api/games', alice.cookie, groupA).send({ name: 'Shared Title', status: 'catalog' });
      assert.equal(gameA.status, 201, JSON.stringify(gameA.body));
      // Carol is not an instance admin, but as Group B's owner she may
      // manage that group's catalog.
      const gameB = await scoped(app, 'post', '/api/games', carol.cookie, groupB).send({ name: 'Shared Title', status: 'catalog' });
      assert.equal(gameB.status, 201, JSON.stringify(gameB.body));
      const dupeInGroupA = await scoped(app, 'post', '/api/games', alice.cookie, groupA).send({ name: 'Shared Title', status: 'catalog' });
      assert.equal(dupeInGroupA.status, 409);

      // GET /api/games only shows the caller's current group's catalog.
      const gamesInA = await scoped(app, 'get', '/api/games', alice.cookie, groupA);
      assert.ok(gamesInA.body.some((g) => g.id === gameA.body.id));
      assert.equal(gamesInA.body.some((g) => g.id === gameB.body.id), false);

      // A foreign group's game 404s (existence hidden) via the group header,
      // even though Bob only ever knows about group A.
      const bobForeignGame = await scoped(app, 'get', '/api/games/' + gameB.body.id, bob.cookie, groupA);
      assert.equal(bobForeignGame.status, 404);
      const bobForeignPatch = await scoped(app, 'patch', '/api/games/' + gameB.body.id, bob.cookie, groupA).send({ name: 'Hijacked' });
      assert.equal(bobForeignPatch.status, 404);

      // Vertical authorization: a regular group member may submit a
      // suggestion, but every catalog/process mutation stays admin-only.
      const bobSuggestion = await scoped(app, 'post', '/api/games', bob.cookie, groupA).send({ name: 'Bob Suggestion', status: 'suggestion' });
      assert.equal(bobSuggestion.status, 201, JSON.stringify(bobSuggestion.body));
      assert.equal((await scoped(app, 'post', '/api/games', bob.cookie, groupA).send({ name: 'Forbidden Catalog', status: 'catalog' })).status, 403);
      assert.equal((await scoped(app, 'patch', '/api/games/' + gameA.body.id, bob.cookie, groupA).send({ name: 'Forbidden Rename' })).status, 403);
      assert.equal((await scoped(app, 'post', '/api/games/' + bobSuggestion.body.id + '/promote', bob.cookie, groupA).send({})).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/games/' + bobSuggestion.body.id, bob.cookie, groupA)).status, 403);
      assert.equal((await scoped(app, 'post', '/api/games/' + gameA.body.id + '/processes', bob.cookie, groupA).send({ processName: 'forbidden.exe' })).status, 403);

      // Process names: the same process name mapped in two different groups'
      // games must not collide (game_process_names uniqueness is per-group).
      const procA = await scoped(app, 'post', '/api/games/' + gameA.body.id + '/processes', alice.cookie, groupA).send({ processName: 'shared.exe' });
      assert.equal(procA.status, 201, JSON.stringify(procA.body));
      assert.equal((await scoped(app, 'delete', '/api/games/' + gameA.body.id + '/processes/shared.exe', bob.cookie, groupA)).status, 403);
      const procB = await scoped(app, 'post', '/api/games/' + gameB.body.id + '/processes', carol.cookie, groupB).send({ processName: 'shared.exe' });
      assert.equal(procB.status, 201, JSON.stringify(procB.body));
      const procClashSameGroup = await scoped(app, 'post', '/api/games/' + gameA.body.id + '/processes', alice.cookie, groupA).send({ processName: 'shared.exe' });
      assert.equal(procClashSameGroup.status, 409);

      // Skills/preferences: writing a rating against a foreign group's game
      // 404s; ratings are only visible when filtered by their own group.
      const bobForeignSkill = await scoped(app, 'put', '/api/skills', bob.cookie, groupA).send({ playerId: bob.account.id, gameId: gameB.body.id, rating: 7 });
      assert.equal(bobForeignSkill.status, 404);
      const bobOwnSkill = await scoped(app, 'put', '/api/skills', bob.cookie, groupA).send({ playerId: bob.account.id, gameId: gameA.body.id, rating: 7 });
      assert.equal(bobOwnSkill.status, 200, JSON.stringify(bobOwnSkill.body));
      const skillsInB = await scoped(app, 'get', '/api/skills', carol.cookie, groupB);
      assert.equal(skillsInB.body.some((s) => s.playerId === bob.account.id || s.player_id === bob.account.id), false);

      // Live board: each group only shows its own active members.
      const liveInA = await scoped(app, 'get', '/api/live', alice.cookie, groupA);
      assert.equal(liveInA.status, 200);
      assert.ok(liveInA.body.some((row) => row.player_id === alice.account.id));
      assert.ok(liveInA.body.some((row) => row.player_id === bob.account.id));
      assert.equal(liveInA.body.some((row) => row.player_id === carol.account.id), false);
      const liveInB = await scoped(app, 'get', '/api/live', carol.cookie, groupB);
      assert.equal(liveInB.body.some((row) => row.player_id === bob.account.id), false);

      // Agent process matching resolves against the currently *tracking*
      // group, not just "any group the player belongs to" — set up one
      // process name per group's own game, then flip which event tracks.
      const trackedA = await scoped(app, 'post', '/api/games', alice.cookie, groupA).send({ name: 'Tracked Game A', status: 'catalog' });
      const trackedB = await scoped(app, 'post', '/api/games', carol.cookie, groupB).send({ name: 'Tracked Game B', status: 'catalog' });
      await scoped(app, 'post', '/api/games/' + trackedA.body.id + '/processes', alice.cookie, groupA).send({ processName: 'trackedgame.exe' });
      await scoped(app, 'post', '/api/games/' + trackedB.body.id + '/processes', carol.cookie, groupB).send({ processName: 'trackedgame.exe' });

      const aliceApiKey = (await request(app).get('/api/players/' + alice.account.id).set('Cookie', alice.cookie)).body.api_key;
      assert.ok(aliceApiKey);

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie, groupA).send({ name: 'Tracking A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol.cookie, groupB).send({ name: 'Tracking B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));

      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie, groupA).send({ playerIds: [alice.account.id] })).status, 200);
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', carol.cookie, groupB).send({ playerIds: [alice.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/accept', alice.cookie, groupA).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/accept', alice.cookie, groupB).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/groups/' + groupA + '/tracking-consent', alice.cookie, groupA).send({ granted: true })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/groups/' + groupB + '/tracking-consent', alice.cookie, groupB).send({ granted: true })).status, 200);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie, groupA).send({})).status, 200);
      const reportDuringA = await request(app).post('/api/agent/report').set('x-api-key', aliceApiKey).send({ processNames: ['trackedgame.exe'] });
      assert.equal(reportDuringA.status, 200, JSON.stringify(reportDuringA.body));
      assert.ok(reportDuringA.body.gameIds.includes(trackedA.body.id));

      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice.cookie, groupA).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol.cookie, groupB).send({})).status, 200);
      const reportDuringB = await request(app).post('/api/agent/report').set('x-api-key', aliceApiKey).send({ processNames: ['trackedgame.exe'] });
      assert.equal(reportDuringB.status, 200, JSON.stringify(reportDuringB.body));
      assert.deepEqual(new Set(reportDuringB.body.gameIds), new Set([trackedA.body.id, trackedB.body.id]));

      // Every reader/aggregation over the newly group-owned presence tables
      // must follow the selected group as well.
      const statsA = await scoped(app, 'get', '/api/stats/playtime', alice.cookie, groupA);
      const statsB = await scoped(app, 'get', '/api/stats/playtime', alice.cookie, groupB);
      assert.ok(statsA.body.entries.some((entry) => entry.gameId === trackedA.body.id));
      assert.equal(statsA.body.entries.some((entry) => entry.gameId === trackedB.body.id), false);
      assert.ok(statsB.body.entries.some((entry) => entry.gameId === trackedB.body.id));
      assert.equal(statsB.body.entries.some((entry) => entry.gameId === trackedA.body.id), false);

      const analyticsA = await scoped(app, 'get', '/api/analytics/games', alice.cookie, groupA);
      const analyticsB = await scoped(app, 'get', '/api/analytics/games', alice.cookie, groupB);
      assert.equal(analyticsA.body.games.some((entry) => entry.gameId === trackedB.body.id), false);
      assert.equal(analyticsB.body.games.some((entry) => entry.gameId === trackedA.body.id), false);

      const playerStatsA = await scoped(app, 'get', '/api/players/' + alice.account.id + '/stats', alice.cookie, groupA);
      const playerStatsB = await scoped(app, 'get', '/api/players/' + alice.account.id + '/stats', alice.cookie, groupB);
      assert.equal(playerStatsA.body.games.some((entry) => entry.gameId === trackedB.body.id), false);
      assert.equal(playerStatsB.body.games.some((entry) => entry.gameId === trackedA.body.id), false);

      const digestA = await scoped(app, 'get', '/api/digest?playerId=' + alice.account.id, alice.cookie, groupA);
      const digestB = await scoped(app, 'get', '/api/digest?playerId=' + alice.account.id, alice.cookie, groupB);
      assert.equal(digestA.body.missingSkills.some((entry) => entry.id === trackedB.body.id), false);
      assert.ok(digestB.body.missingSkills.some((entry) => entry.id === trackedB.body.id));

      const votesA = await scoped(app, 'get', '/api/votes', alice.cookie, groupA);
      const votesB = await scoped(app, 'get', '/api/votes', alice.cookie, groupB);
      assert.equal(votesA.body.catalogResults.some((entry) => entry.gameId === gameB.body.id), false);
      assert.equal(votesB.body.catalogResults.some((entry) => entry.gameId === gameA.body.id), false);
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
      `group catalog/presence child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});

test('catalog administration keeps working in required single-group mode', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});

    (async () => {
      const app = createApp();
      const registered = await request(app).post('/api/auth/register').send({
        code: ${JSON.stringify(RECOVERY_CODE)},
        name: 'Single Group Owner',
        password: 'single group secure passphrase',
      });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
      const cookie = registered.headers['set-cookie'][0].split(';')[0];

      const game = await request(app)
        .post('/api/games')
        .set('Cookie', cookie)
        .send({ name: 'Single Group Catalog Game', status: 'catalog' });
      assert.equal(game.status, 201, JSON.stringify(game.body));

      const processName = await request(app)
        .post('/api/games/' + game.body.id + '/processes')
        .set('Cookie', cookie)
        .send({ processName: 'single-group.exe' });
      assert.equal(processName.status, 201, JSON.stringify(processName.body));

      const games = await request(app).get('/api/games').set('Cookie', cookie);
      assert.equal(games.status, 200);
      assert.ok(games.body.some((entry) => entry.id === game.body.id));
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
        MULTI_GROUPS_ENABLED: '0',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const child = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `single-group catalog child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
