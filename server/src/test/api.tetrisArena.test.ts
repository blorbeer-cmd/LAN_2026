import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, DEFAULT_GROUP_ID, installTestSocketIdentity, TEST_ADMIN_ID } from './testApp';
import { registerTetrisSockets } from '../arcade/tetris';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { BASE_EVENT_ID, db } from '../db';

function connect(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
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

test('Tetris Arena starts with four players, survives departures and records placements once', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerTetrisSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const sockets = await Promise.all(Array.from({ length: 4 }, () => connect(baseUrl)));

  try {
    const playerIds: string[] = [];
    for (const name of ['Arena Host', 'Arena Zwei', 'Arena Drei', 'Arena Vier']) {
      const response = await request(baseUrl).post('/api/players').send({ name });
      assert.equal(response.status, 201);
      playerIds.push(response.body.id);
    }
    const [hostId, secondId, thirdId, fourthId] = playerIds;

    const invalidMode = await emitAck(sockets[0], 'tetris:lobby:create', { playerId: hostId, mode: 'typo' });
    assert.equal(invalidMode.ok, false);
    assert.match(invalidMode.error ?? '', /Modus/);

    const created = await emitAck(sockets[0], 'tetris:lobby:create', { playerId: hostId, mode: 'arena' });
    assert.equal(created.ok, true);
    const lobbyId = created.lobbyId as string;
    assert.equal((await emitAck(sockets[1], 'tetris:lobby:join', { lobbyId, playerId: secondId })).ok, true);

    const tooEarly = await emitAck(sockets[0], 'tetris:lobby:start', { lobbyId, playerId: hostId });
    assert.equal(tooEarly.ok, false);
    assert.match(tooEarly.error ?? '', /3 bis 8/);

    assert.equal((await emitAck(sockets[2], 'tetris:lobby:join', { lobbyId, playerId: thirdId })).ok, true);
    assert.equal((await emitAck(sockets[3], 'tetris:lobby:join', { lobbyId, playerId: fourthId })).ok, true);

    const notReady = await emitAck(sockets[0], 'tetris:lobby:start', { lobbyId, playerId: hostId });
    assert.equal(notReady.ok, false);
    assert.match(notReady.error ?? '', /bereit/);
    for (const [socket, playerId] of [
      [sockets[1], secondId],
      [sockets[2], thirdId],
      [sockets[3], fourthId],
    ] as Array<[ClientSocket, string]>) {
      assert.equal(
        (await emitAck(socket, 'tetris:lobby:ready', { lobbyId, playerId, ready: true })).ok,
        true,
      );
    }

    const matchStarted = waitForEvent<{ matchId: string; mode: string; players: Array<{ id: string }> }>(
      sockets[1],
      'tetris:match:start',
    );
    const started = await emitAck(sockets[0], 'tetris:lobby:start', { lobbyId, playerId: hostId });
    assert.equal(started.ok, true);
    const match = await matchStarted;
    assert.equal(match.mode, 'arena');
    assert.equal(match.players.length, 4);

    const spoofedLeave = await emitAck(sockets[1], 'tetris:match:leave', {
      matchId: match.matchId,
      playerId: thirdId,
    });
    assert.equal(spoofedLeave.ok, false);

    const firstState = waitForEvent<{
      players: Array<{ playerId: string; alive: boolean; placement: number | null }>;
    }>(sockets[0], 'tetris:state');
    assert.equal((await emitAck(sockets[3], 'tetris:match:leave', { matchId: match.matchId, playerId: fourthId })).ok, true);
    const afterFirstLeave = await firstState;
    assert.partialDeepStrictEqual(
      afterFirstLeave.players.find((player) => player.playerId === fourthId),
      { playerId: fourthId, alive: false, placement: 4 },
    );

    assert.equal((await emitAck(sockets[2], 'tetris:match:leave', { matchId: match.matchId, playerId: thirdId })).ok, true);
    const endedPromise = waitForEvent<{
      winner: { id: string };
      reason: string;
      scores: Array<{ playerId: string; mode: string; placement: number | null }>;
    }>(sockets[0], 'tetris:match:end');
    assert.equal((await emitAck(sockets[1], 'tetris:match:leave', { matchId: match.matchId, playerId: secondId })).ok, true);
    const ended = await endedPromise;
    assert.equal(ended.winner.id, hostId);
    assert.equal(ended.reason, 'completed');
    assert.equal(ended.scores.find((score) => score.playerId === hostId)?.placement, 1);
    assert.ok(ended.scores.every((score) => score.mode === 'arena'));

    const persisted = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM arcade_results
         WHERE game_type = 'tetris' AND reason = 'completed' AND json_extract(scores, '$[0].mode') = 'arena'`,
      )
      .get() as { count: number };
    assert.equal(persisted.count, 1);
  } finally {
    for (const socket of sockets) socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('a paused KI Arena ends when its last human host leaves', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerTetrisSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const hostSocket = await connect(baseUrl);
  const observerSocket = await connect(baseUrl);

  try {
    const player = await request(baseUrl).post('/api/players').send({ name: 'Arena KI Host' });
    assert.equal(player.status, 201);
    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(player.body.id);

    const created = await emitAck(hostSocket, 'tetris:lobby:bot', {
      playerId: player.body.id,
      mode: 'arena',
    });
    assert.equal(created.ok, true);
    const startedPromise = waitForEvent<{ matchId: string; beginsAt: number }>(hostSocket, 'tetris:match:start');
    assert.equal(
      (await emitAck(hostSocket, 'tetris:lobby:start', { lobbyId: created.lobbyId, playerId: player.body.id })).ok,
      true,
    );
    const started = await startedPromise;
    const observer = io.sockets.sockets.get(observerSocket.id!);
    assert.ok(observer);
    observer.data.authPlayerId = TEST_ADMIN_ID;
    observer.data.groupId = DEFAULT_GROUP_ID;
    observer.data.eventId = BASE_EVENT_ID;
    observer.join(`tetris:${started.matchId}`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, started.beginsAt - Date.now()) + 25));

    assert.equal(
      (await emitAck(hostSocket, 'tetris:match:pause', { matchId: started.matchId, playerId: player.body.id })).ok,
      true,
    );
    const endedPromise = waitForEvent<{ winner: { id: string }; reason: string }>(observerSocket, 'tetris:match:end');
    assert.equal(
      (await emitAck(hostSocket, 'tetris:match:leave', { matchId: started.matchId, playerId: player.body.id })).ok,
      true,
    );
    const ended = await endedPromise;
    assert.match(ended.winner.id, /^tetris-bot-/);
    assert.equal(ended.reason, 'no-human-players');
  } finally {
    hostSocket.close();
    observerSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('Tetris duel enforces readiness and batches simultaneous socket top-outs', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerTetrisSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);

  try {
    const host = await request(baseUrl).post('/api/players').send({ name: 'Batch Host' });
    const guest = await request(baseUrl).post('/api/players').send({ name: 'Batch Gast' });
    const created = await emitAck(hostSocket, 'tetris:lobby:create', { playerId: host.body.id });
    assert.equal(created.ok, true);
    assert.equal(
      (await emitAck(guestSocket, 'tetris:lobby:join', {
        lobbyId: created.lobbyId,
        playerId: guest.body.id,
      })).ok,
      true,
    );

    const notReady = await emitAck(hostSocket, 'tetris:lobby:start', {
      lobbyId: created.lobbyId,
      playerId: host.body.id,
    });
    assert.equal(notReady.ok, false);
    assert.match(notReady.error ?? '', /bereit/);
    assert.equal(
      (await emitAck(guestSocket, 'tetris:lobby:ready', {
        lobbyId: created.lobbyId,
        playerId: guest.body.id,
        ready: true,
      })).ok,
      true,
    );

    const startedPromise = waitForEvent<{ matchId: string; beginsAt: number }>(hostSocket, 'tetris:match:start');
    assert.equal(
      (await emitAck(hostSocket, 'tetris:lobby:start', {
        lobbyId: created.lobbyId,
        playerId: host.body.id,
      })).ok,
      true,
    );
    const started = await startedPromise;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, started.beginsAt - Date.now()) + 25));

    const outcome: {
      ended?: {
        winner: { id: string } | null;
        scores: Array<{ playerId: string; placement: number | null; isWinner: boolean }>;
      };
    } = {};
    hostSocket.on('tetris:match:end', (payload) => {
      outcome.ended = payload;
    });
    for (let piece = 0; piece < 50 && !outcome.ended; piece += 1) {
      const statePromise = waitForEvent(hostSocket, 'tetris:state');
      const results = await Promise.all([
        emitAck(hostSocket, 'tetris:input', { matchId: started.matchId, playerId: host.body.id, action: 'hard' }),
        emitAck(guestSocket, 'tetris:input', { matchId: started.matchId, playerId: guest.body.id, action: 'hard' }),
      ]);
      assert.ok(results.every((result) => result.ok));
      await statePromise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.ok(outcome.ended, 'identical hard drops should eventually top out both players');
    assert.equal(outcome.ended.winner, null);
    assert.deepEqual(outcome.ended.scores.map((score) => score.placement), [1, 1]);
    assert.ok(outcome.ended.scores.every((score) => score.isWinner));
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
