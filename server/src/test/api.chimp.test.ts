import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, installTestSocketIdentity } from './testApp';
import { registerChimpSockets } from '../arcade/chimp';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { db } from '../db';

process.env.NODE_ENV = 'test';

type Ack = { ok: boolean; error?: string; result?: string; ignored?: boolean; me?: Me; [key: string]: unknown };
interface Me {
  phase: string; level: number; strikes: number; bestLevel: number; clicked: number; levelToken: string; lastOutcome: string | null;
  numbers?: Array<{ cell: number; number: number }>; hiddenCells?: number[];
}
interface State { matchId: string; phase: string; paused: boolean; me: Me | null; standings: Array<{ playerId: string; status: string; bestLevel: number }> }

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

function nextEvent<T>(socket: ClientSocket, event: string, predicate: (payload: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve) => {
    const listener = (payload: T) => { if (predicate(payload)) { socket.off(event, listener); resolve(payload); } };
    socket.on(event, listener);
  });
}

const nextState = (socket: ClientSocket, predicate: (state: State) => boolean) => nextEvent<State>(socket, 'chimp:state', predicate);

function makeServer(authenticatedSockets = false): Promise<{ httpServer: http.Server; io: Server; baseUrl: string }> {
  const httpServer = http.createServer(createTestApp());
  const io = new Server(httpServer);
  installTestSocketIdentity(io);
  if (authenticatedSockets) io.use((socket, next) => { socket.data.authPlayerId = socket.handshake.auth.playerId; next(); });
  registerChimpSockets(io);
  return new Promise((resolve) => httpServer.listen(0, () => resolve({ httpServer, io, baseUrl: `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}` })));
}

async function closeServer(server: { httpServer: http.Server; io: Server }, sockets: ClientSocket[]): Promise<void> {
  for (const socket of sockets) socket.close();
  server.io.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  clearLobbyMemberships();
}

async function player(baseUrl: string, name: string): Promise<string> {
  const response = await request(baseUrl).post('/api/players').send({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  assert.equal(response.status, 201);
  return response.body.id as string;
}

// Opens a lobby for the given players (host first), starts it and resolves
// with every player's first playing state.
async function startRound(sockets: ClientSocket[], playerIds: string[]): Promise<{ matchId: string; states: State[] }> {
  const created = await emitAck(sockets[0], 'chimp:lobby:create', { playerId: playerIds[0] });
  assert.equal(created.ok, true);
  for (let index = 1; index < sockets.length; index += 1) {
    assert.equal((await emitAck(sockets[index], 'chimp:lobby:join', { lobbyId: created.lobbyId, playerId: playerIds[index] })).ok, true);
    assert.equal((await emitAck(sockets[index], 'chimp:lobby:ready', { lobbyId: created.lobbyId, playerId: playerIds[index], ready: true })).ok, true);
  }
  const playing = sockets.map((socket) => nextState(socket, (state) => state.phase === 'playing' && state.me?.phase === 'memorize'));
  const started = await emitAck(sockets[0], 'chimp:lobby:start', { lobbyId: created.lobbyId, playerId: playerIds[0] });
  assert.equal(started.ok, true);
  return { matchId: started.matchId as string, states: await Promise.all(playing) };
}

function layoutOf(me: Me): number[] {
  return [...(me.numbers ?? [])].sort((a, b) => a.number - b.number).map((entry) => entry.cell);
}

function click(socket: ClientSocket, matchId: string, playerId: string, me: Me, cell: number): Promise<Ack> {
  return emitAck(socket, 'chimp:click', { matchId, playerId, levelToken: me.levelToken, cell });
}

test('a shared Chimp round stores every run as a solo result and shows the round ranking only at the end', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const hostSocket = await connect(server.baseUrl);
  const guestSocket = await connect(server.baseUrl);
  const guestReveals: unknown[] = [];
  const spectatorPayloads: string[] = [];
  guestSocket.on('chimp:reveal', (payload) => guestReveals.push(payload));
  guestSocket.on('arcade:kiosk:game', (payload) => spectatorPayloads.push(JSON.stringify(payload)));
  try {
    const hostId = await player(server.baseUrl, 'Chimp Host');
    const guestId = await player(server.baseUrl, 'Chimp Guest');
    const { matchId, states: [hostState, guestState] } = await startRound([hostSocket, guestSocket], [hostId, guestId]);
    assert.equal(hostState.me?.level, 4);
    assert.notDeepEqual(layoutOf(hostState.me!), layoutOf(guestState.me!));

    // Level 4 in order. After the first tap the numbers are gone for good.
    const layout = layoutOf(hostState.me!);
    const first = await click(hostSocket, matchId, hostId, hostState.me!, layout[0]);
    assert.equal(first.result, 'correct');
    assert.equal(first.me?.numbers, undefined);
    assert.deepEqual(first.me?.hiddenCells, [...layout.slice(1)].sort((a, b) => a - b));
    for (const cell of layout.slice(1, 3)) assert.equal((await click(hostSocket, matchId, hostId, hostState.me!, cell)).result, 'correct');
    const completed = await click(hostSocket, matchId, hostId, hostState.me!, layout[3]);
    assert.equal(completed.result, 'level-complete');
    assert.equal(completed.me?.phase, 'interstitial');

    // Three wrong taps at level 5: every reveal goes to the host only.
    const hostRunEnd = nextEvent<{ result: { level: number; strikesAtLevel: number; totalStrikes: number; rating: { tier: string } }; newBest: boolean; reason: string }>(hostSocket, 'chimp:run:end');
    let current = completed.me!;
    for (let strike = 1; strike <= 3; strike += 1) {
      const memorize = nextState(hostSocket, (state) => state.me?.phase === 'memorize');
      assert.equal((await emitAck(hostSocket, 'chimp:continue', { matchId, playerId: hostId, levelToken: current.levelToken })).ok, true);
      current = (await memorize).me!;
      assert.equal(current.level, 5);
      const reveal = nextEvent<{ layout: number[]; wrongCell: number; expectedNumber: number }>(hostSocket, 'chimp:reveal');
      const guestSawStrike = nextEvent<{ standings: Array<{ playerId: string; strikes: number }> }>(guestSocket, 'chimp:standings', (payload) => payload.standings.some((entry) => entry.playerId === hostId && entry.strikes === strike));
      const wrong = layoutOf(current)[1];
      assert.equal((await click(hostSocket, matchId, hostId, current, wrong)).result, 'strike');
      assert.deepEqual(await reveal, { matchId, layout: layoutOf(current), wrongCell: wrong, expectedNumber: 1 });
      // Standings follow the reveal on the guest's own connection, so a
      // reveal sent there would already have arrived.
      await guestSawStrike;
      if (strike < 3) current = (await nextState(hostSocket, (state) => state.me?.phase === 'interstitial')).me!;
    }
    const hostRun = await hostRunEnd;
    assert.deepEqual([hostRun.reason, hostRun.result.level, hostRun.result.strikesAtLevel, hostRun.result.totalStrikes, hostRun.result.rating.tier, hostRun.newBest], ['strikes', 4, 0, 3, 'Zoobesucher', true]);
    assert.deepEqual(guestReveals, []);
    // Watch and kiosk payloads only carry progress counters, never cells.
    assert.ok(spectatorPayloads.length > 0);
    assert.ok(spectatorPayloads.every((payload) => !/"(numbers|layout|hiddenCells|cell|wrongCell)"/.test(payload)));

    // The host ends the round; the guest's open run keeps its level 0.
    const ended = nextEvent<{ reason: string; ranking: Array<{ playerId: string; place: number; level: number }> }>(guestSocket, 'chimp:match:end');
    assert.equal((await emitAck(hostSocket, 'chimp:match:finish', { matchId, playerId: hostId })).ok, true);
    const end = await ended;
    assert.equal(end.reason, 'ended-by-host');
    assert.deepEqual(end.ranking.map((entry) => [entry.playerId, entry.place, entry.level]), [[hostId, 1, 4], [guestId, 2, 0]]);

    const rows = db.prepare("SELECT id, winner_id, reason, scores FROM arcade_results WHERE game_type = 'chimp' AND source_match_id LIKE ? ORDER BY ended_at").all(`${matchId}:%`) as Array<{ id: string; winner_id: string | null; reason: string; scores: string }>;
    assert.deepEqual(rows.map((row) => [row.winner_id, row.reason, JSON.parse(row.scores).length]), [[null, 'strikes', 1], [null, 'ended-by-host', 1]]);
    const winners = db.prepare(`SELECT COUNT(*) AS count FROM arcade_result_participants WHERE result_id IN (${rows.map(() => '?').join(',')}) AND is_winner = 1`).get(...rows.map((row) => row.id)) as { count: number };
    assert.equal(winners.count, 0);
  } finally {
    await closeServer(server, [hostSocket, guestSocket]);
  }
});

test('reconnect, reload and pause hand back the very same attempt instead of a free retry', async () => {
  clearLobbyMemberships();
  const server = await makeServer(true);
  const playerId = await player(server.baseUrl, 'Chimp Reconnect');
  let socket = await connect(server.baseUrl, playerId);
  try {
    const { matchId, states: [state] } = await startRound([socket], [playerId]);
    const layout = layoutOf(state.me!);
    const first = await click(socket, matchId, playerId, state.me!, layout[0]);
    const attempt = { levelToken: first.me!.levelToken, hiddenCells: first.me!.hiddenCells };

    socket.close();
    socket = await connect(server.baseUrl, playerId);
    const reconnectState = nextState(socket, () => true);
    assert.equal((await emitAck(socket, 'chimp:match:reconnect', { matchId, playerId })).ok, true);
    const reloaded = (await reconnectState).me!;
    assert.deepEqual({ levelToken: reloaded.levelToken, hiddenCells: reloaded.hiddenCells, numbers: reloaded.numbers }, { ...attempt, numbers: undefined });

    const paused = await emitAck(socket, 'chimp:match:pause', { matchId, playerId });
    assert.equal(paused.paused, true);
    assert.equal((await click(socket, matchId, playerId, first.me!, layout[1])).ok, false);
    const resumedState = nextState(socket, (next) => next.paused === false);
    assert.equal((await emitAck(socket, 'chimp:match:pause', { matchId, playerId })).paused, false);
    const resumed = (await resumedState).me!;
    assert.deepEqual({ levelToken: resumed.levelToken, hiddenCells: resumed.hiddenCells, phase: resumed.phase, strikes: resumed.strikes, numbers: resumed.numbers }, { ...attempt, phase: 'input', strikes: 0, numbers: undefined });

    // The remaining numbers of the original layout still complete the level.
    for (const cell of layout.slice(1, 3)) assert.equal((await click(socket, matchId, playerId, resumed, cell)).result, 'correct');
    assert.equal((await click(socket, matchId, playerId, resumed, layout[3])).result, 'level-complete');
  } finally {
    await closeServer(server, [socket]);
  }
});

test('inactivity only strikes after the first tap, never while memorizing', async () => {
  clearLobbyMemberships();
  process.env.CHIMP_INACTIVITY_MS = '150';
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Chimp Idle');
    const { matchId, states: [state] } = await startRound([socket], [playerId]);
    // Lets the real inactivity deadline (150 ms in this test) pass twice
    // while the numbers are still shown: memorizing has no time limit.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const layout = layoutOf(state.me!);
    const first = await click(socket, matchId, playerId, state.me!, layout[0]);
    assert.deepEqual([first.result, first.me?.strikes], ['correct', 0]);
    // During the input phase the same deadline is a strike.
    const reveal = await nextEvent<{ wrongCell: number | null; expectedNumber: number }>(socket, 'chimp:reveal');
    assert.deepEqual([reveal.wrongCell, reveal.expectedNumber], [null, 2]);
  } finally {
    delete process.env.CHIMP_INACTIVITY_MS;
    await closeServer(server, [socket]);
  }
});

test('parallel taps and continues are applied exactly once', async () => {
  clearLobbyMemberships();
  const server = await makeServer();
  const socket = await connect(server.baseUrl);
  try {
    const playerId = await player(server.baseUrl, 'Chimp Parallel');
    const { matchId, states: [state] } = await startRound([socket], [playerId]);
    const layout = layoutOf(state.me!);
    const firstTaps = await Promise.all([0, 1].map(() => click(socket, matchId, playerId, state.me!, layout[0])));
    assert.deepEqual(firstTaps.map((ack) => ack.result ?? (ack.ignored ? 'ignored' : 'other')).sort(), ['correct', 'ignored']);
    for (const cell of layout.slice(1, 3)) await click(socket, matchId, playerId, state.me!, cell);
    const done = await click(socket, matchId, playerId, state.me!, layout[3]);
    const continues = await Promise.all([0, 1].map(() => emitAck(socket, 'chimp:continue', { matchId, playerId, levelToken: done.me!.levelToken })));
    assert.deepEqual(continues.map((ack) => Boolean(ack.ignored)).sort(), [false, true]);
    assert.ok(continues.every((ack) => ack.me?.level === 5 && ack.me?.phase === 'memorize'));
  } finally {
    await closeServer(server, [socket]);
  }
});
