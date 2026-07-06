// Light access protection for the web UI/API. Because the server is reachable
// from the cloud, we gate browser access behind a single shared token. This is
// deliberately simple (not per-user auth) — it only keeps strangers out.

import { Request, Response, NextFunction } from 'express';
import { config } from './config';

// Reads the shared token from either a header or query param. The frontend
// stores it in localStorage and sends it as a header on every request.
function extractToken(req: Request): string | undefined {
  const header = req.header('x-access-token');
  if (header) return header;
  const q = req.query.token;
  return typeof q === 'string' ? q : undefined;
}

// Middleware guarding the browser-facing API. If no ACCESS_TOKEN is configured,
// protection is disabled (handy for local development).
export function requireAccess(req: Request, res: Response, next: NextFunction): void {
  if (!config.accessToken) return next();
  if (extractToken(req) === config.accessToken) return next();
  res.status(401).json({ error: 'Zugang verweigert – gültiges Token erforderlich.' });
}

// Whether access protection is on. Exposed so the login screen knows whether to
// prompt for a token at all.
export function accessProtectionEnabled(): boolean {
  return Boolean(config.accessToken);
}
