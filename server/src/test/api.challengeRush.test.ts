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
import { arcadeTiming } from '../arcade/timing';
import { challengeRushTiming } from '../arcade/challengeRushTiming';

process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS = '100';
process.env.NODE_ENV = 'test';
process.env.CHALLENGE_RUSH_FAST_TIMERS = '1';

type Ack = { ok: boolean; error?: string; [key: string]: unknown };
type State = { matchId: string; phase: string; challengeIndex: number; challenge: { key: string; data: Record<string, unknown> }; scores: Array<{ playerId: string; score: number; connected: boolean; forfeited: boolean }>; history: Array<{ key: string; title: string; scores: Array<{ playerId: string; name: string; score: number }> }>; readyNext: string[]; remainingMs: number | null; paused: boolean; trafficLightGreen?: boolean };

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
    const state = await advanceToChallenge(socket, match.matchId, playerId, 'reaction-circle');
    const target = state.challenge.data;
    const payload = { matchId: match.matchId, playerId, challengeIndex: state.challengeIndex, action: 'hit', value: { x: Number(target.x), y: Number(target.y) } };
    const results = await Promise.all([emitAck(socket, 'challenge-rush:challenge:input', payload), emitAck(socket, 'challenge-rush:challenge:input', payload)]);
    assert.equal(results.filter((result) => result.accepted === true).length, 1);
    assert.equal(results.filter((result) => result.accepted !== true).length, 1);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

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
    const startedIndex = playing.challengeIndex;
    const startedKey = playing.challenge.key;
    const resultPromise = nextState(hostSocket, (state) => state.phase === 'result');
    await completeChallenge(hostSocket, match.matchId, hostId, playing);
    await completeChallenge(guestSocket, match.matchId, guestId, playing);
    const result = await resultPromise;
    assert.equal(result.challengeIndex, startedIndex);

    const afterOneReady = nextEvent<State>(hostSocket, 'challenge-rush:state');
    assert.equal((await emitAck(guestSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: guestId })).ok, true);
    const stillWaiting = await afterOneReady;
    assert.equal(stillWaiting.phase, 'result');
    assert.equal(stillWaiting.challengeIndex, startedIndex);

    const advanced = nextState(hostSocket, (state) => state.phase === 'countdown' && state.challengeIndex === startedIndex + 1);
    assert.equal((await emitAck(hostSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: hostId })).ok, true);
    const finalState = await advanced;
    assert.equal(finalState.history.length, 1);
    assert.equal(finalState.history[0].key, startedKey);
    assert.deepEqual(finalState.history[0].scores.map((s) => s.playerId).sort(), [guestId, hostId].sort());
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush announces every phase with its own remaining time', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Countdown');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const openingCountdown = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 0);
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;
    const opening = await openingCountdown;
    assert.ok(opening.remainingMs !== null && opening.remainingMs > 0 && opening.remainingMs <= arcadeTiming.countdownMs, `opening countdown reported ${opening.remainingMs}ms`);

    const playing = await nextState(socket, (state) => state.phase === 'playing');
    const resultPromise = nextState(socket, (state) => state.phase === 'result');
    // The challenge order is seeded/shuffled per match (see startMatch), so this
    // can land on any of the 10 mini-challenges, not just reaction-circle —
    // completeChallenge dispatches generically by key.
    await completeChallenge(socket, match.matchId, playerId, playing);
    const result = await resultPromise;
    // The result phase reports its own ready-timeout fallback, never the finished challenge's deadline.
    assert.ok(result.remainingMs !== null && result.remainingMs > arcadeTiming.countdownMs, `result phase reported ${result.remainingMs}ms`);

    // Someone who takes a moment before confirming still gets a complete countdown:
    // the announced value must be the countdown itself, not the rest of the result timeout.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const nextCountdown = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    assert.equal((await emitAck(socket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId })).ok, true);
    const between = await nextCountdown;
    assert.ok(between.remainingMs !== null && between.remainingMs > 0 && between.remainingMs <= arcadeTiming.countdownMs, `between-challenge countdown reported ${between.remainingMs}ms`);
    await emitAck(socket, 'challenge-rush:match:finish', { matchId: match.matchId, playerId });
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
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
    const advanced = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === playing.challengeIndex + 1);
    await completeChallenge(socket, match.matchId, playerId, playing);
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
    await completeChallenge(hostSocket, match.matchId, hostId, playing);
    await resultPromise;

    const advanced = nextState(hostSocket, (state) => state.phase === 'countdown' && state.challengeIndex === playing.challengeIndex + 1);
    assert.equal((await emitAck(hostSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: hostId })).ok, true);
    await advanced;
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Each step waits out the server's 30ms per-player input throttle so a fast
// local round trip never gets silently ignored and forces a full-duration
// timeout instead (still correct, just needlessly slow for this test).
async function sendSequence<T>(send: (action: string, value?: unknown) => Promise<unknown>, action: string, items: T[], toValue: (item: T) => unknown): Promise<void> {
  for (const item of items) { await send(action, toValue(item)); await sleep(35); }
}

// aim-trainer, whack-a-mole and color-word only ever expose the current step
// in `data` (see challengeRush.ts's challengeForPlayer/nextStepPayload data
// minimization) — the following step's value comes back on the accepted
// ack's `next` field instead of being readable up front.
async function sendSteps(
  send: (action: string, value?: unknown) => Promise<unknown>,
  action: string,
  count: number,
  firstValue: unknown,
  nextValue: (next: Record<string, unknown> | undefined) => unknown,
): Promise<unknown> {
  let value = firstValue;
  let last: unknown;
  for (let index = 0; index < count; index += 1) {
    last = await send(action, value);
    await sleep(35);
    if (index < count - 1) value = nextValue((last as { next?: Record<string, unknown> }).next);
  }
  return last;
}

// Plays through challenges generically (order is seeded/shuffled per match,
// see challengeRush.ts's startMatch) until the given key comes up, then
// returns that challenge's 'playing' state WITHOUT completing it — so the
// caller can run challenge-specific validation against it regardless of
// where in the 10-challenge order it landed.
async function advanceToChallenge(socket: ClientSocket, matchId: string, playerId: string, targetKey: string): Promise<State> {
  for (;;) {
    const playing = await nextState(socket, (state) => state.phase === 'playing');
    if (playing.challenge.key === targetKey) return playing;
    const result = nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === playing.challengeIndex);
    await completeChallenge(socket, matchId, playerId, playing);
    await result;
    const advanced = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === playing.challengeIndex + 1);
    await emitAck(socket, 'challenge-rush:challenge:ready', { matchId, playerId });
    await advanced;
  }
}

async function completeChallenge(socket: ClientSocket, matchId: string, playerId: string, state: State): Promise<unknown> {
  const { key, data } = state.challenge as { key: string; data: Record<string, unknown> };
  const challengeIndex = state.challengeIndex;
  const send = (action: string, value?: unknown) => emitAck(socket, 'challenge-rush:challenge:input', { matchId, playerId, challengeIndex, action, value });
  if (key === 'reaction-circle') { const target = data as unknown as { x: number; y: number }; return send('hit', { x: target.x, y: target.y }); }
  if (key === 'aim-trainer') {
    const target = data.target as { x: number; y: number };
    return sendSteps(send, 'hit', (data.targetCount as number) ?? 6, { x: target.x, y: target.y }, (next) => { const t = next?.target as { x: number; y: number }; return { x: t.x, y: t.y }; });
  }
  if (key === 'cps') return send('click');
  if (key === 'number-salad') { const sorted = [...(data.numbers as number[])].sort((a, b) => a - b); return sendSequence(send, 'number', sorted, (n) => n); }
  if (key === 'timing-10') return send('stop');
  if (key === 'memory-sequence') { await sleep(challengeRushTiming().memoryRevealMs + 50); return sendSequence(send, 'tile', data.sequence as number[], (tile) => tile); }
  if (key === 'odd-one-out') return send('select', data.oddIndex);
  if (key === 'whack-a-mole') return sendSteps(send, 'hit', (data.totalHits as number) ?? 8, data.activeHole, (next) => next?.activeHole);
  if (key === 'traffic-light') return send('click');
  if (key === 'color-word') {
    const round = data.round as { textColor: string };
    return sendSteps(send, 'answer', (data.roundCount as number) ?? 6, round.textColor, (next) => (next?.round as { textColor: string } | undefined)?.textColor);
  }
  throw new Error(`Unbekannte Challenge: ${key}`);
}

test('Challenge Rush plays through every Phase 3 mini-challenge and records a complete history', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Full Run');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string; challengeCount: number }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;
    assert.equal(match.challengeCount, 10);

    const ended = nextEvent<{ history: Array<{ key: string }> }>(socket, 'challenge-rush:match:end');
    for (let index = 0; index < match.challengeCount; index += 1) {
      const playing = await nextState(socket, (state) => state.phase === 'playing' && state.challengeIndex === index);
      const result = nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === index);
      await completeChallenge(socket, match.matchId, playerId, playing);
      await result;
      if (index < match.challengeCount - 1) {
        const advanced = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === index + 1);
        assert.equal((await emitAck(socket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId })).ok, true);
        await advanced;
      } else {
        assert.equal((await emitAck(socket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId })).ok, true);
      }
    }
    const finalState = await ended;
    assert.equal(finalState.history.length, 10);
    assert.deepEqual(finalState.history.map((entry) => entry.key).sort(), [
      'aim-trainer', 'color-word', 'cps', 'memory-sequence', 'number-salad', 'odd-one-out',
      'reaction-circle', 'timing-10', 'traffic-light', 'whack-a-mole',
    ]);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush rejects an invalid Aim Trainer target and accepts the real one', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Aim Validation');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const aimPlaying = await advanceToChallenge(socket, match.matchId, playerId, 'aim-trainer');
    const target = aimPlaying.challenge.data.target as { x: number; y: number };
    const rejected = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: aimPlaying.challengeIndex, action: 'hit', value: { x: target.x + 40, y: target.y + 40 } });
    assert.equal(rejected.ok, false);
    await sleep(35);
    const accepted = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: aimPlaying.challengeIndex, action: 'hit', value: { x: target.x, y: target.y } });
    assert.equal(accepted.accepted, true);
    assert.equal((accepted.progress as { correct: number }).correct, 1);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush traffic-light false start scores 0 and ends the round, and a stale input afterwards is rejected', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Traffic False Start');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const trafficPlaying = await advanceToChallenge(socket, match.matchId, playerId, 'traffic-light');
    const resultPromise = nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === trafficPlaying.challengeIndex);
    const falseStart = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: trafficPlaying.challengeIndex, action: 'click' });
    assert.equal(falseStart.accepted, true);
    const trafficResult = await resultPromise;
    assert.equal(trafficResult.history[trafficResult.history.length - 1].scores.find((s) => s.playerId === playerId)?.score, 0);

    // The round already ended for everyone (the only player just completed
    // it), so a second input is rejected outright rather than accepted as a
    // no-op duplicate.
    const afterRoundEnd = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: trafficPlaying.challengeIndex, action: 'click' });
    assert.equal(afterRoundEnd.ok, false);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush lets traffic-light score above 0 for a real reaction after the server-pushed green signal', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Traffic Real Reaction');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const trafficPlaying = await advanceToChallenge(socket, match.matchId, playerId, 'traffic-light');
    const green = nextEvent<{ matchId: string; challengeIndex: number }>(socket, 'challenge-rush:traffic-light:green');
    const resultPromise = nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === trafficPlaying.challengeIndex);
    const greenSignal = await green;
    assert.equal(greenSignal.matchId, match.matchId);
    assert.equal(greenSignal.challengeIndex, trafficPlaying.challengeIndex);
    const reaction = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: trafficPlaying.challengeIndex, action: 'click' });
    assert.equal(reaction.accepted, true);
    const trafficResult = await resultPromise;
    const score = trafficResult.history[trafficResult.history.length - 1].scores.find((s) => s.playerId === playerId)?.score;
    assert.ok((score ?? 0) > 0, `expected a real reaction after the green signal to score above 0, got ${score}`);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush ends memory-sequence on the first wrong tile with partial credit', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Memory Wrong');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const playing = await advanceToChallenge(socket, match.matchId, playerId, 'memory-sequence');
    const sequence = playing.challenge.data.sequence as number[];
    // Two correct tiles first, then a deliberately wrong third one: verifies
    // the round ends with genuine partial credit (2/5 = 40), not just the
    // degenerate all-wrong case where scoreMemorySequence(0) is always 0
    // regardless of the formula.
    const wrongThird = (sequence[2] + 1) % 9;
    // The server rejects memory-sequence taps until the reveal animation
    // window has actually elapsed (see challengeRushTiming().memoryRevealMs), so this test
    // must wait it out before sending real input, same as an honest player.
    await sleep(challengeRushTiming().memoryRevealMs + 50);
    const resultPromise = nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === playing.challengeIndex);
    const first = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, action: 'tile', value: sequence[0] });
    assert.equal((first.progress as { correct: number }).correct, 1);
    await sleep(35);
    const second = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, action: 'tile', value: sequence[1] });
    assert.equal((second.progress as { correct: number }).correct, 2);
    await sleep(35);
    const rejected = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, action: 'tile', value: wrongThird });
    assert.equal(rejected.accepted, true);
    assert.equal((rejected.progress as { errors: number }).errors, 1);
    const result = await resultPromise;
    assert.equal(result.history[result.history.length - 1].scores.find((s) => s.playerId === playerId)?.score, 40);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush continues whack-a-mole after a wrong hole instead of ending the round', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Whack Wrong');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const playing = await advanceToChallenge(socket, match.matchId, playerId, 'whack-a-mole');
    const activeHole = playing.challenge.data.activeHole as number;
    const wrongFirst = (activeHole + 1) % 9;
    const wrongResult = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, action: 'hit', value: wrongFirst });
    assert.equal(wrongResult.accepted, true);
    assert.equal((wrongResult.progress as { errors: number; completed: boolean }).errors, 1);
    assert.equal((wrongResult.progress as { errors: number; completed: boolean }).completed, false);
    await sleep(35);
    const correctResult = await emitAck(socket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, action: 'hit', value: activeHole });
    assert.equal((correctResult.progress as { correct: number }).correct, 1);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush completes whack-a-mole exactly once under parallel identical hits', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Whack Race');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const playing = await advanceToChallenge(socket, match.matchId, playerId, 'whack-a-mole');
    const activeHole = playing.challenge.data.activeHole as number;
    const payload = { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, action: 'hit', value: activeHole };
    const results = await Promise.all([emitAck(socket, 'challenge-rush:challenge:input', payload), emitAck(socket, 'challenge-rush:challenge:input', payload)]);
    assert.equal(results.filter((result) => result.accepted === true).length, 1);
    assert.equal(results.filter((result) => result.accepted !== true).length, 1);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush times out odd-one-out without a click at a score of 0', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Odd Timeout');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const playing = await advanceToChallenge(socket, match.matchId, playerId, 'odd-one-out');
    const resultPromise = nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === playing.challengeIndex);
    // Deliberately never click a tile — the challenge must time out on its
    // own real duration and fall back to a score of 0 via timeoutScore.
    const result = await resultPromise;
    assert.equal(result.history[result.history.length - 1].scores.find((s) => s.playerId === playerId)?.score, 0);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush gives two players independent scores on the same color-word challenge', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Color Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Color Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;

    let playing = await nextState(hostSocket, (state) => state.phase === 'playing');
    while (playing.challenge.key !== 'color-word') {
      const result = nextState(hostSocket, (state) => state.phase === 'result' && state.challengeIndex === playing.challengeIndex);
      await completeChallenge(hostSocket, match.matchId, hostId, playing);
      await completeChallenge(guestSocket, match.matchId, guestId, playing);
      await result;
      const nextPlaying = nextState(hostSocket, (state) => state.phase === 'playing' && state.challengeIndex === playing.challengeIndex + 1);
      await emitAck(hostSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: hostId });
      await emitAck(guestSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: guestId });
      playing = await nextPlaying;
    }
    const roundCount = (playing.challenge.data.roundCount as number) ?? 6;
    const initialRound = playing.challenge.data.round as { textColor: string };
    const resultPromise = nextState(hostSocket, (state) => state.phase === 'result' && state.challengeIndex === playing.challengeIndex);
    // Host answers every round correctly; guest answers every round wrong —
    // each player's own progress must only reflect their own inputs. Each
    // socket walks its own per-player round chain via the accepted ack's
    // `next` field (see sendSteps), since the server only ever exposes the
    // current step's round to each player.
    const wrongColor = (color: string) => ['red', 'blue', 'green', 'yellow'].find((candidate) => candidate !== color)!;
    let hostRound = initialRound;
    let guestRound = initialRound;
    for (let index = 0; index < roundCount; index += 1) {
      const hostResult = await emitAck(hostSocket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId: hostId, challengeIndex: playing.challengeIndex, action: 'answer', value: hostRound.textColor });
      await sleep(35);
      const guestResult = await emitAck(guestSocket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId: guestId, challengeIndex: playing.challengeIndex, action: 'answer', value: wrongColor(guestRound.textColor) });
      await sleep(35);
      if (index < roundCount - 1) {
        hostRound = (hostResult.next as { round: { textColor: string } }).round;
        guestRound = (guestResult.next as { round: { textColor: string } }).round;
      }
    }
    const result = await resultPromise;
    const entry = result.history[result.history.length - 1];
    const hostScore = entry.scores.find((s) => s.playerId === hostId)?.score ?? 0;
    const guestScore = entry.scores.find((s) => s.playerId === guestId)?.score ?? 0;
    assert.equal(hostScore, 100);
    assert.equal(guestScore, 0);
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush restores the traffic-light green state after a reconnect instead of leaving the client stuck on red', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Traffic Reconnect');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;

    const trafficPlaying = await advanceToChallenge(socket, match.matchId, playerId, 'traffic-light');
    assert.equal(trafficPlaying.trafficLightGreen, false);
    await nextEvent(socket, 'challenge-rush:traffic-light:green');

    // Reconnect with a fresh socket instead of reusing the existing one —
    // this is exactly the path a page reload takes (attachSocket via the
    // authenticated connection handler), so it must not rely on having
    // received the one-shot green event on this new connection.
    socket.close();
    const replacement = ioClient(server.baseUrl, { transports: ['websocket'], reconnection: false, auth: { playerId } });
    // Both listeners must be registered before awaiting 'connect': the
    // server's authenticated-connection handler emits 'challenge-rush:
    // match:start' and the follow-up state synchronously once the socket is
    // connected, so attaching them only after the 'connect' promise resolves
    // risks missing both — an EventEmitter drops an emit with no listener
    // instead of queuing it, which otherwise hangs this test forever.
    const matchStart = nextEvent(replacement, 'challenge-rush:match:start');
    const freshStatePromise = nextEvent<State>(replacement, 'challenge-rush:state');
    await new Promise<void>((resolve, reject) => { replacement.once('connect', () => resolve()); replacement.once('connect_error', reject); });
    try {
      await matchStart;
      const freshState = await freshStatePromise;
      assert.equal(freshState.trafficLightGreen, true);

      const resultPromise = nextState(replacement, (state) => state.phase === 'result' && state.challengeIndex === trafficPlaying.challengeIndex);
      const reaction = await emitAck(replacement, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: trafficPlaying.challengeIndex, action: 'click' });
      assert.equal(reaction.accepted, true);
      const result = await resultPromise;
      const score = result.history[result.history.length - 1].scores.find((s) => s.playerId === playerId)?.score;
      assert.ok((score ?? 0) > 0, `expected a real reaction after reconnect-past-green to score above 0, got ${score}`);
    } finally {
      replacement.close();
    }
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

// Each match's challenge order is a per-match random shuffle (see
// startMatch/shuffled in challengeRush.ts), so a single match visits every
// challenge exactly once but never in a assumable relative order — a prior
// version of this test chained three advanceToChallenge calls on one match
// assuming aim-trainer, whack-a-mole and color-word would come up in that
// order, which deadlocks forever whenever the shuffle puts an earlier one
// after a later one already passed. A fresh match per target sidesteps the
// ordering assumption entirely: advanceToChallenge is guaranteed to find any
// single key exactly once per match.
async function assertStepBasedDataMinimization(server: { baseUrl: string }, targetKey: string, verify: (data: Record<string, unknown>) => void): Promise<void> {
  clearLobbyMemberships();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, `CR Data Min ${targetKey}`);
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const match = await started;
    const playing = await advanceToChallenge(socket, match.matchId, playerId, targetKey);
    verify(playing.challenge.data);
  } finally {
    socket.close();
    clearLobbyMemberships();
  }
}

test('Challenge Rush never sends the full future targets, holes or rounds for the current step-based challenges', async () => {
  const server = await makeServer();
  try {
    await assertStepBasedDataMinimization(server, 'aim-trainer', (data) => {
      assert.equal(data.targets, undefined);
      assert.ok(data.target && typeof data.target === 'object');
    });
    await assertStepBasedDataMinimization(server, 'whack-a-mole', (data) => {
      assert.equal(data.sequence, undefined);
      assert.equal(typeof data.activeHole, 'number');
    });
    await assertStepBasedDataMinimization(server, 'color-word', (data) => {
      assert.equal(data.rounds, undefined);
      assert.ok(data.round && typeof data.round === 'object');
    });
  } finally {
    server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
});

test('Challenge Rush rejects input from a forfeited player in a later challenge instead of letting them keep scoring', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush Forfeit Host');
    const guestId = await player(server.baseUrl, 'Challenge Rush Forfeit Guest');
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;
    const playing = await nextState(hostSocket, (state) => state.phase === 'playing');

    assert.equal((await emitAck(guestSocket, 'challenge-rush:match:leave', { matchId: match.matchId, playerId: guestId })).ok, true);

    const resultPromise = nextState(hostSocket, (state) => state.phase === 'result' && state.challengeIndex === playing.challengeIndex);
    await completeChallenge(hostSocket, match.matchId, hostId, playing);
    await resultPromise;
    const nextPlaying = nextState(hostSocket, (state) => state.phase === 'playing' && state.challengeIndex === playing.challengeIndex + 1);
    await emitAck(hostSocket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId: hostId });
    const secondChallenge = await nextPlaying;

    const guestScoreBefore = secondChallenge.scores.find((s) => s.playerId === guestId)?.score ?? 0;
    const rejected = await emitAck(guestSocket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId: guestId, challengeIndex: secondChallenge.challengeIndex, action: 'click' });
    assert.equal(rejected.ok, false);

    const thirdChallengeResultPromise = nextState(hostSocket, (state) => state.phase === 'result' && state.challengeIndex === secondChallenge.challengeIndex);
    await completeChallenge(hostSocket, match.matchId, hostId, secondChallenge);
    const thirdChallengeResult = await thirdChallengeResultPromise;
    const guestScoreAfter = thirdChallengeResult.scores.find((s) => s.playerId === guestId)?.score ?? 0;
    assert.equal(guestScoreAfter, guestScoreBefore);
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
