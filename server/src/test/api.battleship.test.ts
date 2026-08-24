import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, installTestSocketIdentity } from './testApp';
import { DEFAULT_GROUP_ID } from '../db';
import { registerBattleshipSockets } from '../arcade/battleship';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';

function connect(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<{ ok: boolean; [key: string]: unknown }> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function waitForStatePhase(socket: ClientSocket, phase: string): Promise<{ phase: string; currentPlayerId?: string }> {
  return new Promise((resolve) => {
    const onState = (payload: { phase?: string }) => {
      if (payload.phase === phase) resolve(payload as { phase: string; currentPlayerId?: string });
      else socket.once('battleship:state', onState);
    };
    socket.once('battleship:state', onState);
  });
}

function waitForState(
  socket: ClientSocket,
  predicate: (payload: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('battleship:state', onState);
      reject(new Error('Timed out waiting for Battleship state.'));
    }, 8000);
    const onState = (payload: Record<string, unknown>) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off('battleship:state', onState);
      resolve(payload);
    };
    socket.on('battleship:state', onState);
  });
}

const placements = [
  { shipId: 'carrier', row: 0, col: 0, orientation: 'horizontal' },
  { shipId: 'battleship', row: 2, col: 0, orientation: 'horizontal' },
  { shipId: 'cruiser', row: 4, col: 0, orientation: 'horizontal' },
  { shipId: 'submarine', row: 6, col: 0, orientation: 'horizontal' },
  { shipId: 'destroyer', row: 8, col: 0, orientation: 'horizontal' },
];

test('Battleship enforces the duel lobby gate and validates placement before firing', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerBattleshipSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);
  try {
    const host = (await request(baseUrl).post('/api/players').send({ name: 'Battleship Host' })).body.id as string;
    const guest = (await request(baseUrl).post('/api/players').send({ name: 'Battleship Guest' })).body.id as string;
    const created = await emitAck(hostSocket, 'battleship:lobby:create', { playerId: host, mode: 'duel' });
    assert.equal(created.ok, true);
    const notReady = await emitAck(hostSocket, 'battleship:lobby:start', { lobbyId: created.lobbyId, playerId: host });
    assert.equal(notReady.ok, false);
    assert.match(String(notReady.error), /genau 2/);
    assert.equal((await emitAck(guestSocket, 'battleship:lobby:join', { lobbyId: created.lobbyId, playerId: guest })).ok, true);
    assert.equal((await emitAck(hostSocket, 'battleship:lobby:start', { lobbyId: created.lobbyId, playerId: host })).ok, false);
    assert.equal((await emitAck(guestSocket, 'battleship:lobby:ready', { lobbyId: created.lobbyId, playerId: guest, ready: true })).ok, true);

    const start = waitForEvent<{ matchId: string }>(guestSocket, 'battleship:match:start');
    const starts = await Promise.all([
      emitAck(hostSocket, 'battleship:lobby:start', { lobbyId: created.lobbyId, playerId: host }),
      emitAck(hostSocket, 'battleship:lobby:start', { lobbyId: created.lobbyId, playerId: host }),
    ]);
    assert.equal(starts.filter((result) => result.ok).length, 1);
    const { matchId } = await start;
    assert.equal((await emitAck(hostSocket, 'battleship:match:pause', { matchId, playerId: host })).ok, false);

    assert.equal((await emitAck(hostSocket, 'battleship:setup:submit', { matchId, playerId: host, placements: [{ ...placements[0], col: 9 }, ...placements.slice(1)] })).ok, false);
    const countdown = waitForStatePhase(hostSocket, 'countdown');
    const playing = waitForStatePhase(guestSocket, 'playing');
    assert.equal((await emitAck(hostSocket, 'battleship:setup:submit', { matchId, playerId: host, placements })).ok, true);
    const overwrite = await emitAck(hostSocket, 'battleship:setup:submit', { matchId, playerId: host, placements: placements.map((placement) => ({ ...placement, row: placement.row + 1 })) });
    assert.equal(overwrite.ok, false);
    assert.match(String(overwrite.error), /bereits bestätigt/);
    assert.equal((await emitAck(guestSocket, 'battleship:setup:submit', { matchId, playerId: guest, placements })).ok, true);
    assert.equal((await countdown).phase, 'countdown');
    const playingState = await playing;
    const currentId = playingState.currentPlayerId as string;
    const currentSocket = currentId === host ? hostSocket : guestSocket;
    const duplicateShots = await Promise.all([
      emitAck(currentSocket, 'battleship:shot:fire', { matchId, playerId: currentId, row: 9, col: 9 }),
      emitAck(currentSocket, 'battleship:shot:fire', { matchId, playerId: currentId, row: 9, col: 9 }),
    ]);
    assert.equal(duplicateShots.filter((result) => result.ok).length, 1);
    assert.equal((await emitAck(guestSocket, 'battleship:match:pause', { matchId, playerId: guest })).ok, false);
    assert.equal((await emitAck(hostSocket, 'battleship:match:pause', { matchId, playerId: host })).ok, true);
    assert.equal((await emitAck(hostSocket, 'battleship:match:resume', { matchId, playerId: host })).ok, true);
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('Battleship restricts AI matches to admins and lets the bot place and fire', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  registerBattleshipSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const hostSocket = await connect(baseUrl);
  try {
    const createdPlayer = await request(baseUrl).post('/api/players').send({ name: 'Battleship AI Admin' });
    const host = createdPlayer.body.id as string;
    const denied = await emitAck(hostSocket, 'battleship:lobby:bot', { playerId: host });
    assert.equal(denied.ok, false);
    assert.match(String(denied.error), /nur für Admins/);

    await request(baseUrl)
      .patch(`/api/groups/${DEFAULT_GROUP_ID}/members/${host}`)
      .send({ role: 'admin' })
      .expect(200);
    const created = await emitAck(hostSocket, 'battleship:lobby:bot', { playerId: host });
    assert.equal(created.ok, true);

    const started = waitForEvent<{ matchId: string }>(hostSocket, 'battleship:match:start');
    assert.equal((await emitAck(hostSocket, 'battleship:lobby:start', { lobbyId: created.lobbyId, playerId: host })).ok, true);
    const { matchId } = await started;
    const playing = waitForStatePhase(hostSocket, 'playing');
    const botShot = waitForState(hostSocket, (state) => {
      const lastShot = state.lastShot as { playerId?: string } | undefined;
      return lastShot?.playerId === 'battleship-bot';
    });
    assert.equal((await emitAck(hostSocket, 'battleship:setup:submit', { matchId, playerId: host, placements })).ok, true);
    const playingState = await playing;
    if (playingState.currentPlayerId === host) {
      assert.equal((await emitAck(hostSocket, 'battleship:shot:fire', { matchId, playerId: host, row: 9, col: 9 })).ok, true);
    }
    const stateAfterBotShot = await botShot;
    assert.equal(stateAfterBotShot.currentPlayerId, host);
    const players = stateAfterBotShot.players as Array<{ id: string; placementReady: boolean }>;
    assert.equal(players.find((player) => player.id === 'battleship-bot')?.placementReady, true);
  } finally {
    hostSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
