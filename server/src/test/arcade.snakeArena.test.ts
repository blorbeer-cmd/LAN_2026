import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { nanoid } from 'nanoid';
import request from 'supertest';
import { createApp } from '../app';
import { createTestApp, DEFAULT_GROUP_ID, installTestSocketIdentity } from './testApp';
import { registerSnakeSockets } from '../arcade/snake';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { db } from '../db';

function connect(baseUrl: string, playerId?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false, auth: playerId ? { playerId } : undefined });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function waitForSnakeState<T>(socket: ClientSocket, predicate: (state: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const onState = (state: T) => {
      if (predicate(state)) resolve(state);
      else socket.once('snake:state', onState);
    };
    socket.once('snake:state', onState);
  });
}

test('Snake Arena validates its mode and supports lobbies with three to eight players', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerSnakeSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const sockets: ClientSocket[] = [];

  try {
    const playerIds: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const response = await request(baseUrl).post('/api/players').send({ name: `Arena Snake ${index + 1}` });
      assert.equal(response.status, 201);
      playerIds.push(response.body.id);
      sockets.push(await connect(baseUrl));
    }

    const invalid = await emitAck(sockets[0], 'snake:lobby:create', { playerId: playerIds[0], mode: 'royale' });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error ?? '', /Unbekannter Snake-Modus/);

    const created = await emitAck(sockets[0], 'snake:lobby:create', { playerId: playerIds[0], mode: 'arena' });
    assert.equal(created.ok, true);
    const lobbyId = created.lobbyId as string;
    await emitAck(sockets[1], 'snake:lobby:join', { lobbyId, playerId: playerIds[1] });

    const tooSmall = await emitAck(sockets[0], 'snake:lobby:start', { lobbyId, playerId: playerIds[0] });
    assert.equal(tooSmall.ok, false);
    assert.match(tooSmall.error ?? '', /3 bis 8/);

    await emitAck(sockets[2], 'snake:lobby:join', { lobbyId, playerId: playerIds[2] });
    const startedEvent = waitForEvent<{ mode: string; players: Array<{ id: string }> }>(sockets[1], 'snake:match:start');
    const started = await emitAck(sockets[0], 'snake:lobby:start', { lobbyId, playerId: playerIds[0] });
    assert.equal(started.ok, true);
    const startPayload = await startedEvent;
    assert.equal(startPayload.mode, 'arena');
    assert.equal(startPayload.players.length, 3);
    await emitAck(sockets[0], 'snake:match:finish', { matchId: started.matchId, playerId: playerIds[0] });

    const fullLobby = await emitAck(sockets[0], 'snake:lobby:create', { playerId: playerIds[0], mode: 'arena' });
    assert.equal(fullLobby.ok, true);
    for (let index = 1; index < 8; index += 1) {
      const joined = await emitAck(sockets[index], 'snake:lobby:join', { lobbyId: fullLobby.lobbyId, playerId: playerIds[index] });
      assert.equal(joined.ok, true);
    }
    const overflow = await emitAck(sockets[8], 'snake:lobby:join', { lobbyId: fullLobby.lobbyId, playerId: playerIds[8] });
    assert.equal(overflow.ok, false);
    assert.match(overflow.error ?? '', /max\. 8 Spieler/);
  } finally {
    sockets.forEach((socket) => socket.close());
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('Snake Arena AI quick start is admin-gated and fills all eight slots', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerSnakeSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const socket = await connect(baseUrl);

  try {
    const player = await request(baseUrl).post('/api/players').send({ name: 'Snake KI Host' });
    assert.equal(player.status, 201);

    const denied = await emitAck(socket, 'snake:lobby:bot', { playerId: player.body.id, mode: 'arena' });
    assert.equal(denied.ok, false);
    assert.match(denied.error ?? '', /nur für Admins/);

    await request(baseUrl)
      .patch(`/api/groups/${DEFAULT_GROUP_ID}/members/${player.body.id}`)
      .send({ role: 'admin' })
      .expect(200);
    const lobbiesPromise = waitForEvent<{ lobbies: Array<{ id: string; mode: string; players: Array<{ id: string; ready: boolean }> }> }>(socket, 'snake:lobbies');
    const created = await emitAck(socket, 'snake:lobby:bot', { playerId: player.body.id, mode: 'arena' });
    assert.equal(created.ok, true);
    const lobby = (await lobbiesPromise).lobbies.find((entry) => entry.id === created.lobbyId);
    assert.ok(lobby);
    assert.equal(lobby.mode, 'arena');
    assert.equal(lobby.players.length, 8);
    assert.equal(lobby.players.filter((entry) => entry.id.startsWith('snake-bot-') && entry.ready).length, 7);

    const startedPromise = waitForEvent<{ matchId: string; mode: string; players: Array<{ id: string }> }>(socket, 'snake:match:start');
    const statePromise = waitForEvent<{ scores: Array<{ playerId: string; isBot: boolean }> }>(socket, 'snake:state');
    const started = await emitAck(socket, 'snake:lobby:start', { lobbyId: created.lobbyId, playerId: player.body.id });
    assert.equal(started.ok, true);
    const startPayload = await startedPromise;
    assert.equal(startPayload.mode, 'arena');
    assert.equal(startPayload.players.length, 8);
    const state = await statePromise;
    assert.equal(state.scores.filter((entry) => entry.isBot).length, 7);

    assert.equal((await emitAck(socket, 'snake:match:finish', { matchId: startPayload.matchId, playerId: player.body.id })).ok, true);
  } finally {
    socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

async function verifyArenaLeaveSecurity(): Promise<void> {
  clearLobbyMemberships();
  const groupId = nanoid();
  const eventId = nanoid();
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(groupId, 'Snake Arena Security', Date.now());
  db.prepare(
    `INSERT INTO events (id, name, starts_at, group_id, status, visibility_scope)
     VALUES (?, 'Snake Arena Security Event', 0, ?, 'published', 'participants')`,
  ).run(eventId, groupId);
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  io.use((socket, next) => {
    socket.data.authPlayerId = socket.handshake.auth.playerId;
    socket.data.groupId = groupId;
    socket.data.eventId = eventId;
    next();
  });
  registerSnakeSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const sockets: ClientSocket[] = [];

  try {
    const playerIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const playerId = nanoid();
      db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
        playerId,
        `Arena ${index + 1} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`,
        nanoid(24),
        Date.now(),
      );
      playerIds.push(playerId);
      db.prepare(
        `INSERT INTO group_memberships
           (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
         VALUES (?, ?, 'member', 'active', ?, NULL, 1, NULL)`,
      ).run(groupId, playerId, Date.now());
      db.prepare(
        `INSERT INTO event_participants (event_id, player_id, status)
         VALUES (?, ?, 'accepted')`,
      ).run(eventId, playerId);
    }
    for (const playerId of playerIds) sockets.push(await connect(baseUrl, playerId));

    const created = await emitAck(sockets[0], 'snake:lobby:create', { playerId: playerIds[0], mode: 'arena' });
    assert.equal(created.ok, true, `create failed: ${JSON.stringify(created)}`);
    for (let index = 1; index < 5; index += 1) {
      const joined = await emitAck(sockets[index], 'snake:lobby:join', { lobbyId: created.lobbyId, playerId: playerIds[index] });
      assert.equal(joined.ok, true, `join ${index} failed: ${JSON.stringify(joined)}`);
    }
    const started = await emitAck(sockets[0], 'snake:lobby:start', { lobbyId: created.lobbyId, playerId: playerIds[0] });
    assert.equal(started.ok, true, `start failed: ${JSON.stringify(started)}`);
    const matchId = started.matchId as string;
    const snakeGameId = (db.prepare('SELECT id FROM games WHERE arcade_key = ?').get('snake') as { id: string }).id;
    const trackingGroupId = groupId;
    const openTracking = (playerId: string) => ({
      live: (db.prepare(
        `SELECT COUNT(*) AS count
         FROM tracking_live_games
         WHERE player_id = ? AND game_id = ? AND group_id = ? AND event_id = ?`,
      ).get(playerId, snakeGameId, trackingGroupId, eventId) as { count: number }).count,
      sessions: (db.prepare(
        `SELECT COUNT(*) AS count
         FROM play_sessions
         WHERE player_id = ? AND game_id = ? AND group_id = ? AND event_id = ? AND ended_at IS NULL`,
      ).get(playerId, snakeGameId, trackingGroupId, eventId) as { count: number }).count,
    });
    for (const playerId of playerIds.slice(0, 5)) assert.deepEqual(openTracking(playerId), { live: 1, sessions: 1 });
    assert.deepEqual(openTracking(playerIds[5]), { live: 0, sessions: 0 });

    const spoofed = await emitAck(sockets[1], 'snake:match:leave', { matchId, playerId: playerIds[2] });
    assert.equal(spoofed.ok, false, 'a socket must not eliminate another participant');

    const afterOwnLeave = waitForSnakeState<{ world: { snakes: Array<{ alive: boolean }> } }>(
      sockets[0],
      (state) => state.world.snakes[1].alive === false,
    );
    const ownLeave = await emitAck(sockets[1], 'snake:match:leave', { matchId, playerId: playerIds[1] });
    assert.equal(ownLeave.ok, true, `own leave failed: ${JSON.stringify(ownLeave)}`);
    const ownLeaveState = await afterOwnLeave;
    assert.equal(ownLeaveState.world.snakes[1].alive, false);
    assert.equal(ownLeaveState.world.snakes[2].alive, true);
    assert.equal(io.sockets.adapter.rooms.get(`snake:${matchId}`)?.has(sockets[1].id ?? ''), false);
    assert.deepEqual(openTracking(playerIds[1]), { live: 0, sessions: 0 });
    for (const playerId of [playerIds[0], playerIds[2], playerIds[3], playerIds[4]]) {
      assert.deepEqual(openTracking(playerId), { live: 1, sessions: 1 });
    }

    const replacementLobby = await emitAck(sockets[1], 'snake:lobby:create', { playerId: playerIds[1], mode: 'classic' });
    assert.equal(replacementLobby.ok, true, `replacement create failed: ${JSON.stringify(replacementLobby)}`);
    assert.equal((await emitAck(sockets[5], 'snake:lobby:join', { lobbyId: replacementLobby.lobbyId, playerId: playerIds[5] })).ok, true);
    const replacementMatch = await emitAck(sockets[1], 'snake:lobby:start', { lobbyId: replacementLobby.lobbyId, playerId: playerIds[1] });
    assert.equal(replacementMatch.ok, true, `replacement start failed: ${JSON.stringify(replacementMatch)}`);
    assert.deepEqual(openTracking(playerIds[1]), { live: 1, sessions: 1 });

    const afterHostLeave = waitForSnakeState<{ host: { id: string }; world: { snakes: Array<{ alive: boolean }> } }>(
      sockets[2],
      (state) => state.host.id === playerIds[2] && state.world.snakes[0].alive === false,
    );
    const hostLeave = await emitAck(sockets[0], 'snake:match:leave', { matchId, playerId: playerIds[0] });
    assert.equal(hostLeave.ok, true, `host leave failed: ${JSON.stringify(hostLeave)}`);
    const hostLeaveState = await afterHostLeave;
    assert.equal(hostLeaveState.world.snakes[0].alive, false);
    assert.equal(hostLeaveState.host.id, playerIds[2], 'the next living player becomes host');
    assert.equal((await emitAck(sockets[2], 'snake:match:pause', { matchId, playerId: playerIds[2] })).ok, true);
    assert.equal((await emitAck(sockets[2], 'snake:match:resume', { matchId, playerId: playerIds[2] })).ok, true);
    assert.deepEqual(openTracking(playerIds[0]), { live: 0, sessions: 0 });

    const afterDisconnect = waitForSnakeState<{ host: { id: string }; world: { snakes: Array<{ alive: boolean }> } }>(
      sockets[3],
      (state) => state.host.id === playerIds[3] && state.world.snakes[2].alive === false,
    );
    sockets[2].close();
    const disconnectState = await afterDisconnect;
    assert.equal(disconnectState.world.snakes[2].alive, false);
    assert.equal(disconnectState.host.id, playerIds[3]);
    assert.deepEqual(openTracking(playerIds[2]), { live: 0, sessions: 0 });
    for (const playerId of [playerIds[3], playerIds[4]]) assert.deepEqual(openTracking(playerId), { live: 1, sessions: 1 });

    const matchEnd = waitForEvent<{ winner: { id: string } | null; reason: string }>(sockets[4], 'snake:match:end');
    sockets[3].close();
    const ended = await matchEnd;
    assert.equal(ended.winner?.id, playerIds[4], 'disconnect is an immediate forfeit');
    assert.equal(ended.reason, 'completed');
    assert.deepEqual(openTracking(playerIds[1]), { live: 1, sessions: 1 }, 'the old Arena must not close replacement tracking');
    assert.equal((await emitAck(sockets[1], 'snake:match:finish', { matchId: replacementMatch.matchId, playerId: playerIds[1] })).ok, true);
  } finally {
    sockets.forEach((socket) => socket.close());
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
}

test('Snake Arena binds leave actions to the socket identity and forfeits disconnects', async () => {
  await verifyArenaLeaveSecurity();
});
