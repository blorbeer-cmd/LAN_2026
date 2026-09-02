import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, installTestSocketIdentity } from './testApp';
import { registerChallengeRushSockets } from '../arcade/challengeRush';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { challengeRushTiming } from '../arcade/challengeRushTiming';
import { CHALLENGES, isTrialChallenge, type ChallengeKey } from '../arcade/challengeRushLogic';
import { db } from '../db';

process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS = '100';
process.env.NODE_ENV = 'test';
process.env.CHALLENGE_RUSH_FAST_TIMERS = '1';

type Ack = { ok: boolean; error?: string; [key: string]: unknown };
type State = { matchId: string; phase: string; challengeIndex: number; challenge: { key: string; data: Record<string, unknown> }; scores: Array<{ playerId: string; score: number; connected: boolean; forfeited: boolean; isBot?: boolean }>; history: Array<{ key: string; title: string; scores: Array<{ playerId: string; name: string; score: number }> }>; readyNext: string[]; remainingMs: number | null; paused: boolean; trafficLightGreen?: boolean };

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
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
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

test('Challenge Rush lets only admins select exact challenges for a targeted test run', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Testauswahl');
    const denied = await emitAck(socket, 'challenge-rush:lobby:create', { playerId, challengeKeys: ['digit-sum'] });
    assert.equal(denied.ok, false);
    assert.match(denied.error ?? '', /nur für Admins/);

    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(playerId);
    const invalid = await emitAck(socket, 'challenge-rush:lobby:create', { playerId, challengeKeys: ['nicht-vorhanden'] });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error ?? '', /ungültig/);

    const selected: ChallengeKey[] = ['digit-sum', 'binary-pattern'];
    const lobbyUpdate = nextEvent<{ challenges: Array<{ key: string; title: string }>; lobbies: Array<{ id: string; challengeKeys: string[] | null }> }>(socket, 'challenge-rush:lobbies');
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId, challengeKeys: selected });
    assert.equal(created.ok, true);
    const lobbyPayload = await lobbyUpdate;
    assert.equal(lobbyPayload.challenges.length, CHALLENGES.length);
    assert.deepEqual(lobbyPayload.lobbies.find((lobby) => lobby.id === created.lobbyId)?.challengeKeys, selected);

    const startedPromise = nextEvent<{ matchId: string; challengeCount: number }>(socket, 'challenge-rush:match:start');
    const firstCountdown = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 0);
    assert.equal((await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId })).ok, true);
    const started = await startedPromise;
    assert.equal(started.challengeCount, selected.length);
    assert.equal((await firstCountdown).challenge.key, selected[0]);

    const firstResult = await nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === 0);
    const secondCountdown = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    assert.equal((await emitAck(socket, 'challenge-rush:challenge:ready', { matchId: started.matchId, playerId })).ok, true);
    assert.equal((await secondCountdown).challenge.key, selected[1]);
    assert.equal(firstResult.history[0].key, selected[0]);
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush AI quick start is admin-gated, plays and ends when its human leaves', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  const extraSockets: ClientSocket[] = [];
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush KI Host');
    const denied = await emitAck(socket, 'challenge-rush:lobby:bot', { playerId });
    assert.equal(denied.ok, false);
    assert.match(denied.error ?? '', /nur für Admins/);

    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(playerId);
    const normalLobbySocket = await connect(server.baseUrl);
    extraSockets.push(normalLobbySocket);
    const normalLobbyHostId = await player(server.baseUrl, 'Challenge Rush Parallel Normal Host');
    const normalLobby = await emitAck(normalLobbySocket, 'challenge-rush:lobby:create', { playerId: normalLobbyHostId });
    assert.equal(normalLobby.ok, true);

    const aiLobbySocket = await connect(server.baseUrl);
    extraSockets.push(aiLobbySocket);
    const aiLobbyHostId = await player(server.baseUrl, 'Challenge Rush Parallel KI Host');
    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(aiLobbyHostId);
    const aiLobby = await emitAck(aiLobbySocket, 'challenge-rush:lobby:bot', { playerId: aiLobbyHostId });
    assert.equal(aiLobby.ok, true);

    const lobbiesPromise = nextEvent<{ lobbies: Array<{ id: string; players: Array<{ id: string; ready: boolean }> }> }>(socket, 'challenge-rush:lobbies');
    const created = await emitAck(socket, 'challenge-rush:lobby:bot', { playerId });
    assert.equal(created.ok, true);
    const lobby = (await lobbiesPromise).lobbies.find((entry) => entry.id === created.lobbyId);
    assert.deepEqual(lobby?.players.map((entry) => entry.id), [playerId, 'challenge-rush-bot']);
    assert.equal(lobby?.players.find((entry) => entry.id === 'challenge-rush-bot')?.ready, true);

    const startedPromise = nextEvent<{ matchId: string; players: Array<{ id: string }>; challengeCount: number }>(socket, 'challenge-rush:match:start');
    const playingPromise = nextState(socket, (state) => state.phase === 'playing');
    assert.equal((await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId })).ok, true);
    const started = await startedPromise;
    assert.equal(started.players.length, 2);
    // A bot only ever plays the single-payload challenges (see
    // planBotChallenge/BOT_CHALLENGE_POOL); drawing from the full catalog
    // here would silently spend most of a bot match on trial challenges the
    // bot always scores 0 on. Derived from CHALLENGES so retiring or adding a
    // challenge does not need this number edited by hand.
    assert.equal(started.challengeCount, CHALLENGES.filter((entry) => !isTrialChallenge(entry.key)).length);
    const playing = await playingPromise;
    assert.equal(playing.scores.find((score) => score.playerId === 'challenge-rush-bot')?.isBot, true);
    assert.equal(isTrialChallenge(playing.challenge.key as ChallengeKey), false, `bot match must not draw a trial challenge, got ${playing.challenge.key}`);

    const secondBotLobby = await emitAck(socket, 'challenge-rush:lobby:bot', { playerId });
    assert.equal(secondBotLobby.ok, false);
    assert.match(secondBotLobby.error ?? '', /laufendes Challenge-Rush-Match/);
    const secondHumanLobby = await emitAck(socket, 'challenge-rush:lobby:create', { playerId });
    assert.equal(secondHumanLobby.ok, false);
    assert.match(secondHumanLobby.error ?? '', /laufendes Challenge-Rush-Match/);
    for (const lobbyId of [normalLobby.lobbyId, aiLobby.lobbyId]) {
      const joined = await emitAck(socket, 'challenge-rush:lobby:join', { lobbyId, playerId });
      assert.equal(joined.ok, false);
      assert.match(joined.error ?? '', /laufendes Challenge-Rush-Match/);
    }

    const spoofedBotInput = await emitAck(socket, 'challenge-rush:challenge:input', {
      matchId: started.matchId,
      playerId: 'challenge-rush-bot',
      challengeIndex: playing.challengeIndex,
      action: 'click',
    });
    assert.equal(spoofedBotInput.ok, false);

    const result = await nextState(socket, (state) => state.phase === 'result');
    assert.equal(result.scores.find((score) => score.playerId === 'challenge-rush-bot')?.isBot, true);

    assert.equal((await emitAck(socket, 'challenge-rush:match:leave', { matchId: started.matchId, playerId })).ok, true);
    const recorded = db.prepare(
      `SELECT reason, scores FROM arcade_results
       WHERE game_type = 'challenge-rush' AND players LIKE ?
       ORDER BY ended_at DESC LIMIT 1`,
    ).get(`%${playerId}%`) as { reason: string; scores: string };
    assert.equal(recorded.reason, 'no-human-players');
    const recordedScores = JSON.parse(recorded.scores) as Array<{ playerId: string; isBot: boolean }>;
    assert.equal(recordedScores.find((score) => score.playerId === 'challenge-rush-bot')?.isBot, true);
  } finally {
    for (const extraSocket of extraSockets) extraSocket.close();
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('a bot lobby joined by a second human keeps the full challenge catalog', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  try {
    const hostId = await player(server.baseUrl, 'Challenge Rush KI Lobby Host');
    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(hostId);
    const guestId = await player(server.baseUrl, 'Challenge Rush KI Lobby Guest');

    const created = await emitAck(hostSocket, 'challenge-rush:lobby:bot', { playerId: hostId });
    assert.equal(created.ok, true);
    assert.equal((await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId })).ok, true);
    assert.equal((await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true })).ok, true);

    const startedPromise = nextEvent<{ matchId: string; players: Array<{ id: string }>; challengeCount: number }>(hostSocket, 'challenge-rush:match:start');
    assert.equal((await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId })).ok, true);
    const started = await startedPromise;
    assert.equal(started.players.length, 3);
    // Only a solo human-vs-bot lobby narrows the draw to the bot's ten
    // playable challenges (see BOT_CHALLENGE_POOL in challengeRush.ts); once
    // a second human joins before start, the match keeps the full catalog
    // like any other match — the bot just scores 0 on trial challenges.
    assert.equal(started.challengeCount, CHALLENGES.length);
  } finally {
    hostSocket.close(); guestSocket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
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
    const { playerId, match, playing: state } = await startSelectedChallenge(socket, server.baseUrl, 'Challenge Rush Race', 'reaction-circle');
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
    const countdownMs = challengeRushTiming().countdownMs;
    assert.equal(countdownMs, 50);
    assert.ok(opening.remainingMs !== null && opening.remainingMs > 0 && opening.remainingMs <= countdownMs, `opening countdown reported ${opening.remainingMs}ms`);

    const playing = await nextState(socket, (state) => state.phase === 'playing');
    const resultPromise = nextState(socket, (state) => state.phase === 'result');
    // The challenge order is seeded/shuffled per match (see startMatch), so this
    // can land on any of the 10 mini-challenges, not just reaction-circle —
    // completeChallenge dispatches generically by key.
    await completeChallenge(socket, match.matchId, playerId, playing);
    const result = await resultPromise;
    // The result phase reports its own ready-timeout fallback, never the finished challenge's deadline.
    assert.ok(result.remainingMs !== null && result.remainingMs > 29_000 && result.remainingMs <= 30_000, `result phase reported ${result.remainingMs}ms`);

    // Someone who takes a moment before confirming still gets a complete countdown:
    // the announced value must be the countdown itself, not the rest of the result timeout.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const nextCountdown = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    assert.equal((await emitAck(socket, 'challenge-rush:challenge:ready', { matchId: match.matchId, playerId })).ok, true);
    const between = await nextCountdown;
    assert.ok(between.remainingMs !== null && between.remainingMs > 0 && between.remainingMs <= countdownMs, `between-challenge countdown reported ${between.remainingMs}ms`);
    await emitAck(socket, 'challenge-rush:match:finish', { matchId: match.matchId, playerId });
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush preserves a pause when ready advances from result to the next countdown', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Challenge Rush Pausenübergang');
    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(playerId);
    const selected: ChallengeKey[] = ['digit-sum', 'binary-pattern'];
    const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId, challengeKeys: selected });
    const startedPromise = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
    await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId });
    const started = await startedPromise;
    await nextState(socket, (state) => state.phase === 'result' && state.challengeIndex === 0);

    assert.equal((await emitAck(socket, 'challenge-rush:match:pause', { matchId: started.matchId, playerId })).ok, true);
    const pausedCountdownPromise = nextState(socket, (state) => state.phase === 'countdown' && state.challengeIndex === 1);
    assert.equal((await emitAck(socket, 'challenge-rush:challenge:ready', { matchId: started.matchId, playerId })).ok, true);
    const pausedCountdown = await pausedCountdownPromise;
    assert.equal(pausedCountdown.paused, true);
    assert.equal(pausedCountdown.remainingMs, challengeRushTiming().countdownMs);
    assert.equal(pausedCountdown.challenge.key, selected[1]);

    await sleep(challengeRushTiming().countdownMs + 60);
    const playingPromise = nextState(socket, (state) => state.phase === 'playing' && state.challengeIndex === 1);
    assert.equal((await emitAck(socket, 'challenge-rush:match:pause', { matchId: started.matchId, playerId })).ok, true);
    const playing = await playingPromise;
    assert.equal(playing.paused, false);
    assert.equal(playing.challenge.key, selected[1]);
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

// color-word only ever exposes the current step in `data` (see
// challengeRush.ts's challengeForPlayer/nextStepPayload data minimization) —
// the following step's value comes back on the accepted ack's `next` field
// instead of being readable up front.
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

// Targeted behavior tests use the admin-only exact challenge selection. This
// avoids spending most of their runtime completing unrelated shuffled rounds;
// the full challenge-catalog lifecycle remains covered once below.
async function startSelectedChallenge(
  socket: ClientSocket,
  baseUrl: string,
  playerName: string,
  targetKey: ChallengeKey,
): Promise<{ playerId: string; match: { matchId: string }; playing: State }> {
  const playerId = await player(baseUrl, playerName);
  db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(playerId);
  const created = await emitAck(socket, 'challenge-rush:lobby:create', { playerId, challengeKeys: [targetKey] });
  assert.equal(created.ok, true);
  const started = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:start');
  const firstChallenge = nextState(socket, (state) => state.phase === 'playing' && state.challengeIndex === 0);
  assert.equal((await emitAck(socket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId })).ok, true);
  const [match, playing] = await Promise.all([started, firstChallenge]);
  assert.equal(playing.challenge.key, targetKey);
  return { playerId, match, playing };
}

async function completeChallenge(socket: ClientSocket, matchId: string, playerId: string, state: State): Promise<unknown> {
  const { key, data } = state.challenge as { key: string; data: Record<string, unknown> };
  const challengeIndex = state.challengeIndex;
  const send = (action: string, value?: unknown) => emitAck(socket, 'challenge-rush:challenge:input', { matchId, playerId, challengeIndex, action, value });
  if (key === 'reaction-circle') { const target = data as unknown as { x: number; y: number }; return send('hit', { x: target.x, y: target.y }); }
  if (key === 'cps') return send('click');
  if (key === 'number-salad') { const sorted = [...(data.numbers as number[])].sort((a, b) => a - b); return sendSequence(send, 'number', sorted, (n) => n); }
  if (key === 'timing-10') return send('stop');
  if (key === 'odd-one-out') return send('select', data.oddIndex);
  if (key === 'color-word') {
    const round = data.round as { textColor: string };
    return sendSteps(send, 'answer', (data.roundCount as number) ?? 6, round.textColor, (next) => (next?.round as { textColor: string } | undefined)?.textColor);
  }
  const trialResponse = await emitAck(socket, 'challenge-rush:trial:get', { matchId, playerId, challengeIndex });
  const trial = trialResponse.trial as { trialId?: string } | undefined;
  assert.ok(trial?.trialId, `Trial für ${key} fehlt`);
  return emitAck(socket, 'challenge-rush:challenge:input', { matchId, playerId, challengeIndex, trialId: trial.trialId, action: 'timeout' });
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
    assert.equal(match.challengeCount, CHALLENGES.length);

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
    assert.equal(finalState.history.length, CHALLENGES.length);
    assert.deepEqual(finalState.history.map((entry) => entry.key).sort(), CHALLENGES.map((entry) => entry.key).sort());
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});







test('Challenge Rush times out odd-one-out without a click at a score of 0', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const { playerId, playing } = await startSelectedChallenge(socket, server.baseUrl, 'Challenge Rush Odd Timeout', 'odd-one-out');
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
    db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(hostId);
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId, challengeKeys: ['color-word'] });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;

    const playing = await nextState(hostSocket, (state) => state.phase === 'playing' && state.challengeIndex === 0);
    assert.equal(playing.challenge.key, 'color-word');
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
      // Both players act independently in production. Submit their answers
      // together so this test does not spend most of the 1.2s fast-test
      // challenge window serializing otherwise unrelated socket round trips.
      const [hostResult, guestResult] = await Promise.all([
        emitAck(hostSocket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId: hostId, challengeIndex: playing.challengeIndex, action: 'answer', value: hostRound.textColor }),
        emitAck(guestSocket, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId: guestId, challengeIndex: playing.challengeIndex, action: 'answer', value: wrongColor(guestRound.textColor) }),
      ]);
      assert.equal(hostResult.accepted, true);
      assert.equal(guestResult.accepted, true);
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


// The memorize → answer switch must not depend on the client noticing its own
// preview countdown ended: a backgrounded tab has its timers throttled or
// suspended, so a phone locked mid-preview would otherwise sit on the
// memorize screen until the whole challenge deadline expired. These tests
// therefore never send 'challenge-rush:trial:get' and rely purely on the
// server-side preview timer.
test('Challenge Rush switches a preview trial to its input phase without the client asking', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const socket = await connect(server.baseUrl);
  try {
    const previewTrial = nextEvent<{ trial: { phase: string; trialId: string } }>(socket, 'challenge-rush:trial');
    const { match } = await startSelectedChallenge(socket, server.baseUrl, 'Challenge Rush Preview Push', 'memory-matrix');
    const preview = await previewTrial;
    assert.equal(preview.trial.phase, 'preview');

    const inputTrial = await nextEvent<{ matchId: string; trial: { phase: string; trialId: string; data: Record<string, unknown> } }>(socket, 'challenge-rush:trial');
    assert.equal(inputTrial.matchId, match.matchId);
    assert.equal(inputTrial.trial.phase, 'input');
    assert.equal(inputTrial.trial.trialId, preview.trial.trialId);
    // The highlights are only shown during the memorize phase; the answer
    // phase must not re-send them or the trial would answer itself.
    assert.equal(inputTrial.trial.data.highlights, undefined);
    assert.equal(typeof inputTrial.trial.data.highlightCount, 'number');
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush holds the preview switch across a pause and completes it after resume', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const socket = await connect(server.baseUrl);
  try {
    const previewTrial = nextEvent<{ trial: { phase: string } }>(socket, 'challenge-rush:trial');
    const { playerId, match } = await startSelectedChallenge(socket, server.baseUrl, 'Challenge Rush Preview Pause', 'memory-matrix');
    assert.equal((await previewTrial).trial.phase, 'preview');
    assert.equal((await emitAck(socket, 'challenge-rush:match:pause', { matchId: match.matchId, playerId })).paused, true);

    let switchedWhilePaused = false;
    const onTrial = (payload: { trial?: { phase?: string } }) => { if (payload.trial?.phase === 'input') switchedWhilePaused = true; };
    socket.on('challenge-rush:trial', onTrial);
    // Negative assertion window (TESTING.md rule 4): no trial may arrive at
    // all, so nothing can be awaited. 150 ms is three times the 50 ms preview
    // length of this profile, i.e. well past when an unpaused match would have
    // pushed the input phase.
    await sleep(150);
    socket.off('challenge-rush:trial', onTrial);
    assert.equal(switchedWhilePaused, false, 'a paused match must not advance the memorize phase');

    const afterResume = nextEvent<{ trial: { phase: string } }>(socket, 'challenge-rush:trial');
    assert.equal((await emitAck(socket, 'challenge-rush:match:pause', { matchId: match.matchId, playerId })).paused, false);
    // Resume re-emits the still-in-preview trial first; the server-armed timer
    // then delivers the input phase on its own.
    const resumed = await afterResume;
    const inputPhase = resumed.trial.phase === 'input' ? resumed : await nextEvent<{ trial: { phase: string } }>(socket, 'challenge-rush:trial');
    assert.equal(inputPhase.trial.phase, 'input');
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

// Timer hygiene: one preview timer exists per player and trial, so every exit
// path has to clear it or a three-day LAN accumulates them and a finished
// match keeps pushing into a dead room.
test('Challenge Rush stops pushing preview trials once the match has ended', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const socket = await connect(server.baseUrl);
  try {
    const previewTrial = nextEvent<{ trial: { phase: string } }>(socket, 'challenge-rush:trial');
    const { playerId, match } = await startSelectedChallenge(socket, server.baseUrl, 'Challenge Rush Preview Cleanup', 'memory-matrix');
    assert.equal((await previewTrial).trial.phase, 'preview');

    const ended = nextEvent<{ matchId: string }>(socket, 'challenge-rush:match:end');
    assert.equal((await emitAck(socket, 'challenge-rush:match:finish', { matchId: match.matchId, playerId })).ok, true);
    await ended;

    let pushedAfterEnd = false;
    const onTrial = () => { pushedAfterEnd = true; };
    socket.on('challenge-rush:trial', onTrial);
    // Negative assertion window (TESTING.md rule 4): same budget as above —
    // an armed timer would have fired well inside it.
    await sleep(150);
    socket.off('challenge-rush:trial', onTrial);
    assert.equal(pushedAfterEnd, false, 'a finished match must not keep an armed preview timer');
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

test('Challenge Rush re-sends the same redacted trial across pause, resume and reconnect', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const socket = await connect(server.baseUrl);
  try {
    const { playerId, match, playing } = await startSelectedChallenge(socket, server.baseUrl, 'Challenge Rush Trial Resume', 'matrix-missing');

    const initial = await emitAck(socket, 'challenge-rush:trial:get', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex });
    const firstTrial = initial.trial as { trialId: string; expected?: unknown; data: Record<string, unknown> };
    assert.ok(firstTrial.trialId);
    assert.equal(firstTrial.expected, undefined);

    assert.equal((await emitAck(socket, 'challenge-rush:match:pause', { matchId: match.matchId, playerId })).ok, true);
    const resumedEvent = nextEvent<{ trial: { trialId: string; expected?: unknown } }>(socket, 'challenge-rush:trial');
    assert.equal((await emitAck(socket, 'challenge-rush:match:pause', { matchId: match.matchId, playerId })).ok, true);
    const resumed = await resumedEvent;
    assert.equal(resumed.trial.trialId, firstTrial.trialId);
    assert.equal(resumed.trial.expected, undefined);

    socket.close();
    const replacement = ioClient(server.baseUrl, { transports: ['websocket'], reconnection: false, auth: { playerId } });
    const reconnectedTrial = nextEvent<{ trial: { trialId: string; expected?: unknown } }>(replacement, 'challenge-rush:trial');
    await new Promise<void>((resolve, reject) => { replacement.once('connect', () => resolve()); replacement.once('connect_error', reject); });
    try {
      const replay = await reconnectedTrial;
      assert.equal(replay.trial.trialId, firstTrial.trialId);
      assert.equal(replay.trial.expected, undefined);
      const result = await emitAck(replacement, 'challenge-rush:challenge:input', { matchId: match.matchId, playerId, challengeIndex: playing.challengeIndex, trialId: firstTrial.trialId, action: 'timeout' });
      assert.equal(result.ok, true);
    } finally {
      replacement.close();
    }
  } finally {
    socket.close(); server.io.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); clearLobbyMemberships();
  }
});

// Each data-minimization assertion starts the relevant challenge directly so
// it cannot depend on, or wait for, a random full-catalog ordering.
async function assertStepBasedDataMinimization(server: { baseUrl: string }, targetKey: ChallengeKey, verify: (data: Record<string, unknown>) => void): Promise<void> {
  clearLobbyMemberships();
  const socket = await connect(server.baseUrl);
  try {
    const { playing } = await startSelectedChallenge(socket, server.baseUrl, `CR Data Min ${targetKey}`, targetKey);
    verify(playing.challenge.data);
  } finally {
    socket.close();
    clearLobbyMemberships();
  }
}

test('Challenge Rush never sends the full future rounds for the current step-based challenge', async () => {
  const server = await makeServer();
  try {
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

test('Challenge Rush detaches forfeited players and rejects reconnects to their old match', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const hostId = await player(server.baseUrl, 'Challenge Rush Detached Host');
  const guestId = await player(server.baseUrl, 'Challenge Rush Detached Guest');
  const hostSocket = await connect(server.baseUrl, hostId);
  const guestSocket = await connect(server.baseUrl, guestId);
  let lateSocket: ClientSocket | null = null;
  try {
    const created = await emitAck(hostSocket, 'challenge-rush:lobby:create', { playerId: hostId });
    await emitAck(guestSocket, 'challenge-rush:lobby:join', { lobbyId: created.lobbyId, playerId: guestId });
    await emitAck(guestSocket, 'challenge-rush:lobby:ready', { lobbyId: created.lobbyId, playerId: guestId, ready: true });
    const started = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:start');
    await emitAck(hostSocket, 'challenge-rush:lobby:start', { lobbyId: created.lobbyId, playerId: hostId });
    const match = await started;
    await nextState(hostSocket, (state) => state.phase === 'playing');

    const forfeitedState = nextState(
      hostSocket,
      (state) => state.matchId === match.matchId
        && state.scores.some((score) => score.playerId === guestId && score.forfeited && !score.connected),
    );
    assert.equal((await emitAck(guestSocket, 'challenge-rush:match:leave', { matchId: match.matchId, playerId: guestId })).ok, true);
    await forfeitedState;

    const reconnect = await emitAck(guestSocket, 'challenge-rush:match:reconnect', { matchId: match.matchId, playerId: guestId });
    assert.equal(reconnect.ok, false);

    const newLobby = await emitAck(guestSocket, 'challenge-rush:lobby:create', { playerId: guestId });
    assert.equal(newLobby.ok, true);

    let staleEvents = 0;
    const countStaleEvent = (payload: { matchId?: string }) => {
      if (payload.matchId === match.matchId) staleEvents += 1;
    };
    guestSocket.on('challenge-rush:state', countStaleEvent);
    guestSocket.on('challenge-rush:match:end', countStaleEvent);

    lateSocket = ioClient(server.baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { playerId: guestId },
      autoConnect: false,
    });
    lateSocket.on('challenge-rush:match:start', countStaleEvent);
    lateSocket.on('challenge-rush:state', countStaleEvent);
    const lateConnected = nextEvent(lateSocket, 'connect');
    lateSocket.connect();
    await lateConnected;

    const ended = nextEvent<{ matchId: string }>(hostSocket, 'challenge-rush:match:end');
    assert.equal((await emitAck(hostSocket, 'challenge-rush:match:finish', { matchId: match.matchId, playerId: hostId })).ok, true);
    await ended;
    await sleep(25);
    assert.equal(staleEvents, 0);
  } finally {
    lateSocket?.close();
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
