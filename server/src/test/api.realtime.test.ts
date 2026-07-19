// Integration tests for the realtime path itself. Phase 5c deliberately
// keeps organisation communication data-only, while the remaining tests
// verify the Socket.IO wiring used by features that already deliver events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { setIo, Events, createSocketAuthGuard, registerArcadeKioskSockets, broadcastArcadeKiosk, arcadeWatcherPlayerIds } from '../realtime';
import { db } from '../db';
import { createSession, SESSION_COOKIE_NAME } from '../sessions';
import { nanoid } from 'nanoid';

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard(''));
  setIo(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    setIo(null);
  }
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

test('stored broadcasts do not deliver a Socket.IO event in Phase 5c', async () => {
  await withServer(async (baseUrl) => {
    const clientA = await connectClient(baseUrl);
    const clientB = await connectClient(baseUrl);
    try {
      let received = 0;
      clientA.on(Events.broadcastNew, () => { received += 1; });
      clientB.on(Events.broadcastNew, () => { received += 1; });

      const player = await request(baseUrl).post('/api/players').send({ name: 'Realtime Test Player 2' });
      assert.equal(player.status, 201);
      const sent = await request(baseUrl)
        .post('/api/broadcasts')
        .send({ playerId: player.body.id, message: 'Zweite Durchsage' });
      assert.equal(sent.status, 201);

      // The HTTP response is produced after the route has finished. Give any
      // accidentally queued Socket.IO packets one event-loop turn to arrive.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(received, 0);
    } finally {
      clientA.close();
      clientB.close();
    }
  });
});

async function withGuardedServer(
  accessToken: string,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard(accessToken));

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

test('createSocketAuthGuard rejects a socket connecting with the wrong access token', async () => {
  await withGuardedServer('secret-token', async (baseUrl) => {
    const rejected = new Promise<Error>((resolve) => {
      const socket = ioClient(baseUrl, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: 'wrong-token' },
      });
      socket.on('connect_error', (err) => resolve(err));
      socket.on('connect', () => socket.close());
    });
    const err = await rejected;
    assert.match(err.message, /unauthorized/);
  });
});

test('createSocketAuthGuard accepts a socket connecting with the right access token', async () => {
  await withGuardedServer('secret-token', async (baseUrl) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: 'secret-token' },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
      });
      assert.ok(socket.connected);
    } finally {
      socket.close();
    }
  });
});

test('createSocketAuthGuard lets any socket through when no access token is configured', async () => {
  await withGuardedServer('', async (baseUrl) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
      });
      assert.ok(socket.connected);
    } finally {
      socket.close();
    }
  });
});

test('createSocketAuthGuard accepts a socket carrying a valid session cookie instead of the token', async () => {
  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    `Realtime Session Test ${playerId}`,
    nanoid(24),
    Date.now()
  );
  const sessionToken = createSession(playerId);

  await withGuardedServer('secret-token', async (baseUrl) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
      });
      assert.ok(socket.connected);
    } finally {
      socket.close();
    }
  });
});

test('required socket auth rejects shared-token-only clients and binds payload identity to the session', async () => {
  const playerId = nanoid();
  const spoofedPlayerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    `Required Socket Player ${playerId}`,
    nanoid(24),
    Date.now()
  );
  const sessionToken = createSession(playerId);

  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard('secret-token', 'required'));
  io.on('connection', (socket) => {
    socket.on('identity:test', (payload: { playerId?: string }, ack: (value: string | undefined) => void) => {
      ack(payload.playerId);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const tokenOnly = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: 'secret-token' },
    });
    const rejected = await new Promise<Error>((resolve) => tokenOnly.once('connect_error', resolve));
    assert.match(rejected.message, /unauthorized/);
    tokenOnly.close();

    const sessionClient = await connectClient(baseUrl, sessionToken);
    const resolvedPlayerId = await new Promise<string | undefined>((resolve) => {
      sessionClient.emit('identity:test', { playerId: spoofedPlayerId }, resolve);
    });
    assert.equal(resolvedPlayerId, playerId);
    sessionClient.close();
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('required socket auth accepts a read-only kiosk token and rejects mutation events', async () => {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use(createSocketAuthGuard('legacy-token', 'required', 'kiosk-token'));
  let mutationReachedHandler = false;
  io.on('connection', (socket) => {
    socket.on('kiosk:subscribe', (ack?: (value: string) => void) => ack?.('ok'));
    socket.on('identity:test', () => {
      mutationReachedHandler = true;
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
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
    const subscribed = await new Promise<string>((resolve) => socket.emit('kiosk:subscribe', resolve));
    assert.equal(subscribed, 'ok');
    socket.emit('identity:test', {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(mutationReachedHandler, false);
  } finally {
    socket.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
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

test('createSocketAuthGuard rejects a socket with neither a valid token nor a valid session cookie', async () => {
  await withGuardedServer('secret-token', async (baseUrl) => {
    const rejected = new Promise<Error>((resolve) => {
      const socket = ioClient(baseUrl, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=not-a-real-token` },
      });
      socket.on('connect_error', (err) => resolve(err));
      socket.on('connect', () => socket.close());
    });
    const err = await rejected;
    assert.match(err.message, /unauthorized/);
  });
});

test('arcade watch list removes a finished match instead of re-adding a blank ghost entry', async () => {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  registerArcadeKioskSockets(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });

  try {
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });

    const matchId = 'watch-finished-match';
    const listed = new Promise<Array<{ matchId: string; gameType: string }>>((resolve) => {
      client.on('arcade:watch:list', (payload: { matches?: Array<{ matchId: string; gameType: string }> }) => {
        if (payload.matches?.some((match) => match.matchId === matchId)) resolve(payload.matches);
      });
    });
    broadcastArcadeKiosk(io, {
      matchId,
      gameType: 'pong',
      running: true,
      players: [{ id: 'p1', name: 'Pong One' }],
      scores: [{ playerId: 'p1', name: 'Pong One', score: 0 }],
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

    broadcastArcadeKiosk(io, { gameType: null, matchId });

    assert.deepEqual(await ended, { matchId });
    assert.equal((await cleared).some((match) => match.matchId === matchId || match.gameType === null), false);
  } finally {
    client.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('arcade watchers may vote under a real non-participant identity, but participants get no second vote', async () => {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  registerArcadeKioskSockets(io);
  const suffix = `${Date.now()}-${Math.random()}`;
  const participantId = `watch-participant-${suffix}`;
  const spectatorId = `watch-spectator-${suffix}`;
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(participantId, 'Watch Participant', participantId, Date.now());
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(spectatorId, 'Watch Spectator', spectatorId, Date.now());

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });

  try {
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    const matchId = `watch-voting-${suffix}`;
    broadcastArcadeKiosk(io, {
      matchId,
      gameType: 'scribble',
      phase: 'drawing',
      players: [{ id: participantId, name: 'Watch Participant' }],
      strokes: [],
    });

    const participantJoin = await new Promise<unknown>((resolve) => {
      client.emit('arcade:watch:join', { matchId, playerId: participantId }, resolve);
    });
    assert.deepEqual(participantJoin, { ok: true, matchId, votingPlayerId: null, canVote: false });
    assert.deepEqual(arcadeWatcherPlayerIds(io, matchId), []);

    const spectatorJoin = await new Promise<unknown>((resolve) => {
      client.emit('arcade:watch:join', { matchId, playerId: spectatorId }, resolve);
    });
    assert.deepEqual(spectatorJoin, { ok: true, matchId, votingPlayerId: spectatorId, canVote: true });
    assert.deepEqual(arcadeWatcherPlayerIds(io, matchId), [spectatorId]);
  } finally {
    client.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    db.prepare('DELETE FROM players WHERE id IN (?, ?)').run(participantId, spectatorId);
  }
});
