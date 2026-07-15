// Integration test for the realtime push path itself. Every other
// integration test only proves that a route handler calls broadcast() (via
// mocking or by trusting the code); none of them prove that a connected
// Socket.IO client actually receives the event. Since "Realtime by default"
// is a core product principle (CLAUDE.md), this boots the real HTTP +
// Socket.IO wiring (the same shape as src/index.ts, minus the offline
// sweeper/process-crash handlers) and drives it with a real socket.io-client
// connection.

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

test('a broadcast triggered by an HTTP request reaches a connected socket.io client', async () => {
  await withServer(async (baseUrl) => {
    const client = await connectClient(baseUrl);
    try {
      const received = new Promise<unknown>((resolve) => {
        client.on(Events.broadcastNew, resolve);
      });

      const player = await request(baseUrl).post('/api/players').send({ name: 'Realtime Test Player' });
      assert.equal(player.status, 201);

      const send = await request(baseUrl)
        .post('/api/broadcasts')
        .send({ playerId: player.body.id, message: 'Pizza ist da!' });
      assert.equal(send.status, 201);

      const payload = (await received) as { message: string };
      assert.equal(payload.message, 'Pizza ist da!');
    } finally {
      client.close();
    }
  });
});

test('multiple connected clients all receive the same broadcast', async () => {
  await withServer(async (baseUrl) => {
    const clientA = await connectClient(baseUrl);
    const clientB = await connectClient(baseUrl);
    try {
      const receivedA = new Promise<unknown>((resolve) => clientA.on(Events.broadcastNew, resolve));
      const receivedB = new Promise<unknown>((resolve) => clientB.on(Events.broadcastNew, resolve));

      const player = await request(baseUrl).post('/api/players').send({ name: 'Realtime Test Player 2' });
      await request(baseUrl)
        .post('/api/broadcasts')
        .send({ playerId: player.body.id, message: 'Zweite Durchsage' });

      const [payloadA, payloadB] = (await Promise.all([receivedA, receivedB])) as Array<{ message: string }>;
      assert.equal(payloadA.message, 'Zweite Durchsage');
      assert.equal(payloadB.message, 'Zweite Durchsage');
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
