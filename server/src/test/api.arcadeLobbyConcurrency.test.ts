import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { registerArcadeSockets } from '../arcade/arcade';
import { registerTetrisSockets } from '../arcade/tetris';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';

function connect(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test('parallel Arcade lobby creation allows exactly one lobby per player', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerArcadeSockets(io);
  registerTetrisSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const quizClient = await connect(baseUrl);
  const tetrisClient = await connect(baseUrl);

  try {
    const player = await request(baseUrl).post('/api/players').send({ name: 'Lobby Race Player' });
    assert.equal(player.status, 201);

    const results = await Promise.all([
      emitAck(quizClient, 'arcade:lobby:create', { gameType: 'quiz', playerId: player.body.id }),
      emitAck(tetrisClient, 'tetris:lobby:create', { playerId: player.body.id }),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.match(results.find((result) => !result.ok)?.error ?? '', /bereits in einer anderen Arcade-Lobby/);
  } finally {
    quizClient.close();
    tetrisClient.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
