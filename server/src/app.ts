// Builds the Express application (REST API + static frontend) without binding a
// port or starting Socket.IO. Keeping this pure makes it directly testable with
// supertest, while index.ts wires it into an HTTP server + realtime + timers.

import express from 'express';
import path from 'path';

import { requireAccess, accessProtectionEnabled } from './auth';
import { apiRouter } from './routes';

export function createApp(): express.Express {
  const app = express();

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
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      // eslint-disable-next-line no-console
      console.error('Unhandled error in request:', err);
      if (res.headersSent) return;
      res.status(500).json({ error: 'Interner Serverfehler.' });
    }
  );

  return app;
}
