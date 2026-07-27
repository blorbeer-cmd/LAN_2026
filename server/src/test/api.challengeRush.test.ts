import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { registerChallengeRushSockets } from '../arcade/challengeRush';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';

process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS = '100';

type Ack = { ok: boolean; error?: string; [key: string]: unknown };
type State = { matchId: string; phase: string; challengeIndex: number; challenge: { key: string; data: Record<string, unknown> }; scores: Array<{ playerId: string; connected: boolean; forfeited: boolean }>; history: Array<{ key: string; title: string; scores: Array<{ playerId: string; name: string; score: number }> }>; readyNext: string[] };

function connect(baseUrl: string, playerId?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false, auth: playerId ? { playerId } : undefined });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function nextEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function nextState(socket: ClientSocket, predicate: (state: State) => boolean): Promise<State> {
  return new Promise((resolve) => {
    const onState = (state: State) => { if (predicate(state)) resolve(state); else socket.once('challenge-rush:state', onState); };
    socket.once('challenge-rush:state', onState);
  });
}

function makeServer(authenticatedSockets = false): Promise<{ httpServer: http.Server; io: Server; baseUrl: string }> {
  const httpServer = http.createServer(createApp());
  const io = new Server(httpServer);
  if (authenticatedSockets) io.use((socket, next) => { socket.data.authPlayerId = socket.handshake.auth.playerId; next(); });
  registerChallengeRushSockets(io);
  return new Promise((resolve) => httpServer.listen(0, () => resolve({ httpServer, io, baseUrl: `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}` })));
}

async function player(baseUrl: string, name: string): Promise<string> {
  const response = await request(baseUrl).post('/api/players').send({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  assert.equal(response.status, 201);
  return response.body.id as string;
}

test('Challenge Rush keeps a lobby when a guest disconnects', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    assert.equal(created.ok, true);
    assert.equal((await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId })).ok, true);
    const lobbies = nextEvent<{ lobbies: Array<{ id: string; players: Array<{ id: string }> }> }>(hostSocket, 'challenge-rush:lobbies');
    guestSocket.close();
    const update = await lobbies;
    const lobby = update.lobbies.find((entry) => entry.id === created.lobbyId);
    assert.deepEqual(lobby?.players.map((entry) => entry.id), [hostId]);
  } finally {
    hostSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush reconnects within grace and forfeits after grace while the match continues', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Match Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Match Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    assert.equal((await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId })).ok, true);
    const match = await started;
    const playing = nextState(hostSocket, (state) => state.phase === 'playing');
    const initialState = await playing;
    assert.equal(initialState.matchId, match.matchId);

    const reconnectState = nextEvent<State>(hostSocket, 'challenge-rush:state');
    guestSocket.close();
    const disconnected = await reconnectState;
    assert.equal(disconnected.scores.find((score) => score.playerId === guestId)?.connected, false);

    const replacement = ioClient(server.baseUrl, { transports: ['websocket'], reconnection: false, auth: { playerId: guestId } });
    const reconnectStartPromise = nextEvent<{ matchId: string; reconnected?: boolean }>(replacement, 'challenge-rush:match:start');
    await new Promise<void>((resolve, reject) => { replacement.once('connect', () => resolve()); replacement.once('connect_error', reject); });
    const disconnectedAgain = nextEvent<State>(hostSocket, 'challenge-rush:state');
    try {
      const reconnectStart = await reconnectStartPromise;
      assert.equal(reconnectStart.matchId, match.matchId);
      assert.equal(reconnectStart.reconnected, true);
    } finally { replacement.close(); }

    await disconnectedAgain;
    const forfeitedState = nextEvent<State>(hostSocket, 'challenge-rush:state');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const state = await forfeitedState;
    assert.equal(state.scores.find((score) => score.playerId === guestId)?.forfeited, true);
    assert.equal(state.scores.find((score) => score.playerId === hostId)?.forfeited, false);
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush serializes parallel last inputs and completes a player once', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Race');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;
    const statePromise = nextState(socket, (candidate) => candidate.phase === 'playing');
    const state = await statePromise;
    const target = state.challenge.data;
    const payload = { matchId: match.matchId, playerId, challengeIndex: state.challengeIndex, action: 'hit', value: { x: Number(target.x), y: Number(target.y) } };
    const results = await Promise.all([emitAck(socket, 'challenge-rush:challenge:input', payload), emitAck(socket, 'challenge-rush:challenge:input', payload)]);
    assert.equal(results.filter((result) => result.accepted === true).length, 1);
    assert.equal(results.filter((result) => result.accepted !== true).length, 1);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

async function completeReactionCircle(socket: ClientSocket, matchId: string, playerId: string, challengeIndex: number, target: Record<string, unknown>): Promise<void> {
  await emitAck(socket, 'challenge-rush:challenge:input', { matchId, playerId, challengeIndex, action: 'hit', value: { x: Number(target.x), y: Number(target.y) } });
}

test('Challenge Rush only advances past a result once every connected player is ready, and records per-challenge history', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Ready Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Ready Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;

    const playing = await nextState(hostSocket, (state) => state.phase === 'playing');
    const target = playing.challenge.data;
    const resultPromise = nextState(hostSocket, (state) => state.phase === 'result');
    await completeReactionCircle(hostSocket, match.matchId, hostId, playing.challengeIndex, target);
    await completeReactionCircle(guestSocket, match.matchId, guestId, playing.challengeIndex, target);
    const result = await resultPromise;
    assert.equal(result.challengeIndex, 0);

    const afterOneReady = nextEvent<State>(hostSocket, 'challenge-rush:state');
    assert.equal((await emitAck(guestSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: guestId })).ok, true);
    const stillWaiting = await afterOneReady;
    assert.equal(stillWaiting.phase, 'result');
    assert.equal(stillWaiting.challengeIndex, 0);

    const advanced = nextState(hostSocket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    assert.equal((await emitAck(hostSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: hostId })).ok, true);
    const finalState = await advanced;
    assert.equal(finalState.history.length, 1);
    assert.equal(finalState.history[0].key, 'reaction-circle');
    assert.deepEqual(finalState.history[0].scores.map((s) => s.playerId).sort(), [guestId, hostId].sort());
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush advances past a result on a reliability timeout even without a ready click', async () => {
  clearLobbyMemberships();
  process.env.CHALLENGE_RUSH_RESULT_TIMEOUT_MS = '80';
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Timeout');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;
    const playing = await nextState(socket, (state) => state.phase === 'playing');
    const advanced = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    await completeReactionCircle(socket, match.matchId, playerId, playing.challengeIndex, playing.challenge.data);
    await advanced;
  } finally {
    delete process.env.CHALLENGE_RUSH_RESULT_TIMEOUT_MS;
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush lets a player leave without ending the match for the others', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Leave Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Leave Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;
    const playing = await nextState(hostSocket, (state) => state.phase === 'playing');

    const afterLeave = nextEvent<State>(hostSocket, 'challenge-rush:state');
    assert.equal((await emitAck(guestSocket, 'challenge-rush:match:leave', { matchId: match.matchId, playerId: guestId })).ok, true);
    const leftState = await afterLeave;
    assert.equal(leftState.phase, 'playing');
    assert.equal(leftState.scores.find((s) => s.playerId === guestId)?.forfeited, true);
    assert.equal(leftState.scores.find((s) => s.playerId === hostId)?.forfeited, false);

    const resultPromise = nextState(hostSocket, (state) => state.phase === 'result');
    await completeReactionCircle(hostSocket, match.matchId, hostId, playing.challengeIndex, playing.challenge.data);
    await resultPromise;

    const advanced = nextState(hostSocket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    assert.equal((await emitAck(hostSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: hostId })).ok, true);
    await advanced;
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush lets only the host end the match for everyone', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Finish Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Finish Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;
    await nextState(hostSocket, (state) => state.phase === 'playing');

    const denied = await emitAck(guestSocket, 'challenge-rush:match:finish', { matchId: match.matchId, playerId: guestId });
    assert.equal(denied.ok, false);

    const ended = nextEvent<{ matchId: string; winnerId: string | null; history: unknown[] }>(hostSocket, 'challenge-rush:match:end');
    assert.equal((await emitAck(hostSocket, 'challenge-rush:match:finish', { matchId: match.matchId, playerId: hostId })).ok, true);
    const endedState = await ended;
    assert.equal(endedState.matchId, match.matchId);
    assert.equal(endedState.winnerId, null);
    assert.ok(Array.isArray(endedState.history));
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});
