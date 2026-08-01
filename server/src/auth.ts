// Authorization helpers for session-admin and dedicated kiosk routes.

import { Request, RequestHandler } from 'express';
import { requireUser } from './sessions';
import { writeAdminAudit } from './adminAudit';

// Reads a dedicated kiosk credential from either a header or query param.
export function extractToken(req: Request): string | undefined {
  const header = req.header('x-access-token');
  if (header) return header;
  const q = req.query?.token;
  return typeof q === 'string' ? q : undefined;
}

// Admin-only endpoints always use the verified session role.
export const requireAdmin: RequestHandler = (req, res, next): void => {
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
