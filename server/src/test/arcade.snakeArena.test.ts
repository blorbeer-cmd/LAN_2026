import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { registerSnakeSockets } from '../arcade/snake';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';

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

test('Snake Arena validates its mode and supports lobbies with three to eight players', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
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
