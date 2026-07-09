// Light access protection for the web UI/API. Because the server is reachable
// from the cloud, we gate browser access behind a single shared token. This is
// deliberately simple (not per-user auth) — it only keeps strangers out.
//
// Built as a factory so it can be unit-tested in both modes (token / no token)
// without touching process-wide environment state.

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from './config';

// Reads the shared token from either a header or query param. The frontend
// stores it in localStorage and sends it as a header on every request.
export function extractToken(req: Request): string | undefined {
  const header = req.header('x-access-token');
  if (header) return header;
  const q = req.query?.token;
  return typeof q === 'string' ? q : undefined;
}

// Creates the access-guard middleware for a given expected token. An empty
// token disables protection (handy for local development and tests).
export function createAccessGuard(expectedToken: string): RequestHandler {
  return function requireAccess(req: Request, res: Response, next: NextFunction): void {
    if (!expectedToken) return next();
    if (extractToken(req) === expectedToken) return next();
    res.status(401).json({ error: 'Zugang verweigert – gültiges Token erforderlich.' });
  };
}

// Default guard wired to the configured token, used by the running server.
export const requireAccess = createAccessGuard(config.accessToken);

// Whether access protection is on for a given token (defaults to configured).
export function accessProtectionEnabled(token: string = config.accessToken): boolean {
  return Boolean(token);
}

// ---------- Admin gate ----------
//
// Admin-only endpoints (grant/revoke admin, and anything moderation-y added
// later) sit behind this. It's intentionally separate from requireAccess:
// requireAccess keeps strangers out of the whole UI, requireAdmin keeps
// regular party guests out of the admin extras. An empty adminPin means
// dev/open mode — the gate lets everyone through, so local testing needs no
// secret (matches how an empty accessToken disables access protection).

export function adminUnlockValid(pin: unknown, expected: string = config.adminPin): boolean {
  if (!expected) return true; // open mode
  return typeof pin === 'string' && pin === expected;
}

export function createAdminGuard(expectedPin: string): RequestHandler {
  return function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!expectedPin) return next(); // open mode
    if (req.header('x-admin-pin') === expectedPin) return next();
    res.status(403).json({ error: 'Nur für Admins.' });
  };
}

// Default admin guard wired to the configured PIN, used by the running server.
export const requireAdmin = createAdminGuard(config.adminPin);

// Whether an admin PIN is configured at all (false = open mode). The frontend
// uses this to decide whether to prompt for a PIN before enabling admin mode.
export function adminPinRequired(pin: string = config.adminPin): boolean {
  return Boolean(pin);
}
