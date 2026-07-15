// Phase 5c (cluster 2) tenant-boundary suite: matches, matchmaking draws and
// tournaments must stay isolated per group, and the readers that aggregate
// over them (leaderboard, stats/playtime, hall-of-fame, export, digest) must
// never mix two groups' competition data. Runs like the sibling 5b/cluster-1
// suites: a real app in an isolated required-auth child process with
// MULTI_GROUPS_ENABLED=1.

import { execFileSync } from 'child_process';
import path from 'path';
import { test } from 'node:test';

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const RECOVERY_CODE = 'competition-recovery-code';

test('matches, matchmaking draws, tournaments and their aggregates stay isolated across two groups', () => {
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

      const bob = await register('Competition Bob', 'competition bob secure passphrase');
      const carol = await register('Competition Carol', 'competition carol secure passphrase');
      assert.equal((await request(app).post('/api/auth/reauth').set('Cookie', carol.cookie).send({ password: carol.password })).status, 204);

      const groupAResponse = await request(app).post('/api/groups').set('Cookie', alice.cookie).send({ name: 'Competition Group A' });
      const groupBResponse = await request(app).post('/api/groups').set('Cookie', carol.cookie).send({ name: 'Competition Group B' });
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

      const gameA = await scoped(app, 'post', '/api/games', alice.cookie, groupA).send({ name: 'Competition Game A', status: 'catalog' });
      assert.equal(gameA.status, 201, JSON.stringify(gameA.body));
      const gameB = await scoped(app, 'post', '/api/games', carol.cookie, groupB).send({ name: 'Competition Game B', status: 'suggestion' });
      assert.equal(gameB.status, 201, JSON.stringify(gameB.body));

      // Real per-group events (competition data is always tagged to whichever
      // event is currently *tracking*, a single global flag today — see
      // routes/agent.ts's tracking-context resolution — so each group's data
      // below is created while that group's own event is the tracking one).
      const now = Date.now();
      const eventA = await scoped(app, 'post', '/api/events', alice.cookie, groupA).send({ name: 'Competition Event A', startsAt: now, endsAt: now + 60_000 });
      const eventB = await scoped(app, 'post', '/api/events', carol.cookie, groupB).send({ name: 'Competition Event B', startsAt: now, endsAt: now + 60_000 });
      assert.equal(eventA.status, 201, JSON.stringify(eventA.body));
      assert.equal(eventB.status, 201, JSON.stringify(eventB.body));
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/start', alice.cookie, groupA).send({})).status, 200);

      // ---------- matches (created while group A's event tracks) ----------
      const matchA = await scoped(app, 'post', '/api/matches', alice.cookie, groupA).send({
        gameId: gameA.body.id,
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
        winnerTeamIndex: 0,
      });
      assert.equal(matchA.status, 201, JSON.stringify(matchA.body));

      // ---------- matchmaking draws (group A) ----------
      const drawA = await scoped(app, 'post', '/api/matchmaking', alice.cookie, groupA).send({
        gameId: gameA.body.id,
        playerIds: [alice.account.id, bob.account.id],
      });
      assert.equal(drawA.status, 200, JSON.stringify(drawA.body));

      // ---------- tournaments (group A) ----------
      const tournamentA = await scoped(app, 'post', '/api/tournaments', alice.cookie, groupA).send({
        gameId: gameA.body.id,
        format: 'single_elimination',
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
      });
      assert.equal(tournamentA.status, 201, JSON.stringify(tournamentA.body));

      const bobForeignTournamentGame = await scoped(app, 'post', '/api/tournaments', bob.cookie, groupA).send({
        gameId: gameB.body.id,
        format: 'single_elimination',
        teams: [{ playerIds: [alice.account.id] }, { playerIds: [bob.account.id] }],
      });
      assert.equal(bobForeignTournamentGame.status, 404);

      // Switch tracking to group B's own event before creating its data.
      assert.equal((await scoped(app, 'post', '/api/events/' + eventA.body.id + '/tracking/stop', alice.cookie, groupA).send({})).status, 200);
      assert.equal((await scoped(app, 'post', '/api/events/' + eventB.body.id + '/tracking/start', carol.cookie, groupB).send({})).status, 200);

      const matchB = await scoped(app, 'post', '/api/matches', carol.cookie, groupB).send({
        gameId: gameB.body.id,
        teams: [{ playerIds: [carol.account.id] }, { playerIds: [alice.account.id] }],
        winnerTeamIndex: 0,
      });
      assert.equal(matchB.status, 201, JSON.stringify(matchB.body));

      // ---------- isolation checks ----------
      const matchesInA = await scoped(app, 'get', '/api/matches', alice.cookie, groupA);
      assert.ok(matchesInA.body.some((m) => m.id === matchA.body.id));
      assert.equal(matchesInA.body.some((m) => m.id === matchB.body.id), false);

      const bobForeignMatchPatch = await scoped(app, 'patch', '/api/matches/' + matchB.body.id, bob.cookie, groupA).send({ playedAt: Date.now() });
      assert.equal(bobForeignMatchPatch.status, 404);

      // Leaderboard: Alice appears in both groups (played one match in each),
      // but each group's standings must only reflect its own match.
      const leaderboardA = await scoped(app, 'get', '/api/leaderboard', alice.cookie, groupA);
      const leaderboardB = await scoped(app, 'get', '/api/leaderboard', carol.cookie, groupB);
      assert.equal(leaderboardA.status, 200);
      assert.equal(leaderboardB.status, 200);
      const aliceInA = leaderboardA.body.standings.find((s) => s.playerId === alice.account.id);
      const aliceInB = leaderboardB.body.standings.find((s) => s.playerId === alice.account.id);
      assert.equal(aliceInA.matchesPlayed, 1);
      assert.equal(aliceInB.matchesPlayed, 1);

      const historyInA = await scoped(app, 'get', '/api/matchmaking/history', alice.cookie, groupA).query({ eventId: eventA.body.id });
      assert.ok(historyInA.body.history.some((d) => d.id === drawA.body.id));
      const historyInB = await scoped(app, 'get', '/api/matchmaking/history', carol.cookie, groupB).query({ eventId: eventA.body.id });
      assert.equal(historyInB.body.history.some((d) => d.id === drawA.body.id), false);
      const moveForeignDraw = await scoped(app, 'patch', '/api/matchmaking/draws/' + drawA.body.id + '/move', carol.cookie, groupB)
        .send({ playerId: alice.account.id, toTeamIndex: 0 });
      assert.equal(moveForeignDraw.status, 404);

      const tournamentsInB = await scoped(app, 'get', '/api/tournaments', carol.cookie, groupB).query({ eventId: eventA.body.id });
      assert.equal(tournamentsInB.body.some((t) => t.id === tournamentA.body.id), false);
      const foreignTournamentDetail = await scoped(app, 'get', '/api/tournaments/' + tournamentA.body.id, carol.cookie, groupB);
      assert.equal(foreignTournamentDetail.status, 404);

      const firstMatch = tournamentA.body.matches.find((m) => m.teamAId && m.teamBId);
      const foreignResult = await scoped(app, 'post', '/api/tournaments/' + tournamentA.body.id + '/matches/' + firstMatch.id + '/result', carol.cookie, groupB)
        .send({ winnerTeamId: tournamentA.body.teams[0].id });
      assert.equal(foreignResult.status, 404);
      const ownResult = await scoped(app, 'post', '/api/tournaments/' + tournamentA.body.id + '/matches/' + firstMatch.id + '/result', alice.cookie, groupA)
        .send({ winnerTeamId: tournamentA.body.teams[0].id });
      assert.equal(ownResult.status, 200, JSON.stringify(ownResult.body));

      // ---------- stats/playtime, hall-of-fame, export spot checks ----------
      const playtimeA = await scoped(app, 'get', '/api/stats/playtime', alice.cookie, groupA);
      assert.equal(playtimeA.status, 200);
      assert.equal(playtimeA.body.entries.some((e) => e.gameId === gameB.body.id), false);

      const hallOfFameB = await scoped(app, 'get', '/api/hall-of-fame', carol.cookie, groupB);
      assert.equal(hallOfFameB.status, 200);
      const bTournamentNames = hallOfFameB.body.events.flatMap((e) => e.tournamentChampions.map((t) => t.name));
      assert.equal(bTournamentNames.includes(tournamentA.body.name), false);

      const exportForeign = await scoped(app, 'get', '/api/export', carol.cookie, groupB).query({ eventId: eventA.body.id });
      assert.equal(exportForeign.status, 404, JSON.stringify(exportForeign.body));
      const exportOwn = await scoped(app, 'get', '/api/export', carol.cookie, groupB).query({ eventId: eventB.body.id });
      assert.equal(exportOwn.status, 200, JSON.stringify(exportOwn.body));
      assert.equal(exportOwn.body.leaderboard.some((s) => s.playerId === bob.account.id), false);
      assert.equal(exportOwn.body.tournaments.some((t) => t.name === tournamentA.body.name), false);
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
      `group competition child failed:\n${child.stderr?.toString() ?? ''}\n${child.stdout?.toString() ?? ''}`,
    );
  }
});
