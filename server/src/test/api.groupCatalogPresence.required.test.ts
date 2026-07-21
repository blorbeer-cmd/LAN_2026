// Single-group catalog/presence suite: game catalog, process-name mappings,
// skills/preferences and the live-status board stay roles-gated inside the
// one real group, and unknown resource ids 404 instead of leaking existence.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const RECOVERY_CODE = 'catalog-presence-recovery-code';

test('game catalog, process names, skills/preferences and live status are roles-gated inside the one real group', () => {
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

      // Vertical authorization: a regular group member may submit a
      // suggestion, but every catalog/process mutation stays admin-only.
      const bobSuggestion = await scoped(app, 'post', '/api/games', bob.cookie, groupId).send({ name: 'Bob Suggestion', status: 'suggestion' });
      assert.equal(bobSuggestion.status, 201, JSON.stringify(bobSuggestion.body));
      assert.equal((await scoped(app, 'post', '/api/games', bob.cookie, groupId).send({ name: 'Forbidden Catalog', status: 'catalog' })).status, 403);
      assert.equal((await scoped(app, 'patch', '/api/games/' + gameA.body.id, bob.cookie, groupId).send({ name: 'Forbidden Rename' })).status, 403);
      assert.equal((await scoped(app, 'post', '/api/games/' + bobSuggestion.body.id + '/promote', bob.cookie, groupId).send({})).status, 403);
      assert.equal((await scoped(app, 'delete', '/api/games/' + bobSuggestion.body.id, bob.cookie, groupId)).status, 403);
      assert.equal((await scoped(app, 'post', '/api/games/' + gameA.body.id + '/processes', bob.cookie, groupId).send({ processName: 'forbidden.exe' })).status, 403);

      // Process names are unique per group: the same name cannot map to a
      // second game once claimed.
      const procA = await scoped(app, 'post', '/api/games/' + gameA.body.id + '/processes', alice.cookie, groupId).send({ processName: 'shared.exe' });
      assert.equal(procA.status, 201, JSON.stringify(procA.body));
      assert.equal((await scoped(app, 'delete', '/api/games/' + gameA.body.id + '/processes/shared.exe', bob.cookie, groupId)).status, 403);
      const gameB = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Second Game', status: 'catalog' });
      const procClashSameGroup = await scoped(app, 'post', '/api/games/' + gameB.body.id + '/processes', alice.cookie, groupId).send({ processName: 'shared.exe' });
      assert.equal(procClashSameGroup.status, 409);

      // Skills/preferences: writing a rating against an unknown game 404s.
      const bobForeignSkill = await scoped(app, 'put', '/api/skills', bob.cookie, groupId).send({ playerId: bob.account.id, gameId: 'does-not-exist', rating: 7 });
      assert.equal(bobForeignSkill.status, 404);
      const bobOwnSkill = await scoped(app, 'put', '/api/skills', bob.cookie, groupId).send({ playerId: bob.account.id, gameId: gameA.body.id, rating: 7 });
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
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie, groupId).send({ name: 'Tracking A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie, groupId).send({ playerIds: [alice.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/accept', alice.cookie, groupId).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/groups/' + groupId + '/tracking-consent', alice.cookie, groupId).send({ granted: true })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie, groupId).send({})).status, 200);

      const report = await request(app).post('/api/agent/report').set('x-api-key', aliceApiKey).send({ processNames: ['trackedgame.exe'] });
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.ok(report.body.gameIds.includes(trackedGame.body.id));

      const statsA = await scoped(app, 'get', '/api/stats/playtime', alice.cookie, groupId);
      assert.ok(statsA.body.entries.some((entry) => entry.gameId === trackedGame.body.id));
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
