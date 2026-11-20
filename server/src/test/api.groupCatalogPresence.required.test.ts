// Single-group catalog/presence suite: game catalog, process-name mappings,
// skills/preferences and the live-status board work for every member of the
// one real group, and unknown resource ids 404 instead of leaking existence.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const PRIVACY_POLICY_JS_PATH = path.join(__dirname, '..', 'privacyPolicy.js');
const RECOVERY_CODE = 'catalog-presence-recovery-code';

test('game catalog, process names, skills/preferences and live status are roles-gated inside the one real group', () => {
  const script = `
    const assert = require('assert/strict');
    const request = require('supertest');
    const { createApp } = require(${JSON.stringify(APP_JS_PATH)});
    const { TRACKING_CONSENT_TEXT_VERSION, GROUP_TRACKING_CONSENT_TEXT_VERSION } = require(${JSON.stringify(PRIVACY_POLICY_JS_PATH)});

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
      const groupsResponse = await request(app).get('/api/groups').set('Cookie', alice.cookie);
      const groupId = groupsResponse.body[0].id;

      const gameA = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Shared Title', status: 'catalog' });
      assert.equal(gameA.status, 201, JSON.stringify(gameA.body));
      const dupeInGroup = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Shared Title', status: 'catalog' });
      assert.equal(dupeInGroup.status, 409, 'a duplicate title within the same group is rejected');

      const gamesInGroup = await scoped(app, 'get', '/api/games', alice.cookie, groupId);
      assert.ok(gamesInGroup.body.some((g) => g.id === gameA.body.id));

      // An unknown game id 404s instead of leaking existence.
      assert.equal((await scoped(app, 'get', '/api/games/does-not-exist', bob.cookie, groupId)).status, 404);
      assert.equal((await scoped(app, 'patch', '/api/games/does-not-exist', bob.cookie, groupId).send({ name: 'Hijacked' })).status, 404);

      // Members can add and edit catalog entries and manage process names.
      const bobSuggestion = await scoped(app, 'post', '/api/games', bob.cookie, groupId).send({ name: 'Bob Suggestion', status: 'suggestion' });
      assert.equal(bobSuggestion.status, 201, JSON.stringify(bobSuggestion.body));
      const bobCatalog = await scoped(app, 'post', '/api/games', bob.cookie, groupId).send({ name: 'Bob Catalog', status: 'catalog' });
      assert.equal(bobCatalog.status, 201, JSON.stringify(bobCatalog.body));
      assert.equal(bobCatalog.body.status, 'catalog');
      const bobRename = await scoped(app, 'patch', '/api/games/' + bobSuggestion.body.id, bob.cookie, groupId).send({ name: 'Bob Renamed' });
      assert.equal(bobRename.status, 200, JSON.stringify(bobRename.body));
      assert.equal(bobRename.body.name, 'Bob Renamed');
      const bobPromote = await scoped(app, 'post', '/api/games/' + bobSuggestion.body.id + '/promote', bob.cookie, groupId).send({});
      assert.equal(bobPromote.status, 200, JSON.stringify(bobPromote.body));
      assert.equal(bobPromote.body.status, 'catalog');
      const bobProc = await scoped(app, 'post', '/api/games/' + bobCatalog.body.id + '/processes', bob.cookie, groupId).send({ processName: 'Member.exe' });
      assert.equal(bobProc.status, 201, JSON.stringify(bobProc.body));
      assert.equal((await scoped(app, 'delete', '/api/games/' + bobCatalog.body.id + '/processes/member.exe', bob.cookie, groupId)).status, 204);
      // Deleting stays behind the shared password confirmation.
      const bobDeleteWithoutReauth = await scoped(app, 'delete', '/api/games/' + bobCatalog.body.id, bob.cookie, groupId);
      assert.equal(bobDeleteWithoutReauth.status, 403);
      assert.equal(bobDeleteWithoutReauth.body.code, 'reauth_required');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', bob.cookie).send({ password: bob.password })).status, 204);

      // The open points standings protect the Skill bonus from both ways
      // of shrinking the catalog, including two requests for the same game.
      const catalogPath = '/api/games/' + bobCatalog.body.id;
      const attempts = await Promise.all([
        scoped(app, 'post', catalogPath + '/demote', bob.cookie, groupId).send({}),
        scoped(app, 'delete', catalogPath, bob.cookie, groupId),
      ]);
      for (const attempt of attempts) {
        assert.equal(attempt.status, 403);
        assert.match(attempt.body.error, /Skill-Bonus/);
      }
      assert.equal((await scoped(app, 'get', catalogPath, alice.cookie, groupId)).body.status, 'catalog');
      const adminDemote = await scoped(app, 'post', catalogPath + '/demote', alice.cookie, groupId).send({});
      assert.equal(adminDemote.status, 200, JSON.stringify(adminDemote.body));
      assert.equal(adminDemote.body.status, 'suggestion');
      assert.equal((await scoped(app, 'delete', catalogPath, bob.cookie, groupId)).status, 204);

      // Both kinds of rating protect an otherwise unused suggestion.
      for (const resource of ['skills', 'preferences']) {
        const suggestion = await scoped(app, 'post', '/api/games', alice.cookie, groupId)
          .send({ name: 'Rated suggestion ' + resource, status: 'suggestion' });
        assert.equal(suggestion.status, 201);
        const gameId = suggestion.body.id;
        const rating = { playerId: alice.account.id, gameId, rating: 4 };
        assert.equal((await scoped(app, 'put', '/api/' + resource, alice.cookie, groupId).send(rating)).status, 200);
        const deletion = await scoped(app, 'delete', '/api/games/' + gameId, bob.cookie, groupId);
        assert.equal(deletion.status, 403);
        assert.match(deletion.body.error, /Bewertungen/);
        const ratings = await scoped(app, 'get', '/api/' + resource + '?gameId=' + gameId, bob.cookie, groupId);
        assert.deepEqual(ratings.body, [{ player_id: alice.account.id, game_id: gameId, rating: 4 }]);
      }

      // Process names are unique per group: the same name cannot map to a
      // second game once claimed.
      const procA = await scoped(app, 'post', '/api/games/' + gameA.body.id + '/processes', alice.cookie, groupId).send({ processName: 'shared.exe' });
      assert.equal(procA.status, 201, JSON.stringify(procA.body));
      const gameB = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Second Game', status: 'catalog' });
      const procClashSameGroup = await scoped(app, 'post', '/api/games/' + gameB.body.id + '/processes', alice.cookie, groupId).send({ processName: 'shared.exe' });
      assert.equal(procClashSameGroup.status, 409);

      // Skills/preferences: writing a rating against an unknown game 404s.
      const bobForeignSkill = await scoped(app, 'put', '/api/skills', bob.cookie, groupId).send({ playerId: bob.account.id, gameId: 'does-not-exist', rating: 4 });
      assert.equal(bobForeignSkill.status, 404);
      const bobOwnSkill = await scoped(app, 'put', '/api/skills', bob.cookie, groupId).send({ playerId: bob.account.id, gameId: gameA.body.id, rating: 4 });
      assert.equal(bobOwnSkill.status, 200, JSON.stringify(bobOwnSkill.body));

      // Live board reflects this group's own active members.
      const liveInGroup = await scoped(app, 'get', '/api/live', alice.cookie, groupId);
      assert.equal(liveInGroup.status, 200);
      assert.ok(liveInGroup.body.some((row) => row.player_id === alice.account.id));
      assert.ok(liveInGroup.body.some((row) => row.player_id === bob.account.id));

      // Agent process matching resolves against the group's own catalog.
      const trackedGame = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Tracked Game', status: 'catalog' });
      await scoped(app, 'post', '/api/games/' + trackedGame.body.id + '/processes', alice.cookie, groupId).send({ processName: 'trackedgame.exe' });
      const aliceApiKey = (await request(app).get('/api/players/' + alice.account.id).set('Cookie', alice.cookie)).body.api_key;
      assert.ok(aliceApiKey);

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie, groupId).send({ name: 'Tracking A', startsAt: now, endsAt: now + 5 * 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie, groupId).send({ playerIds: [alice.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/accept', alice.cookie, groupId).send({ textVersion: TRACKING_CONSENT_TEXT_VERSION })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/groups/' + groupId + '/tracking-consent', alice.cookie, groupId).send({ granted: true, textVersion: GROUP_TRACKING_CONSENT_TEXT_VERSION })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie, groupId).send({})).status, 200);
      const selectEventA = await scoped(app, 'put', '/api/me/active-event', alice.cookie, groupId).send({ eventId: eventA.body.id });
      assert.equal(selectEventA.status, 200, JSON.stringify(selectEventA.body));

      const report = await request(app).post('/api/agent/report').set('x-api-key', aliceApiKey).send({ processNames: ['trackedgame.exe'] });
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.ok(report.body.gameIds.includes(trackedGame.body.id));

      const statsA = await scoped(app, 'get', '/api/stats/playtime', alice.cookie, groupId);
      assert.ok(statsA.body.entries.some((entry) => entry.gameId === trackedGame.body.id));

      // A game with history (here: tracked play time) would cascade that
      // history away, so only admins may delete it; the member gets a 403
      // and the play time stays.
      const memberDeletesHistory = await scoped(app, 'delete', '/api/games/' + trackedGame.body.id, bob.cookie, groupId);
      assert.equal(memberDeletesHistory.status, 403, JSON.stringify(memberDeletesHistory.body));
      assert.match(memberDeletesHistory.body.error, /nur Community-Admins/);
      assert.equal((await scoped(app, 'get', '/api/games/' + trackedGame.body.id, alice.cookie, groupId)).status, 200);
      assert.equal((await scoped(app, 'delete', '/api/games/' + trackedGame.body.id, alice.cookie, groupId)).status, 204);
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  try {
    execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
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
        ADMIN_RECOVERY_CODE: RECOVERY_CODE,
        COOKIE_SECURE: '0',
        DB_FILE: ':memory:',
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
