// Server entry point: takes the Express app and wires it into an HTTP server
// with Socket.IO (realtime push) and the offline sweeper, then listens.

import http from 'http';
import { Server } from 'socket.io';

import { config, productionConfigError } from './config';
import './db'; // side-effect: open DB, create schema, seed defaults
import { createApp } from './app';
import { setIo, createSocketAuthGuard, registerArcadeKioskSockets } from './realtime';
import { accessProtectionEnabled } from './auth';
import { startOfflineSweeper } from './liveStatus';
import { startArcadeHeartbeat } from './arcade/arcadeTracking';
import { registerArcadeSockets } from './arcade/arcade';
import { registerTetrisSockets } from './arcade/tetris';
import { registerScribbleSockets } from './arcade/scribble';
import { registerBlobbySockets } from './arcade/blobby';
import { registerPongSockets } from './arcade/pong';
import { registerSnakeSockets } from './arcade/snake';

const isProduction = process.env.NODE_ENV === 'production';

// Boots the full runtime: HTTP server + Socket.IO + offline sweeper + listen.
// Wrapped in a function guarded by require.main so importing this file (e.g.
// from a test) never binds a port or starts timers.
function start(): void {
  if (isProduction) {
    const error = productionConfigError();
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`FATAL: ${error}`);
      process.exit(1);
    }
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server);
  setIo(io);

  io.use(createSocketAuthGuard());
  registerArcadeKioskSockets(io);

  registerArcadeSockets(io);
  registerTetrisSockets(io);
  registerScribbleSockets(io);
  registerBlobbySockets(io);
  registerPongSockets(io);
  registerSnakeSockets(io);

  // Periodically flip stale players to offline.
  startOfflineSweeper(io);
  // Keeps players mid-arcade-match from being swept offline (arcade has no
  // agent report to keep live_status fresh — see arcadeTracking.ts).
  startArcadeHeartbeat();

  // Guard against unexpected crashes. On a friend's PC during a LAN party
  // there's no supervisor watching the process, so we log and keep going —
  // a dead server ends the party. In production the box runs the app under
  // Docker's restart policy, so exiting is the safer choice: a process stuck
  // after a partially-handled error is worse than a few seconds of restart.
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception:', err);
    if (isProduction) process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection:', reason);
    if (isProduction) process.exit(1);
  });

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`RespawnHQ server läuft auf http://localhost:${config.port}`);
    if (config.authMode === 'legacy' && !accessProtectionEnabled()) {
      // eslint-disable-next-line no-console
      console.log('Hinweis: Kein ACCESS_TOKEN gesetzt – Zugangsschutz ist deaktiviert.');
    }
  });
}

// Only start when run directly (node dist/index.js), not when imported.
if (require.main === module) {
  start();
}
