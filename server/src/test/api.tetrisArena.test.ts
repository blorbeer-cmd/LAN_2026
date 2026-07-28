import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { registerTetrisSockets } from '../arcade/tetris';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { db } from '../db';

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
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
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

    const created = await emitAck(sockets[0], 'tetris:lobby:create', { playerId: hostId, mode: 'arena' });
    assert.equal(created.ok, true);
    const lobbyId = created.lobbyId as string;
    assert.equal((await emitAck(sockets[1], 'tetris:lobby:join', { lobbyId, playerId: secondId })).ok, true);

    const tooEarly = await emitAck(sockets[0], 'tetris:lobby:start', { lobbyId, playerId: hostId });
    assert.equal(tooEarly.ok, false);
    assert.match(tooEarly.error ?? '', /3 bis 8/);

    assert.equal((await emitAck(sockets[2], 'tetris:lobby:join', { lobbyId, playerId: thirdId })).ok, true);
    assert.equal((await emitAck(sockets[3], 'tetris:lobby:join', { lobbyId, playerId: fourthId })).ok, true);

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
