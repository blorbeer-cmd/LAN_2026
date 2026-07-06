// Server entry point: wires up Express (REST + static frontend) and Socket.IO
// (realtime push). Feature routers are mounted under /api.

import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';

import { config } from './config';
import './db'; // side-effect: open DB, create schema, seed defaults
import { setIo } from './realtime';
import { requireAccess, accessProtectionEnabled } from './auth';
import { apiRouter } from './routes';
import { startOfflineSweeper } from './liveStatus';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
setIo(io);

app.use(express.json());

// Public endpoint so the login screen knows whether a token is required.
// Intentionally NOT behind requireAccess.
app.get('/api/meta', (_req, res) => {
  res.json({ accessProtection: accessProtectionEnabled() });
});

// All feature APIs sit behind the shared-token gate.
app.use('/api', requireAccess, apiRouter);

// Static frontend. The login screen itself is static and handles token entry
// client-side, so serving files openly is fine — the data APIs are protected.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback: any non-API route serves the app shell.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Central error handler so a thrown error in any handler never crashes the
// process and always returns clean JSON.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error in request:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Interner Serverfehler.' });
  }
);

io.on('connection', () => {
  // No per-connection logic needed yet; clients just receive broadcasts.
});

// Periodically flip stale players to offline.
startOfflineSweeper(io);

// Guard against unexpected crashes: log instead of letting the process die, so
// the LAN keeps running even if something slips through a handler.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', reason);
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`LAN 2026 server läuft auf http://localhost:${config.port}`);
  if (!accessProtectionEnabled()) {
    // eslint-disable-next-line no-console
    console.log('Hinweis: Kein ACCESS_TOKEN gesetzt – Zugangsschutz ist deaktiviert.');
  }
});
