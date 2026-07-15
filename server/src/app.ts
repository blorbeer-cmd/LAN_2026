// Builds the Express application (REST API + static frontend) without binding a
// port or starting Socket.IO. Keeping this pure makes it directly testable with
// supertest, while index.ts wires it into an HTTP server + realtime + timers.

import express from 'express';
import helmet from 'helmet';
import path from 'path';

import { requireAccess, accessProtectionEnabled } from './auth';
import { apiRouter } from './routes';
import { agentRouter } from './routes/agent';
import { config } from './config';

export function createApp(): express.Express {
  const app = express();

  // Baseline security headers (X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy, etc). CSP left off: the frontend is vanilla JS served
  // from server/public without a build step, and a default CSP is more
  // likely to silently break a view than to add real protection here —
  // enabling it needs a dedicated pass over the actual markup first.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Avatars and game icons are sent as data URLs. Keep the parser limit above
  // the 400 KB validation limit and return a useful 413 when it is exceeded.
  app.use(express.json({ limit: '1mb' }));

  // Public endpoint so the frontend can choose the legacy shared-token gate
  // or the required per-user login gate.
  app.get('/api/meta', (_req, res) => {
    res.json({
      accessProtection: accessProtectionEnabled(),
      authMode: config.authMode,
      kioskProtection: config.authMode === 'required' && Boolean(config.kioskToken),
      multiGroupsEnabled: config.multiGroupsEnabled,
    });
  });

  // Agent reports authenticate via the player's own API key (NFR-15), not the
  // shared UI token — the agent never knows that token. Must be mounted
  // before the requireAccess gate below so it isn't blocked by it.
  app.use('/api/agent', agentRouter);

  // Legacy browser APIs sit behind the shared-token gate. In required mode
  // requireAccess is a compatibility no-op and apiRouter enforces sessions.
  app.use('/api', requireAccess, apiRouter);

  // Static frontend. The login screen itself is static and handles token entry
  // client-side, so serving files openly is fine — the data APIs are protected.
  // no-cache (not no-store) forces the browser to revalidate with the server
  // on every load via ETag instead of silently reusing a stale cached JS/CSS
  // file after a deploy — this is what caused updated views to appear "not
  // to have shipped" even though the server had the new code.
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(
    express.static(publicDir, {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  // SPA fallback: any non-API route serves the app shell.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Central error handler so a thrown error in any handler never crashes the
  // process and always returns clean JSON.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (res.headersSent) return;
      if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Die Anfrage ist zu groß.' });
      }
      // eslint-disable-next-line no-console
      console.error('Unhandled error in request:', err);
      res.status(500).json({ error: 'Interner Serverfehler.' });
    }
  );

  return app;
}
