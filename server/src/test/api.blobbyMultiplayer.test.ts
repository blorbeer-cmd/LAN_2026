import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { registerBlobbySockets } from '../arcade/blobby';
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

test('Blobby Doppel requires two full ready teams and awards the whole winning team', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerBlobbySockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const sockets = await Promise.all(Array.from({ length: 5 }, () => connect(baseUrl)));

  try {
    const playerIds: string[] = [];
    for (const name of ['Blau Host', 'Blau Zwei', 'Pink Eins', 'Pink Zwei', 'Zu Viel']) {
      const response = await request(baseUrl).post('/api/players').send({ name });
      assert.equal(response.status, 201);
      playerIds.push(response.body.id);
    }
    const [hostId, blueId, pinkAId, pinkBId, extraId] = playerIds;

    const created = await emitAck(sockets[0], 'blobby:lobby:create', { playerId: hostId, mode: 'doubles' });
    assert.equal(created.ok, true);
    const lobbyId = created.lobbyId as string;

    assert.equal((await emitAck(sockets[1], 'blobby:lobby:join', { lobbyId, playerId: blueId, team: 'left' })).ok, true);
    assert.equal((await emitAck(sockets[2], 'blobby:lobby:join', { lobbyId, playerId: pinkAId, team: 'right' })).ok, true);

    const earlyStart = await emitAck(sockets[0], 'blobby:lobby:start', { lobbyId, playerId: hostId });
    assert.equal(earlyStart.ok, false);

    assert.equal((await emitAck(sockets[3], 'blobby:lobby:join', { lobbyId, playerId: pinkBId, team: 'right' })).ok, true);
    const full = await emitAck(sockets[4], 'blobby:lobby:join', { lobbyId, playerId: extraId, team: 'auto' });
    assert.equal(full.ok, false);
    assert.equal((await emitAck(sockets[4], 'blobby:lobby:ready', { lobbyId, playerId: blueId, ready: true })).ok, false);
    assert.equal((await emitAck(sockets[1], 'blobby:lobby:ready', { lobbyId, playerId: pinkAId, ready: true })).ok, false);
    assert.equal((await emitAck(sockets[4], 'blobby:lobby:leave', { lobbyId, playerId: blueId })).ok, false);

    for (const [socket, playerId] of [
      [sockets[1], blueId],
      [sockets[2], pinkAId],
      [sockets[3], pinkBId],
    ] as const) {
      assert.equal((await emitAck(socket, 'blobby:lobby:ready', { lobbyId, playerId, ready: true })).ok, true);
    }

    const matchStarted = waitForEvent<{
      matchId: string;
      mode: string;
      beginsAt: number;
      players: Array<{ id: string; team: string }>;
    }>(sockets[1], 'blobby:match:start');
    assert.equal((await emitAck(sockets[4], 'blobby:lobby:start', { lobbyId, playerId: hostId, targetScore: 7 })).ok, false);
    const started = await emitAck(sockets[0], 'blobby:lobby:start', { lobbyId, playerId: hostId, targetScore: 7 });
    assert.equal(started.ok, true);
    const match = await matchStarted;
    assert.equal(match.mode, 'doubles');
    assert.deepEqual(match.players.map((player) => player.team), ['left', 'left', 'right', 'right']);

    assert.equal((await emitAck(sockets[1], 'blobby:match:pause', { matchId: match.matchId, playerId: hostId })).ok, false);
    assert.equal((await emitAck(sockets[4], 'blobby:match:finish', { matchId: match.matchId, playerId: hostId })).ok, false);
    assert.equal((await emitAck(sockets[4], 'blobby:match:leave', { matchId: match.matchId, playerId: pinkAId })).ok, false);

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, match.beginsAt - Date.now() + 20)));
    assert.equal((await emitAck(sockets[1], 'blobby:input', {
      matchId: match.matchId,
      playerId: pinkAId,
      input: { left: true },
    })).ok, false);
    assert.equal((await emitAck(sockets[1], 'blobby:input', {
      matchId: match.matchId,
      playerId: blueId,
      input: { left: true },
    })).ok, true);

    const ended = waitForEvent<{
      winnerTeam: string;
      winners: Array<{ id: string }>;
      scores: Array<{ playerId: string; isWinner: boolean }>;
    }>(sockets[0], 'blobby:match:end');
    assert.equal((await emitAck(sockets[2], 'blobby:match:leave', { matchId: match.matchId, playerId: pinkAId })).ok, true);
    const result = await ended;
    assert.equal(result.winnerTeam, 'left');
    assert.deepEqual(new Set(result.winners.map((winner) => winner.id)), new Set([hostId, blueId]));
    assert.equal(result.scores.filter((score) => score.isWinner).length, 2);
    sockets[2].close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const persisted = db.prepare(
      `SELECT COUNT(DISTINCT result_id) AS resultCount,
              SUM(CASE WHEN is_winner = 1 THEN 1 ELSE 0 END) AS winnerCount
       FROM arcade_result_participants
       WHERE participant_key IN (?, ?, ?, ?)`
    ).get(hostId, blueId, pinkAId, pinkBId) as { resultCount: number; winnerCount: number };
    assert.equal(persisted.resultCount, 1, 'leave followed by disconnect must persist exactly one result');
    assert.equal(persisted.winnerCount, 2);
  } finally {
    for (const socket of sockets) socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('Blobby AI doubles quick start creates one human with three ready bots', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerBlobbySockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const socket = await connect(baseUrl);

  try {
    const response = await request(baseUrl).post('/api/players').send({ name: 'Blobby KI Doppel Host' });
    assert.equal(response.status, 201);
    const hostId = response.body.id as string;
    const denied = await emitAck(socket, 'blobby:lobby:bot', { playerId: hostId, mode: 'doubles' });
    assert.equal(denied.ok, false);
    assert.match(denied.error ?? '', /nur für Admins/);

    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(hostId);
    const lobbiesPromise = waitForEvent<{ lobbies: Array<{ id: string; mode: string; players: Array<{ id: string; team: string; ready: boolean }> }> }>(socket, 'blobby:lobbies');
    const created = await emitAck(socket, 'blobby:lobby:bot', { playerId: hostId, mode: 'doubles' });
    assert.equal(created.ok, true);
    const lobby = (await lobbiesPromise).lobbies.find((entry) => entry.id === created.lobbyId);
    assert.ok(lobby);
    assert.equal(lobby.mode, 'doubles');
    assert.deepEqual(lobby.players.map((player) => player.team), ['left', 'left', 'right', 'right']);
    assert.equal(lobby.players.filter((player) => player.id.startsWith('blobby-bot-') && player.ready).length, 3);

    const startedPromise = waitForEvent<{ matchId: string; players: Array<{ id: string; team: string }> }>(socket, 'blobby:match:start');
    const statePromise = waitForEvent<{ scores: Array<{ playerId: string; isBot: boolean }> }>(socket, 'blobby:state');
    assert.equal((await emitAck(socket, 'blobby:lobby:start', { lobbyId: created.lobbyId, playerId: hostId })).ok, true);
    const started = await startedPromise;
    assert.deepEqual(started.players.map((player) => player.team), ['left', 'left', 'right', 'right']);
    const state = await statePromise;
    assert.equal(state.scores.filter((score) => score.isBot).length, 3);

    const endedPromise = waitForEvent<{ scores: Array<{ playerId: string; isBot: boolean }> }>(socket, 'blobby:match:end');
    assert.equal((await emitAck(socket, 'blobby:match:finish', { matchId: started.matchId, playerId: hostId })).ok, true);
    assert.equal((await endedPromise).scores.filter((score) => score.isBot).length, 3);
  } finally {
    socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
