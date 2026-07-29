import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { inputTrialData, registerChallengeRushSockets } from '../arcade/challengeRush';
import { challengeOrder } from '../arcade/challengeRushLogic';
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

function seedForFirstChallenge(key: string): number {
  const seed = Array.from({ length: 5_000 }, (_, candidate) => candidate).find((candidate) => challengeOrder(candidate)[0] === key);
  assert.notEqual(seed, undefined);
  return Number(seed);
}
async function startMatchWithFirst(socket: ClientSocket, lobbyId: unknown, playerId: string, key: string): Promise<Ack> {
  const seed = seedForFirstChallenge(key);
  const originalRandom = Math.random;
  Math.random = () => (seed + 0.25) / 0x7fffffff;
  try { return await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId, playerId }); }
  finally { Math.random = originalRandom; }
}
const startReactionMatch = (socket: ClientSocket, lobbyId: unknown, playerId: string) => startMatchWithFirst(socket, lobbyId, playerId, 'reaction-circle');

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

test('Challenge Rush removes remembered solutions from input-phase payloads', () => {
  const fixtures = [
    { data: { type: 'sequence', size: 3, sequence: [1, 4, 7] }, hidden: ['sequence'], visible: ['sequenceLength'] },
    { data: { type: 'matrix', size: 3, highlights: [0, 2, 8] }, hidden: ['highlights'], visible: ['highlightCount'] },
    { data: { type: 'number-blind', size: 3, numbers: [{ number: 1, position: 6 }] }, hidden: ['numbers'], visible: ['numberCount'] },
    { data: { type: 'path', size: 3, path: [0, 1, 4] }, hidden: ['path'], visible: ['pathLength'] },
    { data: { type: 'missing', items: ['Becher'], originalItems: ['Becher', 'Lampe'], options: ['Lampe', 'Becher'] }, hidden: ['originalItems'], visible: ['items', 'options'] },
    { data: { type: 'delayed-recall', items: ['Becher'], options: ['Becher', 'Lampe'], prompt: 'Was war da?' }, hidden: ['items'], visible: ['options'] },
    { data: { type: 'suitcase', items: ['Becher'], position: 1, options: ['Becher', 'Lampe'] }, hidden: ['items'], visible: ['position', 'options'] },
  ];
  for (const fixture of fixtures) {
    const result = inputTrialData(fixture.data);
    for (const key of fixture.hidden) assert.equal(key in result, false, `${fixture.data.type}:${key}`);
    for (const key of fixture.visible) assert.equal(key in result, true, `${fixture.data.type}:${key}`);
  }
});

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
    const hostTrial = nextEvent<{ trial: { data: Record<string, unknown> } }>(hostSocket, 'challenge-rush:trial');
    const guestTrial = nextEvent<{ trial: { data: Record<string, unknown> } }>(guestSocket, 'challenge-rush:trial');
    assert.equal((await startReactionMatch(hostSocket, created.lobbyId, hostId)).ok, true);
    const match = await started;
    const playing = nextState(hostSocket, (state) => state.phase === 'playing');
    const [hostTrialPayload, guestTrialPayload] = await Promise.all([hostTrial, guestTrial]);
    assert.notDeepEqual(hostTrialPayload.trial.data, guestTrialPayload.trial.data);
    assert.equal(match.challengeCount, 10);
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
    const trialEvent = nextEvent<{ challengeIndex: number; trial: { trialId: string; data: Record<string, unknown> } }>(socket, 'challenge-rush:trial');
    await startReactionMatch(socket, created.lobbyId, playerId);
    const match = await started;
    const trial = await trialEvent;
    const target = trial.trial.data as { x: number; y: number };
    const payload = { matchId: match.matchId, playerId, challengeIndex: trial.challengeIndex, trialId: trial.trial.trialId, action: 'hit', value: { x: Number(target.x), y: Number(target.y) } };
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
    await startReactionMatch(socket, created.lobbyId, playerId);
    const [match, trial] = await Promise.all([started, trialEvent]);
    const target = trial.trial.data;
    const missing = await emitAck(socket, 'challenge-rush:challenge:input', {
      matchId: match.matchId,
      playerId,
      challengeIndex: trial.challengeIndex,
      action: 'hit',
      value: { x: Number(target.x), y: Number(target.y) },
    });
    assert.equal(missing.ignored, true);
    assert.equal(missing.reason, 'stale-trial');
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

test('Challenge Rush scores a traffic-light false start and advances the trial', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush False Start');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    const trialEvent = nextEvent<{ challengeIndex: number; trial: { trialId: string; phase: string } }>(socket, 'challenge-rush:trial');
    await startMatchWithFirst(socket, created.lobbyId, playerId, 'traffic-light');
    const [match, current] = await Promise.all([started, trialEvent]);
    assert.equal(current.trial.phase, 'preview');
    const result = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: current.challengeIndex, trialId: current.trial.trialId, action: 'click' });
    assert.equal(result.accepted, true);
    assert.equal(result.falseStart, true);
    assert.equal((result.progress as { errors?: number }).errors, 1);
    assert.notEqual((result.trial as { trialId?: string }).trialId, current.trial.trialId);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush reveals memory cards one at a time without exposing the board', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Memory Pair');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    const trialEvent = nextEvent<{ challengeIndex: number; trial: { trialId: string; data: { cards: Array<Record<string, unknown>> } } }>(socket, 'challenge-rush:trial');
    await startMatchWithFirst(socket, created.lobbyId, playerId, 'memory-pairs');
    const [match, current] = await Promise.all([started, trialEvent]);
    assert.ok(current.trial.data.cards.every((card) => !('value' in card)));
    const first = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: current.challengeIndex, trialId: current.trial.trialId, action: 'reveal', value: 0 });
    assert.equal(first.accepted, true);
    assert.equal(first.correct, null);
    assert.equal(typeof (first.revealedCards as Array<{ value?: unknown }>)[0].value, 'string');
    await new Promise((resolve) => setTimeout(resolve, 35));
    const second = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: current.challengeIndex, trialId: current.trial.trialId, action: 'reveal', value: 1 });
    assert.equal(second.accepted, true);
    assert.equal(typeof second.correct, 'boolean');
    assert.equal((second.revealedCards as unknown[]).length, 2);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush replaces preview solutions with a reduced input payload', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Safe Phase');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    const previewEvent = nextEvent<{ challengeIndex: number; trial: { trialId: string; phase: string; phaseRemainingMs: number; data: Record<string, unknown> } }>(socket, 'challenge-rush:trial');
    await startMatchWithFirst(socket, created.lobbyId, playerId, 'sequence-echo');
    const [match, preview] = await Promise.all([started, previewEvent]);
    assert.equal(preview.trial.phase, 'preview');
    assert.ok(Array.isArray(preview.trial.data.sequence));
    await new Promise((resolve) => setTimeout(resolve, preview.trial.phaseRemainingMs + 30));
    const inputEvent = nextEvent<{ trial: { phase: string; data: Record<string, unknown> } }>(socket, 'challenge-rush:trial');
    const synced = await emitAck(socket, 'challenge-rush:trial:get', { matchId: match.matchId, playerId, challengeIndex: preview.challengeIndex });
    assert.equal(synced.ok, true);
    const input = await inputEvent;
    assert.equal(input.trial.phase, 'input');
    assert.equal('sequence' in input.trial.data, false);
    assert.equal(typeof input.trial.data.sequenceLength, 'number');
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush binds legacy player control to the socket that claimed it', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const owner = await connect(server.baseUrl);
  const attacker = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Legacy Binding');
    const created = await emitAck(owner, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(owner, 'challenge-rush:match:start');
    const trialEvent = nextEvent<{ challengeIndex: number; trial: { trialId: string; data: Record<string, unknown> } }>(owner, 'challenge-rush:trial');
    await startReactionMatch(owner, created.lobbyId, playerId);
    const [match, trial] = await Promise.all([started, trialEvent]);
    const target = trial.trial.data as { x: number; y: number };
    const result = await emitAck(attacker, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: trial.challengeIndex, trialId: trial.trial.trialId, action: 'hit', value: target });
    assert.equal(result.ok, false);
  } finally {
    owner.close(); attacker.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush host can abort a running match', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Abort');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await startReactionMatch(socket, created.lobbyId, playerId);
    const match = await started;
    const ended = nextEvent<{ matchId: string; reason: string }>(socket, 'challenge-rush:match:end');
    const result = await emitAck(socket, 'challenge-rush:match:end', { matchId: match.matchId, playerId });
    assert.equal(result.ok, true);
    const endPayload = await ended;
    assert.equal(endPayload.matchId, match.matchId);
    assert.equal(endPayload.reason, 'aborted');
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});
