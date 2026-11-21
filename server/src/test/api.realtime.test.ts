// Integration tests for Socket.IO delivery, including group broadcasts and
// the transport/authentication wiring used by other realtime features.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp } from './testApp';
import { setIo, Events, createSocketAuthGuard, registerScopedSockets } from '../realtime';
import { arcadeWatcherPlayerIds, broadcastArcadeKiosk, registerArcadeSockets } from '../arcade/realtime';
import { registerTetrisSockets } from '../arcade/tetris';
import { clearLobbyMemberships } from '../arcade/lobbyMembership';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';
import { ensureAccountEventContext } from '../eventContext';
import { createSession, SESSION_COOKIE_NAME } from '../sessions';
import { nanoid } from 'nanoid';

async function withServer(fn: (baseUrl: string, io: Server) => Promise<void>): Promise<void> {
  const app = createTestApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard(''));
  registerScopedSockets(io);
  registerArcadeSockets(io);
  setIo(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl, io);
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    setIo(null);
  }
}

function socketAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function connectClient(baseUrl: string, sessionToken?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      ...(sessionToken ? { extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` } } : {}),
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

test('a new broadcast reaches every subscribed group member with its public payload', async () => {
  await withServer(async (baseUrl) => {
    const player = await request(baseUrl).post('/api/players').send({ name: 'Realtime Test Player 2' });
    assert.equal(player.status, 201);
    const sessionToken = createSession(player.body.id);
    const clientA = await connectClient(baseUrl, sessionToken);
    const clientB = await connectClient(baseUrl, sessionToken);
    try {
      await socketAck(clientA, 'scope:subscribe', { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
      await socketAck(clientB, 'scope:subscribe', { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
      const received: unknown[] = [];
      clientA.on(Events.broadcastNew, (payload) => received.push(payload));
      clientB.on(Events.broadcastNew, (payload) => received.push(payload));

      const sent = await request(baseUrl)
        .post('/api/broadcasts')
        .send({ playerId: player.body.id, message: 'Zweite Durchsage' });
      assert.equal(sent.status, 201);

      // The HTTP response is produced after the route has emitted. Give both
      // clients one event-loop turn to consume their queued packets.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(received.length, 2);
      for (const payload of received as Array<Record<string, unknown>>) {
        assert.equal(payload.id, sent.body.id);
        assert.equal(payload.playerId, player.body.id);
        assert.equal(payload.playerName, 'Realtime Test Player 2');
        assert.equal(payload.message, 'Zweite Durchsage');
        assert.equal('recipientIds' in payload, false, 'recipient snapshots stay in the REST response');
      }
    } finally {
      clientA.close();
      clientB.close();
    }
  });
});

async function withGuardedServer(
  kioskToken: string,
  fn: (baseUrl: string, io: Server) => Promise<void>
): Promise<void> {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard(kioskToken));

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl, io);
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

test('a finished Captain Draft reaches every device as the current draw', async () => {
  await withServer(async (baseUrl) => {
    const ids: string[] = [];
    for (const name of ['Draft Live A', 'Draft Live B', 'Draft Live C', 'Draft Live D']) {
      const player = await request(baseUrl).post('/api/players').send({ name });
      ids.push(player.body.id);
    }
    const games = await request(baseUrl).get('/api/games');
    const gameId = games.body[0].id;
    const client = await connectClient(baseUrl, createSession(ids[0]));
    try {
      await socketAck(client, 'scope:subscribe', { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
      const generated = new Promise<Record<string, unknown>>((resolve) => {
        client.on(Events.matchmakingGenerated, (payload) => resolve(payload));
      });

      const started = await request(baseUrl)
        .post('/api/draft/start')
        .send({ gameId, captainIds: [ids[0], ids[1]], poolPlayerIds: [ids[2], ids[3]] });
      assert.equal(started.status, 201, JSON.stringify(started.body));
      // Captain A picks one; the last pool player is auto-assigned, which
      // completes the draft.
      const picked = await request(baseUrl).post('/api/draft/pick').send({ playerId: ids[0], pickPlayerId: ids[2] });
      assert.equal(picked.status, 200, JSON.stringify(picked.body));

      const draw = await generated;
      assert.equal(draw.source, 'draft');
      assert.equal(draw.gameId, gameId);
      assert.equal(draw.matchId, null);
      assert.equal(draw.tournamentId, null);
      const history = await request(baseUrl).get(`/api/matchmaking/history?gameId=${gameId}`);
      assert.ok(history.body.history.some((entry: { id: string }) => entry.id === draw.id), 'the broadcast draw is the stored one');
    } finally {
      client.close();
    }
  });
});

async function expectRejectedHandshake(
  baseUrl: string,
  options: Parameters<typeof ioClient>[1] = {},
): Promise<void> {
  const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false, ...options });
  try {
    const error = await new Promise<Error>((resolve, reject) => {
      socket.once('connect_error', resolve);
      socket.once('connect', () => reject(new Error('Unauthenticated handshake succeeded')));
    });
    assert.match(error.message, /unauthorized/);
  } finally {
    socket.close();
  }
}

test('socket handshake rejects a wrong kiosk token, a token without kiosk mode and an invalid session', async () => {
  await withGuardedServer('kiosk-token', async (baseUrl) => {
    await expectRejectedHandshake(baseUrl, { auth: { kiosk: true, token: 'wrong-token' } });
    await expectRejectedHandshake(baseUrl, { auth: { token: 'kiosk-token' } });
    await expectRejectedHandshake(baseUrl, {
      extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=not-a-real-token` },
    });
  });
});

test('socket handshake rejects an anonymous client when no kiosk token is configured', async () => {
  await withGuardedServer('', (baseUrl) => expectRejectedHandshake(baseUrl));
});

test('socket auth accepts a personal session and binds payload identity to it', async () => {
  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    `Required Socket Player ${playerId}`,
    nanoid(24),
    Date.now(),
  );
  const sessionToken = createSession(playerId);

  await withGuardedServer('kiosk-token', async (baseUrl, io) => {
    io.on('connection', (socket) => {
      socket.on('identity:test', (payload: { playerId?: string }, ack: (value: string | undefined) => void) => {
        ack(payload.playerId);
      });
    });
    const client = await connectClient(baseUrl, sessionToken);
    try {
      assert.equal(await socketAck(client, 'identity:test', { playerId: 'other-player' }), playerId);
    } finally {
      client.close();
    }
  });
});

test('a read-only kiosk socket can subscribe but cannot reach mutation handlers', async () => {
  await withGuardedServer('kiosk-token', async (baseUrl, io) => {
    let mutationReachedHandler = false;
    io.on('connection', (socket) => {
      socket.on('kiosk:subscribe', (ack: (value: string) => void) => ack('ok'));
      socket.on('identity:test', () => {
        mutationReachedHandler = true;
      });
    });
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: 'kiosk-token', kiosk: true },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      socket.emit('identity:test', {});
      // This acknowledgement comes after the mutation on the same connection.
      assert.equal(await socket.timeout(2_000).emitWithAck('kiosk:subscribe'), 'ok');
      assert.equal(mutationReachedHandler, false);
    } finally {
      socket.close();
    }
  });
});

test('logging out actively disconnects sockets authenticated by that session', async () => {
  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    `Realtime Logout Test ${playerId}`,
    nanoid(24),
    Date.now()
  );
  const sessionToken = createSession(playerId);

  await withServer(async (baseUrl) => {
    const socket = await connectClient(baseUrl, sessionToken);
    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    const logout = await request(baseUrl)
      .post('/api/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionToken}`);
    assert.equal(logout.status, 204);
    assert.equal(await disconnected, 'io server disconnect');
    assert.equal(socket.connected, false);
  });
});

test('hard-deleting a test player immediately disconnects their authenticated sockets', async () => {
  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, is_test, created_at) VALUES (?, ?, ?, 1, ?)').run(
    playerId,
    `Realtime Deleted Test ${playerId}`,
    nanoid(24),
    Date.now()
  );
  const sessionToken = createSession(playerId);

  await withServer(async (baseUrl) => {
    const socket = await connectClient(baseUrl, sessionToken);
    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    const removed = await request(baseUrl).delete(`/api/players/${playerId}`);
    assert.equal(removed.status, 204, JSON.stringify(removed.body));
    assert.equal(await disconnected, 'io server disconnect');
  });
});

test('arcade watch list removes a finished match instead of re-adding a blank ghost entry', async () => {
  await withServer(async (baseUrl, io) => {
    const viewer = await request(baseUrl).post('/api/players').send({ name: 'Watch Finished Viewer' });
    const client = await connectClient(baseUrl, createSession(viewer.body.id));
    await socketAck(client, 'scope:subscribe', { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });

    try {
    const matchId = 'watch-finished-match';
    const listed = new Promise<Array<{ matchId: string; gameType: string }>>((resolve) => {
      client.on('arcade:watch:list', (payload: { matches?: Array<{ matchId: string; gameType: string }> }) => {
        if (payload.matches?.some((match) => match.matchId === matchId)) resolve(payload.matches);
      });
    });
    broadcastArcadeKiosk(io, {
      matchId,
      gameType: 'pong',
      groupId: DEFAULT_GROUP_ID,
      eventId: BASE_EVENT_ID,
      running: true,
      players: [{ id: viewer.body.id, name: 'Watch Finished Viewer' }],
      scores: [{ playerId: viewer.body.id, name: 'Watch Finished Viewer', score: 0 }],
    });
    assert.equal((await listed).find((match) => match.matchId === matchId)?.gameType, 'pong');

    const joined = new Promise<unknown>((resolve) => client.emit('arcade:watch:join', { matchId }, resolve));
    assert.deepEqual(await joined, { ok: true, matchId, votingPlayerId: null, canVote: false });

    const ended = new Promise<{ matchId: string }>((resolve) => client.on('arcade:watch:ended', resolve));
    const cleared = new Promise<Array<{ matchId?: string; gameType?: string }>>((resolve) => {
      client.on('arcade:watch:list', (payload: { matches?: Array<{ matchId?: string; gameType?: string }> }) => {
        if (!payload.matches?.some((match) => match.matchId === matchId)) resolve(payload.matches ?? []);
      });
    });

    broadcastArcadeKiosk(io, { gameType: null, matchId, groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });

    assert.deepEqual(await ended, { matchId });
    assert.equal((await cleared).some((match) => match.matchId === matchId || match.gameType === null), false);
    } finally {
      client.close();
    }
  });
});

test('arcade watcher voting uses the authenticated spectator identity', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const participantId = `watch-participant-${suffix}`;
  const spectatorId = `watch-spectator-${suffix}`;
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(participantId, 'Watch Participant', participantId, Date.now());
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(spectatorId, 'Watch Spectator', spectatorId, Date.now());
  const now = Date.now();
  db.prepare("INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)")
    .run(DEFAULT_GROUP_ID, participantId, now);
  db.prepare("INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)")
    .run(DEFAULT_GROUP_ID, spectatorId, now);
  ensureAccountEventContext(participantId);
  ensureAccountEventContext(spectatorId);

  await withServer(async (baseUrl, io) => {
    const participant = await connectClient(baseUrl, createSession(participantId));
    const spectator = await connectClient(baseUrl, createSession(spectatorId));
    await socketAck(participant, 'scope:subscribe', { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
    await socketAck(spectator, 'scope:subscribe', { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
    const matchId = `watch-voting-${suffix}`;
    try {
    broadcastArcadeKiosk(io, {
      matchId,
      gameType: 'scribble',
      groupId: DEFAULT_GROUP_ID,
      eventId: BASE_EVENT_ID,
      phase: 'drawing',
      players: [{ id: participantId, name: 'Watch Participant' }],
      strokes: [],
    });

    const participantJoin = await new Promise<unknown>((resolve) => {
      participant.emit('arcade:watch:join', { matchId, playerId: spectatorId }, resolve);
    });
    assert.deepEqual(participantJoin, { ok: true, matchId, votingPlayerId: null, canVote: false });
    assert.deepEqual(arcadeWatcherPlayerIds(io, matchId), []);

    const spectatorJoin = await new Promise<unknown>((resolve) => {
      spectator.emit('arcade:watch:join', { matchId, playerId: participantId }, resolve);
    });
    assert.deepEqual(spectatorJoin, { ok: true, matchId, votingPlayerId: spectatorId, canVote: true });
    assert.deepEqual(arcadeWatcherPlayerIds(io, matchId), [spectatorId]);
    } finally {
      broadcastArcadeKiosk(io, { gameType: null, matchId, groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID });
      participant.close();
      spectator.close();
    }
  });
  db.prepare('DELETE FROM players WHERE id IN (?, ?)').run(participantId, spectatorId);
});

// A game action pressed while the socket is still connecting is buffered by
// the client and sent right after the handshake — before the client's own
// 'connect' listener can emit scope:subscribe. The scope therefore has to come
// with the handshake itself, or such an action is rejected as out of scope
// (seen as a Tetris lobby that never opened in the six-player Arena E2E test).
test('an action queued before the handshake already runs in the handshake scope', async () => {
  clearLobbyMemberships();
  const app = createTestApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard(''));
  registerScopedSockets(io);
  registerTetrisSockets(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const player = await request(baseUrl).post('/api/players').send({ name: 'Realtime Queued Host' });
  assert.equal(player.status, 201);
  const socket = ioClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    auth: { groupId: DEFAULT_GROUP_ID },
    extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${createSession(player.body.id)}` },
  });
  try {
    const created = socketAck<{ ok: boolean; error?: string }>(socket, 'tetris:lobby:create', {
      playerId: player.body.id,
      mode: 'arena',
    });
    socket.connect();
    const result = await created;
    assert.equal(result.error, undefined);
    assert.equal(result.ok, true);
  } finally {
    socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearLobbyMemberships();
  }
});
