// Single-group competition suite: matches, matchmaking draws and tournaments
// must stay correctly scoped to whichever event the group is currently
// tracking (two sequential events in the one real group), reject player ids
// with no active membership, and gate deletion by group role. The readers
// that aggregate over them (leaderboard, stats/playtime, hall-of-fame,
// export) must follow the same event scope.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const RECOVERY_CODE = 'competition-recovery-code';

test('matches, matchmaking draws, tournaments and their aggregates stay event-scoped inside the one real group', () => {
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
        name: 'Competition Alice',
        password: 'competition alice secure passphrase',
      });
      assert.equal(aliceResponse.status, 201, JSON.stringify(aliceResponse.body));
      const alice = { account: aliceResponse.body, cookie: cookie(aliceResponse), password: 'competition alice secure passphrase' };
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', alice.cookie).send({ password: alice.password })).status, 204);

      async function register(name, password) {
        const invite = await request(app).post('/api/auth/invites').set('Cookie', alice.cookie).send({ purpose: 'register' });
        assert.equal(invite.status, 201, JSON.stringify(invite.body));
        const response = await request(app).post('/api/auth/register').send({ code: invite.body.code, name, password });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return { account: response.body, cookie: cookie(response), password };
      }

      // alice becomes owner of the one real group automatically; bob joins as
      // a plain member.
      const bob = await register('Competition Bob', 'competition bob secure passphrase');
      const groupsResponse = await request(app).get('/api/groups').set('Cookie', alice.cookie);
      assert.equal(groupsResponse.status, 200, JSON.stringify(groupsResponse.body));
      const groupId = groupsResponse.body[0].id;

      const gameA = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Competition Game A', status: 'catalog' });
      assert.equal(gameA.status, 201, JSON.stringify(gameA.body));

      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie, groupId).send({ name: 'Competition Event A', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventA.body.id + '/participants', alice.cookie, groupId)
        .send({ playerIds: [alice.account.id, bob.account.id] })).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie, groupId).send({})).status, 200);

      // ---------- matches, draws, tournaments (tagged to event A) ----------
      const matchA = await scoped(app, 'post', '/api/matches', alice.cookie, groupId).send({
        gameId: gameA.body.id,
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
        winnerTeamIndex: 0,
      });
      assert.equal(matchA.status, 201, JSON.stringify(matchA.body));

      const drawA = await scoped(app, 'post', '/api/matchmaking', alice.cookie, groupId).send({
        gameId: gameA.body.id,
        playerIds: [alice.account.id, bob.account.id],
      });
      assert.equal(drawA.status, 200, JSON.stringify(drawA.body));

      const tournamentA = await scoped(app, 'post', '/api/tournaments', alice.cookie, groupId).send({
        gameId: gameA.body.id,
        format: 'single_elimination',
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
      });
      assert.equal(tournamentA.status, 201, JSON.stringify(tournamentA.body));

      // A player id with no active membership can never be smuggled into any
      // competition writer, even from an owner session.
      const foreignPlayerMatch = await scoped(app, 'post', '/api/matches', alice.cookie, groupId).send({
        gameId: gameA.body.id,
        teams: [{ playerIds: [alice.account.id] }, { playerIds: ['does-not-exist'] }],
      });
      assert.equal(foreignPlayerMatch.status, 404);
      const foreignPlayerDraw = await scoped(app, 'post', '/api/matchmaking', alice.cookie, groupId).send({
        gameId: gameA.body.id,
        playerIds: [alice.account.id, 'does-not-exist'],
      });
      assert.equal(foreignPlayerDraw.status, 404);
      const foreignPlayerTournament = await scoped(app, 'post', '/api/tournaments', alice.cookie, groupId).send({
        gameId: gameA.body.id,
        format: 'single_elimination',
        teams: [{ playerIds: [alice.account.id] }, { playerIds: ['does-not-exist'] }],
      });
      assert.equal(foreignPlayerTournament.status, 404);

      const memberDelete = await scoped(app, 'delete', '/api/matches/' + matchA.body.id, bob.cookie, groupId);
      assert.equal(memberDelete.status, 403);

      // Switch tracking to a second event before creating its own data - only
      // one event can track at a time, so this must be sequential, not
      // concurrent.
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice.cookie, groupId).send({})).status, 200);
      const eventB = await scoped(app, 'post', '/api/events', alice.cookie, groupId).send({ name: 'Competition Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'put', '/api/events/' + eventB.body.id + '/participants', alice.cookie, groupId)
        .send({ playerIds: [alice.account.id, bob.account.id] })).status, 200);

      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', alice.cookie, groupId).send({})).status, 200);

      const gameB = await scoped(app, 'post', '/api/games', alice.cookie, groupId).send({ name: 'Competition Game B', status: 'catalog' });
      assert.equal(gameB.status, 201, JSON.stringify(gameB.body));
      const matchB = await scoped(app, 'post', '/api/matches', alice.cookie, groupId).send({
        gameId: gameB.body.id,
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
        winnerTeamIndex: 0,
      });
      assert.equal(matchB.status, 201, JSON.stringify(matchB.body));
      const tournamentB = await scoped(app, 'post', '/api/tournaments', alice.cookie, groupId).send({
        gameId: gameB.body.id,
        format: 'single_elimination',
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
      });
      assert.equal(tournamentB.status, 201, JSON.stringify(tournamentB.body));
      const firstMatchB = tournamentB.body.matches.find((m) => m.teamAId && m.teamBId);
      const ownResultB = await scoped(app, 'post', '/api/tournaments/' + tournamentB.body.id + '/matches/' + firstMatchB.id + '/result', alice.cookie, groupId)
        .send({ winnerTeamId: tournamentB.body.teams[0].id });
      assert.equal(ownResultB.status, 200, JSON.stringify(ownResultB.body));

      // ---------- event-scope checks ----------
      const historyA = await scoped(app, 'get', '/api/matchmaking/history', alice.cookie, groupId).query({ eventId: eventA.body.id });
      assert.ok(historyA.body.history.some((d) => d.id === drawA.body.id));
      const historyB = await scoped(app, 'get', '/api/matchmaking/history', alice.cookie, groupId).query({ eventId: eventB.body.id });
      assert.equal(historyB.body.history.some((d) => d.id === drawA.body.id), false);

      const tournamentsInB = await scoped(app, 'get', '/api/tournaments', alice.cookie, groupId).query({ eventId: eventA.body.id });
      assert.equal(tournamentsInB.body.some((t) => t.id === tournamentB.body.id), false);

      const firstMatch = tournamentA.body.matches.find((m) => m.teamAId && m.teamBId);
      const ownResult = await scoped(app, 'post', '/api/tournaments/' + tournamentA.body.id + '/matches/' + firstMatch.id + '/result', alice.cookie, groupId)
        .send({ winnerTeamId: tournamentA.body.teams[0].id });
      assert.equal(ownResult.status, 200, JSON.stringify(ownResult.body));

      // ---------- stats/playtime, hall-of-fame, export spot checks ----------
      const exportA = await scoped(app, 'get', '/api/export', alice.cookie, groupId).query({ eventId: eventA.body.id });
      assert.equal(exportA.status, 200, JSON.stringify(exportA.body));
      assert.equal(exportA.body.tournaments.some((t) => t.name === tournamentB.body.name), false);
      const exportB = await scoped(app, 'get', '/api/export', alice.cookie, groupId).query({ eventId: eventB.body.id });
      assert.equal(exportB.status, 200, JSON.stringify(exportB.body));
      assert.equal(exportB.body.tournaments.some((t) => t.name === tournamentA.body.name), false);

      const hallOfFame = await scoped(app, 'get', '/api/hall-of-fame', alice.cookie, groupId);
      assert.equal(hallOfFame.status, 200);
      const tournamentNames = hallOfFame.body.events.flatMap((e) => e.tournamentChampions.map((t) => t.name));
      assert.ok(tournamentNames.includes(tournamentA.body.name) || tournamentNames.includes(tournamentB.body.name));

      // A group admin (not just the owner) may delete group-owned competition
      // history.
      const promoteBob = await request(app)
        .patch('/api/groups/' + groupId + '/members/' + bob.account.id)
        .set('Cookie', alice.cookie)
        .send({ role: 'admin' });
      assert.equal(promoteBob.status, 200, JSON.stringify(promoteBob.body));
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', bob.cookie).send({ password: bob.password })).status, 204);
      const groupAdminDelete = await scoped(app, 'delete', '/api/tournaments/' + tournamentB.body.id, bob.cookie, groupId);
      assert.equal(groupAdminDelete.status, 204);
      const groupOwnerDelete = await scoped(app, 'delete', '/api/matches/' + matchB.body.id, alice.cookie, groupId);
      assert.equal(groupOwnerDelete.status, 204);
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
      `group competition child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
