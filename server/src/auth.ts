// Legacy access protection for deployments that still use a single shared
// token. Required-auth deployments use per-user sessions instead.
//
// Built as a factory so it can be unit-tested in both modes (token / no token)
// without touching process-wide environment state.

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from './config';
import { requireUser } from './sessions';
import { writeAdminAudit } from './adminAudit';

// Reads the legacy shared token from either a header or query param.
export function extractToken(req: Request): string | undefined {
  const header = req.header('x-access-token');
  if (header) return header;
  const q = req.query?.token;
  return typeof q === 'string' ? q : undefined;
}

// Creates the access-guard middleware for a given expected token. An empty
// token disables protection (handy for local development and tests).
export function createAccessGuard(
  expectedToken: string,
  authMode: 'legacy' | 'required' = 'legacy'
): RequestHandler {
  return function requireAccess(req: Request, res: Response, next: NextFunction): void {
    if (authMode === 'required') return next();
    if (!expectedToken) return next();
    if (extractToken(req) === expectedToken) return next();
    res.status(401).json({ error: 'Zugang verweigert – gültiges Token erforderlich.' });
  };
}

// Default guard wired to the configured token, used by the running server.
export const requireAccess = createAccessGuard(config.accessToken, config.authMode);

// Whether access protection is on for a given token (defaults to configured).
export function accessProtectionEnabled(
  token: string = config.accessToken,
  authMode: 'legacy' | 'required' = config.authMode
): boolean {
  return authMode === 'legacy' && Boolean(token);
}

// Admin-only endpoints use the verified session role in required mode. Legacy
// keeps its historic one-tap trust model until the deployment is cut over.
export const requireAdmin: RequestHandler = (req, res, next): void => {
  if (config.authMode === 'legacy') {
    // Legacy mode deliberately preserves the pre-account trust model. The
    // retired ADMIN_PIN is no longer a second, client-held security state.
    next();
    return;
  }
  requireUser(req, res, () => {
    if (!req.player?.is_admin) {
      writeAdminAudit({
        actorPlayerId: req.player?.id,
        action: 'access_denied',
        targetType: 'route',
        targetId: `${req.method} ${req.path}`,
        details: { status: 403, requiredRole: 'admin' },
      });
      res.status(403).json({ error: 'Nur für Admins.' });
      return;
    }
    next();
  });
};
