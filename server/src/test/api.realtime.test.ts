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
import { setIo, Events, createSocketAuthGuard } from '../realtime';

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  setIo(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    setIo(null as any);
  }
}

function connectClient(baseUrl: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], reconnection: false });
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
