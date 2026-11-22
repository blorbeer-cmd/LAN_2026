import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import request from 'supertest';
import { createApp } from '../app';
import { config } from '../config';
import { db, DEFAULT_GROUP_ID } from '../db';
import { createSession, markSessionReauthenticated, SESSION_COOKIE_NAME, verifySession } from '../sessions';
import { ensureAccountEventContext } from '../eventContext';
import { statistics, statisticsSchema } from '../mcp/data';
import { resolvePrincipal } from '../mcp/access';

Object.assign(config, { mcpEnabled: true, publicBaseUrl: 'https://respawn.example' });
const base = 'https://respawn.example';
const app = createApp();
let sequence = 0;

function fixture() {
  const prefix = `mcp-${++sequence}`;
  const actor = `${prefix}-admin`, member = `${prefix}-member`, event = `${prefix}-event`, game = `${prefix}-game`;
  for (const [id, role] of [[actor, 'admin'], [member, 'member']]) {
    db.prepare('INSERT INTO players(id,name,api_key,created_at,is_admin) VALUES(?,?,?,?,?)').run(id, id, `key-${id}`, 1, role === 'admin' ? 1 : 0);
    db.prepare("INSERT INTO group_memberships(group_id,player_id,role,status) VALUES(?,?,?,'active')").run(DEFAULT_GROUP_ID, id, role);
  }
  db.prepare("INSERT INTO events(id,name,starts_at,group_id,status,event_type_key) VALUES(?,?,1,?,'published','lan')").run(event, event, DEFAULT_GROUP_ID);
  for (const player of [actor, member]) {
    db.prepare("INSERT INTO event_participants(event_id,player_id,status) VALUES(?,?,'accepted')").run(event, player);
    ensureAccountEventContext(player, event);
  }
  db.prepare("INSERT INTO games(id,name,created_at,group_id,status) VALUES(?,?,1,?,'catalog')").run(game, game, DEFAULT_GROUP_ID);
  const session = createSession(actor);
  markSessionReauthenticated(verifySession(session)!.session.id);
  const memberSession = createSession(member);
  const cookie = `${SESSION_COOKIE_NAME}=${session}`;
  const memberCookie = `${SESSION_COOKIE_NAME}=${memberSession}`;
  const teams = JSON.stringify([{ players: [{ id: actor, name: actor, rating: 3 }], totalRating: 3 },
    { players: [{ id: member, name: member, rating: 3 }], totalRating: 3 }]);
  function draw(suffix: string, generatedAt: number, source: string | null = null) {
    const id = `${prefix}-${suffix}`;
    db.prepare(`INSERT INTO matchmaking_draws(id,game_id,event_id,group_id,teams,generated_at,source,created_by)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, game, event, DEFAULT_GROUP_ID, teams, generatedAt, source, actor);
    return id;
  }
  return { actor, member, event, game, cookie, memberCookie, draw, prefix };
}

async function connect(f: ReturnType<typeof fixture>, cleanup = false) {
  const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const registered = await request(app).post('/mcp/oauth/register').send({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const clientId = registered.body.client_id as string;
  const verifier = 'a'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorized = await request(app).get('/mcp/authorize').query({ client_id: clientId, redirect_uri: redirect,
    response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, state: 'test-state',
    resource: `${base}/mcp`, scope: `event:read teams:preview${cleanup ? ' draws:cleanup' : ''}` });
  assert.equal(authorized.status, 302, JSON.stringify(authorized.body));
  const requestId = new URL(authorized.headers.location, base).searchParams.get('request');
  const consentRequest = () => request(app).post('/mcp/oauth/consent').set('Cookie', f.cookie).set('Origin', base)
    .send({ requestId, eventId: f.event, allowCleanup: cleanup });
  const consents = await Promise.all([consentRequest(), consentRequest()]);
  assert.deepEqual(consents.map((r) => r.status).sort(), [200, 409]);
  const consent = consents.find((r) => r.status === 200)!;
  assert.equal(consent.status, 200, JSON.stringify(consent.body));
  const target = new URL(consent.body.redirect);
  assert.equal(target.searchParams.get('state'), 'test-state');
  assert.equal(target.searchParams.get('iss'), base);
  const exchange = { grant_type: 'authorization_code', code: target.searchParams.get('code'), client_id: clientId,
    redirect_uri: redirect, code_verifier: verifier, resource: `${base}/mcp` };
  assert.equal((await request(app).post('/mcp/oauth/token').type('form').send({ ...exchange, code_verifier: 'b'.repeat(64) })).status, 400);
  const exchanges = await Promise.all([request(app).post('/mcp/oauth/token').type('form').send(exchange),
    request(app).post('/mcp/oauth/token').type('form').send(exchange)]);
  assert.deepEqual(exchanges.map((r) => r.status).sort(), [200, 400]);
  const tokens = exchanges.find((r) => r.status === 200)!;
  assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
  assert.equal((await request(app).post('/mcp/oauth/token').type('form').send(exchange)).status, 400, 'authorization code cannot be replayed');
  return { token: tokens.body.access_token as string, refresh: tokens.body.refresh_token as string, clientId };
}

function rpc(token: string, method: string, params?: object) {
  return request(app).post('/mcp').set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });
}

test('MCP OAuth, PKCE, protocol discovery, strict tools, scopes and revocation work end to end', async () => {
  const f = fixture();
  const unauthorized = await request(app).post('/mcp').send({});
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers['www-authenticate'], /oauth-protected-resource\/mcp/);
  const metadata = await request(app).get('/.well-known/oauth-authorization-server');
  assert.deepEqual(metadata.body.code_challenge_methods_supported, ['S256']);
  assert.equal((await request(app).post('/mcp/oauth/register').send({ redirect_uris: ['https://attacker.example/callback'] })).status, 400);
  const auth = await connect(f);
  const initialized = await rpc(auth.token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } });
  assert.equal(initialized.status, 200, JSON.stringify(initialized.body));
  assert.equal(initialized.body.result.serverInfo.name, 'respawn');
  const list = await rpc(auth.token, 'tools/list');
  assert.equal(list.body.result.tools.length, 9);
  assert.equal(list.body.result.tools.find((tool: { name: string }) => tool.name === 'get_statistics').inputSchema.additionalProperties, false);
  const beforeChanges = db.prepare('SELECT total_changes()').pluck().get();
  const context = await rpc(auth.token, 'tools/call', { name: 'get_context', arguments: {} });
  assert.equal(context.body.result.structuredContent.eventId, f.event);
  const preview = await rpc(auth.token, 'tools/call', { name: 'preview_teams', arguments: { gameId: f.game, playerIds: [f.actor, f.member] } });
  assert.equal(preview.body.result.structuredContent.data.previewOnly, true, JSON.stringify(preview.body));
  assert.equal(db.prepare('SELECT total_changes()').pluck().get(), beforeChanges, 'context and preview cause no DB writes');
  const invalid = await rpc(auth.token, 'tools/call', { name: 'get_statistics', arguments: { metric: 'poll_usage', eventId: 'foreign' } });
  assert.equal(invalid.body.result.isError, true, 'unknown event override is rejected');
  const denied = await rpc(auth.token, 'tools/call', { name: 'preview_draw_cleanup', arguments: { age: 1, unit: 'days' } });
  assert.equal(denied.body.result.isError, true, 'read connection has no cleanup grant');
  const connection = db.prepare('SELECT * FROM mcp_connections WHERE player_id=?').get(f.actor) as { id: string; access_hash: string; refresh_hash: string };
  assert.notEqual(connection.access_hash, auth.token);
  assert.notEqual(connection.refresh_hash, auth.refresh);
  const refreshed = await request(app).post('/mcp/oauth/token').type('form')
    .send({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: auth.clientId, resource: `${base}/mcp` });
  assert.equal(refreshed.status, 200);
  assert.equal((await rpc(auth.token, 'tools/list')).status, 401, 'refresh rotates the access credential');
  const replay = await request(app).post('/mcp/oauth/token').type('form')
    .send({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: auth.clientId, resource: `${base}/mcp` });
  assert.equal(replay.status, 400);
  assert.equal((await request(app).delete(`/api/integrations/connections/${connection.id}`).set('Cookie', f.cookie).set('Origin', base)).status, 204);
  assert.equal((await rpc(refreshed.body.access_token, 'tools/list')).status, 401);
});

test('cleanup protects boundaries and linked results, requires browser approval, and is idempotent under concurrent requests', async (t) => {
  const now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const old = f.draw('old', now - 7_200_000);
  const boundary = f.draw('boundary', now - 3_600_000);
  const draft = f.draw('draft', now - 7_200_000, 'draft');
  const recorded = f.draw('recorded', now - 7_200_000);
  const matchId = `${f.prefix}-match`;
  db.prepare('INSERT INTO matches(id,game_id,event_id,group_id,played_at,result) VALUES(?,?,?,?,?,?)')
    .run(matchId, f.game, f.event, DEFAULT_GROUP_ID, now, JSON.stringify({ teams: [{ playerIds: [f.actor] }, { playerIds: [f.member] }], winnerTeamIndex: null, isDraw: true }));
  db.prepare('UPDATE matchmaking_draws SET match_id=? WHERE id=?').run(matchId, recorded);
  const protectedDraw = f.draw('betting', now - 7_200_000);
  db.prepare(`INSERT INTO betting_rounds(id,group_id,event_id,source_type,source_id,title,outcomes,status,closes_at,created_at)
    VALUES(?,?,?,'draw',?,'Protected','[]','open',?,?)`).run(`${f.prefix}-bet`, DEFAULT_GROUP_ID, f.event, protectedDraw, now + 100_000, now);
  const auth = await connect(f, true);
  const preview = await rpc(auth.token, 'tools/call', { name: 'preview_draw_cleanup', arguments: { age: 1, unit: 'hours' } });
  const plan = preview.body.result.structuredContent.data;
  assert.equal(plan.confirmationUrl, `${base}/admin/draw-cleanup?plan=${plan.id}`);
  assert.equal((await request(app).get(`/admin/draw-cleanup?plan=${plan.id}`)).status, 200);
  const missingGame = await rpc(auth.token, 'tools/call', {
    name: 'preview_draw_cleanup', arguments: { age: 1, unit: 'hours', gameId: 'missing-game' },
  });
  assert.equal(missingGame.body.result.isError, true);
  assert.equal(plan.deletable, 1, JSON.stringify(preview.body));
  assert.equal(plan.protectedCount, 1);
  assert.deepEqual(plan.entries.filter((entry: { protectedReason: string | null }) => !entry.protectedReason).map((entry: { id: string }) => entry.id), [old]);
  const unapproved = await rpc(auth.token, 'tools/call', { name: 'execute_draw_cleanup', arguments: { planId: plan.id } });
  assert.equal(unapproved.body.result.isError, true);
  const confirm = () => request(app).post(`/api/integrations/cleanup/${plan.id}/confirm`).set('Cookie', f.cookie).set('Origin', base).send({ confirmedCount: 1 });
  assert.equal((await request(app).post(`/api/integrations/cleanup/${plan.id}/confirm`).set('Cookie', f.cookie)
    .send({ confirmedCount: 1 })).status, 403, 'confirmation requires same origin');
  const results = await Promise.all([confirm(), confirm()]);
  assert.deepEqual(results.map((r) => r.status), [200, 200], JSON.stringify(results.map((r) => r.body)));
  assert.deepEqual(results.map((r) => r.body.deleted), [1, 1]);
  assert.equal(db.prepare('SELECT id FROM matchmaking_draws WHERE id=?').get(old), undefined);
  for (const id of [boundary, draft, recorded, protectedDraw]) assert.ok(db.prepare('SELECT id FROM matchmaking_draws WHERE id=?').get(id));
  assert.ok(db.prepare('SELECT id FROM matches WHERE id=?').get(matchId));
  assert.equal(db.prepare("SELECT COUNT(*) FROM admin_log WHERE action='matchmaking_draws_cleaned' AND target_id=?").pluck().get(plan.id), 1);
  const outcome = await rpc(auth.token, 'tools/call', { name: 'execute_draw_cleanup', arguments: { planId: plan.id } });
  assert.equal(outcome.body.result.structuredContent.data.deleted, 1);
});

test('cleanup refuses changed candidates, expired plans, and revoked roles without deleting other candidates', async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const a = f.draw('a', now - 7_200_000), b = f.draw('b', now - 7_200_000);
  const auth = await connect(f, true);
  const preview = async () => {
    const response = await rpc(auth.token, 'tools/call', { name: 'preview_draw_cleanup', arguments: { age: 1, unit: 'hours' } });
    const plan = response.body.result?.structuredContent?.data;
    assert.ok(plan?.id, JSON.stringify(response.body));
    return plan.id as string;
  };
  const plan = await preview();
  db.prepare('UPDATE matchmaking_draws SET teams=? WHERE id=?').run('[]', a);
  let response = await request(app).post(`/api/integrations/cleanup/${plan}/confirm`).set('Cookie', f.cookie).set('Origin', base).send({ confirmedCount: 2 });
  assert.equal(response.status, 409);
  assert.ok(db.prepare('SELECT id FROM matchmaking_draws WHERE id=?').get(b));
  const expired = await preview();
  now += 11 * 60_000;
  // Fresh reauthentication does not extend the plan deadline.
  const token = f.cookie.split('=')[1]; markSessionReauthenticated(verifySession(token)!.session.id);
  response = await request(app).post(`/api/integrations/cleanup/${expired}/confirm`).set('Cookie', f.cookie).set('Origin', base).send({ confirmedCount: 2 });
  assert.equal(response.status, 409);
  const revoked = await preview();
  db.prepare("UPDATE group_memberships SET role='member' WHERE group_id=? AND player_id=?").run(DEFAULT_GROUP_ID, f.actor);
  response = await request(app).post(`/api/integrations/cleanup/${revoked}/confirm`).set('Cookie', f.cookie).set('Origin', base).send({ confirmedCount: 2 });
  assert.equal(response.status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) FROM matchmaking_draws WHERE event_id=?').pluck().get(f.event), 2);
});

test('concurrent result entry and cleanup cannot remove a recorded match', async (t) => {
  const now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const id = f.draw('race', now - 7_200_000);
  const auth = await connect(f, true);
  const preview = await rpc(auth.token, 'tools/call', { name: 'preview_draw_cleanup', arguments: { age: 1, unit: 'hours' } });
  const plan = preview.body.result?.structuredContent?.data;
  assert.ok(plan?.id, JSON.stringify(preview.body));
  const [recorded, cleaned] = await Promise.all([
    request(app).post('/api/matches').set('Cookie', f.cookie).send({ gameId: f.game, drawId: id,
      teams: [{ playerIds: [f.actor] }, { playerIds: [f.member] }], winnerTeamIndex: 0 }),
    request(app).post(`/api/integrations/cleanup/${plan.id}/confirm`).set('Cookie', f.cookie).set('Origin', base).send({ confirmedCount: 1 }),
  ]);
  if (recorded.status === 201) {
    assert.equal(cleaned.status, 409, JSON.stringify(cleaned.body));
    assert.ok(db.prepare('SELECT id FROM matches WHERE id=?').get(recorded.body.id));
    assert.equal((db.prepare('SELECT match_id FROM matchmaking_draws WHERE id=?').get(id) as { match_id: string }).match_id, recorded.body.id);
  } else {
    assert.equal(recorded.status, 404, JSON.stringify(recorded.body));
    assert.equal(cleaned.status, 200, JSON.stringify(cleaned.body));
    assert.equal(db.prepare('SELECT COUNT(*) FROM matches WHERE event_id=?').pluck().get(f.event), 0);
  }
});

test('statistics aggregate complete data before limiting and distinguish player-hours, team sources and missing results', () => {
  const f = fixture();
  f.draw('automatic', 100); f.draw('draft', 100, 'draft'); f.draw('rematch', 100, 'rematch');
  for (const player of [f.actor, f.member]) db.prepare(`INSERT INTO play_sessions(player_id,game_id,event_id,group_id,started_at,ended_at,active_ms)
    VALUES(?,?,?,?,1000,3601000,0)`).run(player, f.game, f.event, DEFAULT_GROUP_ID);
  const principal = resolvePrincipal(f.actor, f.event);
  const gameStats = statistics(principal, statisticsSchema.parse({ metric: 'playtime_by_game' })) as { rows: Array<{ playerHours: number; players: number }> };
  assert.equal(gameStats.rows[0].playerHours, 2); assert.equal(gameStats.rows[0].players, 2);
  const draws = statistics(principal, statisticsSchema.parse({ metric: 'draws_without_result', topN: 1 })) as { total: number; withoutResult: number; totalRows: number; rows: unknown[] };
  assert.equal(draws.total, 3); assert.equal(draws.withoutResult, 3); assert.equal(draws.totalRows, 3); assert.equal(draws.rows.length, 1);
  assert.throws(() => statistics(principal, statisticsSchema.parse({ metric: 'poll_usage', gameId: f.game })), /Spielfilter/);
  assert.throws(() => statistics(principal, statisticsSchema.parse({ metric: 'playtime_by_game', gameId: 'missing-game' })), /Spiel nicht gefunden/);
});

test('poll usage counts people once per poll, includes unanswered rounds and respects hidden participation', () => {
  const f = fixture();
  const makePoll = (suffix: string, status = 'closed', creator = f.actor, hidden = 0) => {
    const id = `${f.prefix}-${suffix}`;
    db.prepare(`INSERT INTO event_date_polls(id,event_id,round_number,created_by,status,created_at,updated_at,topic,decision_key,title,live_results_hidden)
      VALUES(?,?,1,?,?,100,100,'custom',?,?,?)`).run(id, f.event, creator, status, id, id, hidden);
    for (const player of [f.actor, f.member]) db.prepare('INSERT INTO event_date_poll_invitees(poll_id,player_id,invited_at) VALUES(?,?,1)').run(id, player);
    for (const suffix of ['a', 'b']) db.prepare(`INSERT INTO event_date_poll_options(id,poll_id,starts_on,ends_on,position,is_active)
      VALUES(?,?,?,?,1,1)`).run(`${id}-${suffix}`, id, suffix === 'a' ? '2026-01-01' : '2026-01-02', suffix === 'a' ? '2026-01-01' : '2026-01-02');
    return id;
  };
  const a = makePoll('poll-a'), b = makePoll('poll-b'); makePoll('empty');
  for (const poll of [a, b]) for (const option of ['a', 'b']) db.prepare(`INSERT INTO event_date_poll_responses(poll_id,option_id,player_id,response,updated_at)
    VALUES(?,?,?,'can',100)`).run(poll, `${poll}-${option}`, f.member);
  const principal = resolvePrincipal(f.actor, f.event);
  const read = () => {
    const result = statistics(principal, statisticsSchema.parse({ metric: 'poll_usage' }));
    assert.ok('totalPolls' in result);
    return result;
  };
  const result = read();
  assert.equal(result.totalPolls, 3); assert.equal(result.distinctRespondents, 1); assert.equal(result.responseParticipations, 2);
  assert.equal(result.pollsWithoutResponses, 1); assert.deepEqual(result.rows.map((r) => r.respondents).sort(), [0, 1, 1]);
  makePoll('hidden', 'open', f.member, 1);
  const hidden = read();
  assert.equal(hidden.totalPolls, 4); assert.equal(hidden.hiddenParticipationPolls, 1);
  assert.equal(hidden.distinctRespondents, null); assert.equal(hidden.responseParticipations, null);
  assert.equal(hidden.pollsWithoutResponses, null);
});

test('MCP rechecks event access and excludes public info secrets from summaries', async () => {
  const f = fixture();
  const auth = await connect(f);
  for (const name of ['get_game_options', 'get_competitions', 'get_event_summary']) {
    const result = await rpc(auth.token, 'tools/call', { name, arguments: {} });
    assert.equal(result.status, 200);
    assert.equal(result.body.result.isError, undefined, JSON.stringify(result.body));
    assert.equal(JSON.stringify(result.body).includes('communications'), false);
    assert.equal(JSON.stringify(result.body).includes('api_key'), false);
    assert.equal(JSON.stringify(result.body).includes('password_hash'), false);
  }
  const other = fixture();
  const connection = db.prepare('SELECT id FROM mcp_connections WHERE player_id=?').get(f.actor) as { id: string };
  assert.equal((await request(app).delete(`/api/integrations/connections/${connection.id}`).set('Cookie', other.cookie).set('Origin', base)).status, 204);
  assert.equal((await rpc(auth.token, 'tools/list')).status, 200, 'another account cannot revoke this grant');
  db.prepare("UPDATE event_participants SET status='declined' WHERE event_id=? AND player_id=?").run(f.event, f.actor);
  assert.equal((await rpc(auth.token, 'tools/list')).status, 404, 'loss of participation takes effect immediately');
});

test('disabled MCP leaves health and personal management available without standalone cleanup', async (t) => {
  const f = fixture();
  Object.assign(config, { mcpEnabled: false });
  t.after(() => Object.assign(config, { mcpEnabled: true }));
  assert.equal((await request(app).post('/mcp').send({})).status, 404);
  assert.equal((await request(app).get('/api/health')).status, 200);
  assert.equal((await request(app).get('/mcp/manage')).status, 200);
  assert.equal((await request(app).get('/admin/draw-cleanup')).status, 404);
  assert.equal((await request(app).post('/api/integrations/cleanup/preview').set('Cookie', f.cookie).set('Origin', base)
    .send({ eventId: f.event, age: 7, unit: 'days' })).status, 404);
});
