import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';
import { registerArcadeSockets } from '../arcade/arcade';
import { registerTetrisSockets } from '../arcade/tetris';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { clearLobbyPushThrottle } from '../arcade/lobbyPush';

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

test('rapid-fire lobby creation keeps exactly one lobby and throttles the join push', async () => {
  clearLobbyMemberships();
  clearLobbyPushThrottle();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerArcadeSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const client = await connect(baseUrl);

  try {
    const host = await request(baseUrl).post('/api/players').send({ name: 'Spam Host' });
    assert.equal(host.status, 201);
    // The lobby push goes to "everyone else" — one recipient is enough for a
    // push_log row to be written per un-throttled create.
    const other = await request(baseUrl).post('/api/players').send({ name: 'Spam Bystander' });
    assert.equal(other.status, 201);

    // Ten parallel create clicks: exactly one may win, the rest get a clean
    // rejection instead of duplicating lobbies or overwriting state.
    const bursts = await Promise.all(
      Array.from({ length: 10 }, () => emitAck(client, 'arcade:lobby:create', { gameType: 'quiz', playerId: host.body.id }))
    );
    assert.equal(bursts.filter((result) => result.ok).length, 1, 'exactly one create wins the burst');
    for (const loser of bursts.filter((result) => !result.ok)) {
      assert.match(loser.error ?? '', /bereits in einer anderen Arcade-Lobby/);
    }
    const lobbies = await request(baseUrl).get('/api/arcade/lobbies');
    assert.equal(lobbies.status, 200);
    assert.equal(lobbies.body.lobbies.length, 1, 'the burst must leave exactly one open lobby');

    // Close-and-recreate spam: memberships stay consistent (create keeps
    // working) but the "jetzt beitreten" push fires only once within the
    // cooldown — otherwise every phone on the LAN buzzes per click.
    const winner = bursts.find((result) => result.ok) as { ok: boolean; lobbyId?: string } | undefined;
    assert.ok(winner?.lobbyId, 'the winning create must return its lobby id');
    let currentLobbyId: string | undefined = winner.lobbyId;
    for (let i = 0; i < 4; i += 1) {
      const closed = await emitAck(client, 'arcade:lobby:close', { lobbyId: currentLobbyId, playerId: host.body.id });
      assert.equal(closed.ok, true);
      const created = (await emitAck(client, 'arcade:lobby:create', { gameType: 'quiz', playerId: host.body.id })) as {
        ok: boolean;
        lobbyId?: string;
      };
      assert.equal(created.ok, true, 'recreate after close must keep working');
      currentLobbyId = created.lobbyId;
    }
    const pushRows = db
      .prepare("SELECT COUNT(*) AS count FROM push_log WHERE title LIKE '%Quiz-Lobby%'")
      .get() as { count: number };
    assert.equal(pushRows.count, 1, 'lobby-create pushes must be throttled to one per cooldown window');
  } finally {
    client.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
    clearLobbyPushThrottle();
  }
});
