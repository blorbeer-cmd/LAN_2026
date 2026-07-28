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
type State = { matchId: string; phase: string; challengeIndex: number; challenge: { key: string; data: Record<string, unknown> }; scores: Array<{ playerId: string; connected: boolean; forfeited: boolean }>; };

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
    const started = nextEvent<{ matchId: string; challengeCount: number }>(hostSocket, 'challenge-rush:match:start');
    assert.equal((await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId })).ok, true);
    const match = await started;
    assert.equal(match.challengeCount, 40);
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

test('Challenge Rush rejects stale trial ids without ending the repeated challenge', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Trial Guard');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    const trialEvent = nextEvent<{ matchId: string; challengeIndex: number; trial: { trialId: string; data: Record<string, unknown> } }>(socket, 'challenge-rush:trial');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const [match, trial] = await Promise.all([started, trialEvent]);
    const target = trial.trial.data;
    const result = await emitAck(socket, 'challenge-rush:challenge:input', {
      matchId: match.matchId,
      playerId,
      challengeIndex: trial.challengeIndex,
      trialId: 'stale-trial-id',
      action: 'hit',
      value: { x: Number(target.x), y: Number(target.y) },
    });
    assert.equal(result.ignored, true);
    assert.equal(result.reason, 'stale-trial');
    assert.equal((result.trial as { trialId?: string } | undefined)?.trialId, trial.trial.trialId);
    const accepted = await emitAck(socket, 'challenge-rush:challenge:input', {
      matchId: match.matchId,
      playerId,
      challengeIndex: trial.challengeIndex,
      trialId: trial.trial.trialId,
      action: 'hit',
      value: { x: Number(target.x), y: Number(target.y) },
    });
    assert.equal(accepted.accepted, true);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});
