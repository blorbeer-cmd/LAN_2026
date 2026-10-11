// Every Arcade game keeps a dropped player's seat for the shared reconnect
// grace (shortened by the fast test timers): a new socket of the same player
// takes the match back, while a player who stays away loses it exactly like
// an explicit leave. Tetris, whose pause rules are covered in
// api.tetrisArena.test.ts, and the games with their own reconnect suites
// (Chimp, Challenge Rush, Scribble) are not repeated here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, installTestSocketIdentity } from './testApp';
import { registerArcadeSockets } from '../arcade/arcade';
import { registerPongSockets } from '../arcade/pong';
import { registerBlobbySockets } from '../arcade/blobby';
import { registerSnakeSockets } from '../arcade/snake';
import { registerBattleshipSockets } from '../arcade/battleship';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';

type Ack = { ok: boolean; error?: string; [key: string]: unknown };
type EndPayload = { reason?: string; winner?: { id: string } | null; winnerId?: string | null };

function connect(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

interface GameCase {
  name: string;
  create: [string, Record<string, unknown>];
  prefix: string;
  ready: boolean;
  // Freezes the game so the grace, not the game itself, decides the outcome.
  pause: string | null;
  reconnect: string;
  // The snapshot a reclaimed socket receives right away.
  state: string | null;
  winnerOf: (end: EndPayload) => string | null;
}

const games: GameCase[] = [
  { name: 'quiz', create: ['arcade:lobby:create', { gameType: 'quiz' }], prefix: 'arcade', ready: false, pause: null, reconnect: 'arcade:match:reconnect', state: null, winnerOf: (end) => end.winner?.id ?? null },
  { name: 'pong', create: ['pong:lobby:create', {}], prefix: 'pong', ready: true, pause: 'pong:match:pause', reconnect: 'pong:match:reconnect', state: 'pong:state', winnerOf: (end) => end.winner?.id ?? null },
  { name: 'blobby', create: ['blobby:lobby:create', {}], prefix: 'blobby', ready: true, pause: 'blobby:match:pause', reconnect: 'blobby:match:reconnect', state: 'blobby:state', winnerOf: (end) => end.winner?.id ?? null },
  { name: 'snake', create: ['snake:lobby:create', {}], prefix: 'snake', ready: false, pause: 'snake:match:pause', reconnect: 'snake:match:reconnect', state: 'snake:state', winnerOf: (end) => end.winner?.id ?? null },
  { name: 'battleship', create: ['battleship:lobby:create', { mode: 'duel' }], prefix: 'battleship', ready: true, pause: null, reconnect: 'battleship:match:reconnect', state: 'battleship:state', winnerOf: (end) => end.winnerId ?? null },
];

test('every arcade game hands a dropped seat back to a new socket and forfeits it after the grace', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerArcadeSockets(io);
  registerPongSockets(io);
  registerBlobbySockets(io);
  registerSnakeSockets(io);
  registerBattleshipSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const sockets: ClientSocket[] = [];
  const open = async () => {
    const socket = await connect(baseUrl);
    sockets.push(socket);
    return socket;
  };

  try {
    for (const game of games) {
      const hostId = (await request(baseUrl).post('/api/players').send({ name: `${game.name} Reconnect Host` })).body.id as string;
      const guestId = (await request(baseUrl).post('/api/players').send({ name: `${game.name} Reconnect Gast` })).body.id as string;
      const hostSocket = await open();
      const guestSocket = await open();

      const created = await emitAck(hostSocket, game.create[0], { ...game.create[1], playerId: hostId });
      assert.equal(created.ok, true, game.name);
      const lobbyId = created.lobbyId;
      assert.equal((await emitAck(guestSocket, `${game.prefix}:lobby:join`, { lobbyId, playerId: guestId })).ok, true, game.name);
      if (game.ready) {
        assert.equal((await emitAck(guestSocket, `${game.prefix}:lobby:ready`, { lobbyId, playerId: guestId, ready: true })).ok, true, game.name);
      }
      const started = waitForEvent<{ matchId: string }>(guestSocket, `${game.prefix}:match:start`);
      assert.equal((await emitAck(hostSocket, `${game.prefix}:lobby:start`, { lobbyId, playerId: hostId })).ok, true, game.name);
      const { matchId } = await started;
      if (game.pause) assert.equal((await emitAck(hostSocket, game.pause, { matchId, playerId: hostId })).ok, true, game.name);

      // The guest's phone drops its connection and comes back on a new socket.
      guestSocket.close();
      const returned = await open();
      const resynced = game.state ? waitForEvent<{ matchId: string }>(returned, game.state) : null;
      assert.equal((await emitAck(returned, game.reconnect, { matchId, playerId: guestId })).ok, true, game.name);
      if (resynced) assert.equal((await resynced).matchId, matchId, game.name);

      // Away for longer than the grace: the connected host wins, and a late
      // reconnect cannot resurrect the match.
      const ended = waitForEvent<EndPayload>(hostSocket, `${game.prefix}:match:end`);
      returned.close();
      const end = await ended;
      assert.equal(end.reason, 'player-left', game.name);
      if (game.name !== 'quiz') assert.equal(game.winnerOf(end), hostId, game.name);
      const late = await open();
      assert.equal((await emitAck(late, game.reconnect, { matchId, playerId: guestId })).ok, false, game.name);
    }
  } finally {
    for (const socket of sockets) socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
