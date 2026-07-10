// Server entry point: takes the Express app and wires it into an HTTP server
// with Socket.IO (realtime push) and the offline sweeper, then listens.

import http from 'http';
import { Server } from 'socket.io';

import { config, productionConfigError } from './config';
import './db'; // side-effect: open DB, create schema, seed defaults
import { createApp } from './app';
import { setIo } from './realtime';
import { accessProtectionEnabled } from './auth';
import { startOfflineSweeper } from './liveStatus';
import { registerArcadeSockets } from './arcade/arcade';
import { registerTetrisSockets } from './arcade/tetris';
import { registerScribbleSockets } from './arcade/scribble';
import { registerBlobbySockets } from './arcade/blobby';

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

  // Socket.IO connections bypass Express middleware entirely, so the REST
  // access-token gate (requireAccess) never sees them. Without this check,
  // realtime data (live status, votes, leaderboard) would leak to anyone who
  // opens a WebSocket, even with ACCESS_TOKEN set — enforce the same shared
  // token here.
  io.use((socket, next) => {
    if (!config.accessToken) return next();
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    if (token === config.accessToken) return next();
    next(new Error('unauthorized'));
  });

  registerArcadeSockets(io);
  registerTetrisSockets(io);
  registerScribbleSockets(io);
  registerBlobbySockets(io);

  // Periodically flip stale players to offline.
  startOfflineSweeper(io);

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
    if (!accessProtectionEnabled()) {
      // eslint-disable-next-line no-console
      console.log('Hinweis: Kein ACCESS_TOKEN gesetzt – Zugangsschutz ist deaktiviert.');
    }
  });
}

// Only start when run directly (node dist/index.js), not when imported.
if (require.main === module) {
  start();
}
