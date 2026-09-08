import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { registerSocketFeatures } from './index';

test('normal startup shares one connection listener and removes it on every shutdown', async () => {
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const httpServer = http.createServer();
    const io = new Server(httpServer);
    registerSocketFeatures(io);

    assert.equal(io.sockets.listenerCount('connection'), 1);
    assert.throws(() => registerSocketFeatures(io), /scope.*bereits registriert/);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    await io.close();

    assert.equal(io.sockets.listenerCount('connection'), 0);
  }
});
