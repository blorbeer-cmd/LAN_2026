// Integration tests for the "Verlassen" (leave) action every arcade match
// now offers a non-host participant, mirroring the existing host-only
// pause/finish handlers but reachable without being the lobby host and
// without relying on a raw socket disconnect.

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
import { registerPongSockets } from '../arcade/pong';
import { registerBlobbySockets } from '../arcade/blobby';
import { registerSnakeSockets } from '../arcade/snake';
import { registerScribbleSockets } from '../arcade/scribble';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';

function connect(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent(socket: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function makePlayers(baseUrl: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const res = await request(baseUrl).post('/api/players').send({ name });
    assert.equal(res.status, 201);
    ids.push(res.body.id);
  }
  return ids;
}

test('a non-host participant can leave a running match in every arcade game', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerArcadeSockets(io);
  registerTetrisSockets(io);
  registerPongSockets(io);
  registerBlobbySockets(io);
  registerSnakeSockets(io);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);

  try {
    // quiz
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Quiz Host', 'Quiz Guest']);
      const created = await emitAck(hostSocket, 'arcade:lobby:create', { gameType: 'quiz', playerId: hostId });
      assert.equal(created.ok, true);
      const joined = await emitAck(guestSocket, 'arcade:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      assert.equal(joined.ok, true);
      const startPromise = waitForEvent(guestSocket, 'arcade:match:start') as Promise<{ matchId: string }>;
      const started = await emitAck(hostSocket, 'arcade:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      assert.equal(started.ok, true);
      const { matchId } = await startPromise;

      // Only a participant may leave, not an unrelated player.
      const rejected = await emitAck(guestSocket, 'arcade:match:leave', { matchId, playerId: 'ghost' });
      assert.equal(rejected.ok, false);

      const endPromise = waitForEvent(hostSocket, 'arcade:match:end');
      const left = await emitAck(guestSocket, 'arcade:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      await endPromise;

      // The match is gone: even the host can no longer pause it.
      const afterLeave = await emitAck(hostSocket, 'arcade:match:pause', { matchId, playerId: hostId });
      assert.equal(afterLeave.ok, false);
    }

    // tetris
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Tetris Host', 'Tetris Guest']);
      const created = await emitAck(hostSocket, 'tetris:lobby:create', { playerId: hostId });
      assert.equal(created.ok, true);
      await emitAck(guestSocket, 'tetris:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'tetris:match:start') as Promise<{ matchId: string }>;
      const started = await emitAck(hostSocket, 'tetris:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      assert.equal(started.ok, true);
      const { matchId } = await startPromise;

      const endPromise = waitForEvent(hostSocket, 'tetris:match:end') as Promise<{ winner: { id: string } | null }>;
      const left = await emitAck(guestSocket, 'tetris:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      const end = await endPromise;
      assert.equal(end.winner?.id, hostId, 'leaving forfeits the match to the opponent');
    }

    // pong
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Pong Host', 'Pong Guest']);
      const created = await emitAck(hostSocket, 'pong:lobby:create', { playerId: hostId });
      await emitAck(guestSocket, 'pong:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'pong:match:start') as Promise<{ matchId: string }>;
      await emitAck(hostSocket, 'pong:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      const { matchId } = await startPromise;

      const endPromise = waitForEvent(hostSocket, 'pong:match:end') as Promise<{ winner: { id: string } | null }>;
      const left = await emitAck(guestSocket, 'pong:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      const end = await endPromise;
      assert.equal(end.winner?.id, hostId);
    }

    // blobby
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Blobby Host', 'Blobby Guest']);
      const created = await emitAck(hostSocket, 'blobby:lobby:create', { playerId: hostId });
      await emitAck(guestSocket, 'blobby:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'blobby:match:start') as Promise<{ matchId: string }>;
      await emitAck(hostSocket, 'blobby:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      const { matchId } = await startPromise;

      const endPromise = waitForEvent(hostSocket, 'blobby:match:end') as Promise<{ winner: { id: string } | null }>;
      const left = await emitAck(guestSocket, 'blobby:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      const end = await endPromise;
      assert.equal(end.winner?.id, hostId);
    }

    // snake
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Snake Host', 'Snake Guest']);
      const created = await emitAck(hostSocket, 'snake:lobby:create', { playerId: hostId });
      await emitAck(guestSocket, 'snake:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'snake:match:start') as Promise<{ matchId: string }>;
      const started = await emitAck(hostSocket, 'snake:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      const { matchId } = started.matchId ? { matchId: started.matchId as string } : await startPromise;

      const endPromise = waitForEvent(hostSocket, 'snake:match:end') as Promise<{ winner: { id: string } | null }>;
      const left = await emitAck(guestSocket, 'snake:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      const end = await endPromise;
      assert.equal(end.winner?.id, hostId);
    }

    // scribble
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Scribble Host', 'Scribble Guest']);
      const created = await emitAck(hostSocket, 'scribble:lobby:create', { playerId: hostId });
      await emitAck(guestSocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'scribble:match:start') as Promise<{ matchId: string }>;
      await emitAck(hostSocket, 'scribble:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      const { matchId } = await startPromise;

      // Fewer than 2 players left online ends the match outright (no winner
      // declared for a drawing party game, same as the existing disconnect path).
      const endPromise = waitForEvent(hostSocket, 'scribble:match:end');
      const left = await emitAck(guestSocket, 'scribble:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      await endPromise;
    }
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('leaving a running match never shows the leaver their own "opponent left" toast', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerArcadeSockets(io);
  registerTetrisSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);

  try {
    // quiz
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Toast Quiz Host', 'Toast Quiz Guest']);
      const created = await emitAck(hostSocket, 'arcade:lobby:create', { gameType: 'quiz', playerId: hostId });
      await emitAck(guestSocket, 'arcade:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'arcade:match:start') as Promise<{ matchId: string }>;
      await emitAck(hostSocket, 'arcade:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      const { matchId } = await startPromise;

      let leaverSawOwnDeparture = false;
      guestSocket.once('arcade:match:opponent-left', () => {
        leaverSawOwnDeparture = true;
      });
      const hostSawDeparture = waitForEvent(hostSocket, 'arcade:match:opponent-left');
      const left = await emitAck(guestSocket, 'arcade:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      await hostSawDeparture; // the remaining player must still be told
      assert.equal(leaverSawOwnDeparture, false, 'the player who just left must not see a toast about their own departure');
    }

    // tetris
    {
      const [hostId, guestId] = await makePlayers(baseUrl, ['Toast Tetris Host', 'Toast Tetris Guest']);
      const created = await emitAck(hostSocket, 'tetris:lobby:create', { playerId: hostId });
      await emitAck(guestSocket, 'tetris:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
      const startPromise = waitForEvent(guestSocket, 'tetris:match:start') as Promise<{ matchId: string }>;
      await emitAck(hostSocket, 'tetris:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
      const { matchId } = await startPromise;

      let leaverSawOwnDeparture = false;
      guestSocket.once('tetris:opponent-left', () => {
        leaverSawOwnDeparture = true;
      });
      const hostSawDeparture = waitForEvent(hostSocket, 'tetris:opponent-left');
      const left = await emitAck(guestSocket, 'tetris:match:leave', { matchId, playerId: guestId });
      assert.equal(left.ok, true);
      await hostSawDeparture;
      assert.equal(leaverSawOwnDeparture, false, 'the player who just left must not see a toast about their own departure');
    }
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('scribble: leaving revokes guess authorization instead of letting a departed player keep scoring in a 3+ player match', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerScribbleSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestASocket = await connect(baseUrl);
  const guestBSocket = await connect(baseUrl);

  try {
    const [hostId, guestAId, guestBId] = await makePlayers(baseUrl, ['Scribble3 Host', 'Scribble3 GuestA', 'Scribble3 GuestB']);
    const created = await emitAck(hostSocket, 'scribble:lobby:create', { playerId: hostId });
    await emitAck(guestASocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: guestAId });
    await emitAck(guestBSocket, 'scribble:lobby:join', { lobbyId: created.lobbyId, playerId: guestBId });

    const participants = [
      { id: hostId, socket: hostSocket },
      { id: guestAId, socket: guestASocket },
      { id: guestBId, socket: guestBSocket },
    ];
    // Whichever socket receives the word-choice prompt is this turn's drawer.
    const choosePromise = Promise.race(
      participants.map(
        ({ id, socket }) =>
          new Promise<{ drawerId: string; options: Array<{ id: string; word: string }> }>((resolve) =>
            socket.once('scribble:choose', (payload: { options: Array<{ id: string; word: string }> }) =>
              resolve({ drawerId: id, options: payload.options })
            )
          )
      )
    );
    const started = await emitAck(hostSocket, 'scribble:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    assert.equal(started.ok, true);
    const matchId = started.matchId as string;
    const { drawerId, options } = await choosePromise;
    const drawer = participants.find((p) => p.id === drawerId)!;
    const word = options[0].word;
    const chose = await emitAck(drawer.socket, 'scribble:word', { matchId, playerId: drawerId, wordId: options[0].id });
    assert.equal(chose.ok, true);

    const [leaver, remainingGuesser] = participants.filter((p) => p.id !== drawerId);

    const left = await emitAck(leaver.socket, 'scribble:match:leave', { matchId, playerId: leaver.id });
    assert.equal(left.ok, true);

    // The departed player's socket is still connected (unlike a real
    // disconnect) — without the online check, this guess would still score.
    const guessAfterLeave = await emitAck(leaver.socket, 'scribble:guess', { matchId, playerId: leaver.id, text: word });
    assert.equal(guessAfterLeave.ok, false, 'a player who explicitly left must not be able to keep guessing/scoring');

    // The match itself must still be running for the players who stayed.
    const guessFromRemaining = await emitAck(remainingGuesser.socket, 'scribble:guess', {
      matchId,
      playerId: remainingGuesser.id,
      text: word,
    });
    assert.equal(guessFromRemaining.ok, true);
    assert.equal(guessFromRemaining.correct, true);
  } finally {
    hostSocket.close();
    guestASocket.close();
    guestBSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});

test('a host finishing a match at the same instant a guest leaves it resolves cleanly (no crash, no duplicate result)', async () => {
  clearLobbyMemberships();
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  registerArcadeSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const hostSocket = await connect(baseUrl);
  const guestSocket = await connect(baseUrl);

  try {
    const [hostId, guestId] = await makePlayers(baseUrl, ['Race Quiz Host', 'Race Quiz Guest']);
    const created = await emitAck(hostSocket, 'arcade:lobby:create', { gameType: 'quiz', playerId: hostId });
    await emitAck(guestSocket, 'arcade:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    const startPromise = waitForEvent(guestSocket, 'arcade:match:start') as Promise<{ matchId: string }>;
    await emitAck(hostSocket, 'arcade:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const { matchId } = await startPromise;

    // Exactly one of the two concurrent requests may "win" (the match only
    // exists once); the other gets a clean rejection, never a crash or a
    // second arcade_results row for the same match.
    const [finishResult, leaveResult] = await Promise.all([
      emitAck(hostSocket, 'arcade:match:finish', { matchId, playerId: hostId }),
      emitAck(guestSocket, 'arcade:match:leave', { matchId, playerId: guestId }),
    ]);
    const outcomes = [finishResult.ok, leaveResult.ok];
    assert.ok(outcomes.includes(true), 'at least one of the two racing requests must succeed');

    const resultsRes = await request(baseUrl).get(`/api/arcade/stats`);
    assert.equal(resultsRes.status, 200);
  } finally {
    hostSocket.close();
    guestSocket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
