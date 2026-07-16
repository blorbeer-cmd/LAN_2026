// Session lifecycle for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md). A session is a random token handed to the
// browser as an HttpOnly cookie; only its SHA-256 hash is ever stored, so a
// leaked database dump doesn't hand out usable sessions. Sliding expiry (90
// days, refreshed on every verified request) means a device that's used at
// least once every ~3 months never has to log in again.

import { randomBytes, createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { db } from './db';
import { config } from './config';
import { writeAdminAudit } from './adminAudit';

// __Host- prevents sibling subdomains from overwriting the production
// session cookie. Plain-HTTP LAN deployments cannot use that prefix because
// browsers require __Host- cookies to be Secure.
export const SESSION_COOKIE_NAME = config.cookieSecure ? '__Host-respawn_session' : 'respawn_session';
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const REAUTH_TTL_MS = 5 * 60 * 1000;

export interface AuthPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  is_admin: number;
  is_test: number;
  deactivated_at: number | null;
  created_at: number;
}

// Route handlers read the authenticated player off req.player (set by
// requireUser below). Declared globally so every file importing express's
// Request type sees the same augmentation without a separate import.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      player?: AuthPlayer;
      // The session row backing req.player — exposed so a handler can
      // invalidate every OTHER session for the account (password change)
      // without also logging out the request that made the change.
      sessionId?: string;
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Minimal RFC 6265 cookie parsing (no dependency: just split on ';' pairs).
// Only used to read our own cookie back, so it doesn't need to handle
// quoted values or attributes.
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Malformed external input is an invalid cookie, not a server error.
    }
  }
  return out;
}

export function getSessionToken(req: Request): string | undefined {
  return parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
}

function cookieAttributes(maxAgeSeconds: number): string {
  const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSeconds}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res: Response, token: string, maxAgeMs: number = SESSION_TTL_MS): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(Math.max(0, Math.floor(maxAgeMs / 1000)))}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0)}`);
}

// Creates a new session for playerId and returns the raw token to hand to
// the browser — the only time it's ever visible outside the client.
export function createSession(playerId: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, player_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), playerId, hashToken(token), now, now, now + SESSION_TTL_MS);
  return token;
}

export interface SessionRow {
  id: string;
  player_id: string;
  created_at: number;
  expires_at: number;
}

// Resolves a raw token to its still-active session + player (excluding
// api_key/password_hash — this is what request handlers see as req.player).
// Slides the session's expiry forward on every successful lookup. Lazily
// deletes the row if it turns out to be expired, rather than waiting for a
// separate sweep.
export function verifySession(rawToken: string): { session: SessionRow; player: AuthPlayer } | undefined {
  const tokenHash = hashToken(rawToken);
  const session = db.prepare('SELECT id, player_id, created_at, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | SessionRow
    | undefined;
  if (!session) return undefined;

  const now = Date.now();
  const absoluteExpiresAt = session.created_at + SESSION_ABSOLUTE_TTL_MS;
  if (session.expires_at <= now || absoluteExpiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return undefined;
  }

  const player = db
    .prepare('SELECT id, name, color, avatar, is_admin, is_test, deactivated_at, created_at FROM players WHERE id = ?')
    .get(session.player_id) as AuthPlayer | undefined;
  if (!player || player.deactivated_at !== null) {
    // Player row is gone (deleted) but the session outlived it somehow —
    // shouldn't happen given ON DELETE CASCADE, but fail safe.
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return undefined;
  }

  const nextExpiresAt = Math.min(now + SESSION_TTL_MS, absoluteExpiresAt);
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, nextExpiresAt, session.id);
  session.expires_at = nextExpiresAt;
  return { session, player };
}

export function deleteSessionByToken(rawToken: string): SessionRow | undefined {
  const tokenHash = hashToken(rawToken);
  const session = db
    .prepare('SELECT id, player_id, created_at, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as SessionRow | undefined;
  if (session) db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  return session;
}

// Read-only check used by the Socket.IO sweeper. Unlike verifySession(), it
// deliberately does not slide the idle timeout merely because a socket is
// connected and receiving broadcasts.
export function isSessionActive(sessionId: string): boolean {
  const session = db
    .prepare('SELECT id, player_id, created_at, expires_at FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;
  if (!session) return false;
  const now = Date.now();
  return session.expires_at > now && session.created_at + SESSION_ABSOLUTE_TTL_MS > now;
}

export function markSessionReauthenticated(sessionId: string): void {
  db.prepare('UPDATE sessions SET reauthenticated_at = ? WHERE id = ?').run(Date.now(), sessionId);
}

export function hasRecentReauthentication(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  const row = db
    .prepare('SELECT reauthenticated_at FROM sessions WHERE id = ?')
    .get(sessionId) as { reauthenticated_at: number | null } | undefined;
  return Boolean(row?.reauthenticated_at && row.reauthenticated_at > Date.now() - REAUTH_TTL_MS);
}

// Critical admin mutations require a password confirmation in required mode.
// Legacy requests have no session-bound player and keep their existing trust
// model until the deployment is cut over.
export const requireRecentReauthentication: RequestHandler = (req, res, next): void => {
  if (req.player && !hasRecentReauthentication(req.sessionId)) {
    res.status(403).json({ error: 'Bitte bestätige dein Passwort.', code: 'reauth_required' });
    return;
  }
  next();
};

// Used on password change ("invalidates all OTHER sessions") and account
// deactivation ("invalidates all sessions"). exceptSessionId lets password
// change keep the session that just made the request alive.
export function deleteAllSessionsForPlayer(playerId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE player_id = ? AND id != ?').run(playerId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
  }
}

// Gate for routes that require a logged-in user. Not wired onto any feature
// routes yet (see config.authMode) — this phase only introduces the
// mechanism; enforcing it across the app is a later, separate change.
export const requireUser: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const token = getSessionToken(req);
  const resolved = token ? verifySession(token) : undefined;
  if (!resolved) {
    res.status(401).json({ error: 'Nicht angemeldet.' });
    return;
  }
  req.player = resolved.player;
  req.sessionId = resolved.session.id;
  setSessionCookie(res, token!, resolved.session.expires_at - Date.now());
  next();
};

// Phase 2 compatibility bridge: personal feature routes use these stacks so
// AUTH_MODE=required makes the verified session authoritative while legacy
// deployments keep accepting their existing client-selected playerId.
export const requireConfiguredUser: RequestHandler = (req, res, next): void => {
  if (config.authMode === 'legacy') {
    next();
    return;
  }
  requireUser(req, res, next);
};

const bindBodyPlayerId: RequestHandler = (req, _res, next): void => {
  if (req.player) req.body = { ...(req.body ?? {}), playerId: req.player.id };
  next();
};

const bindQueryPlayerId: RequestHandler = (req, _res, next): void => {
  if (req.player) req.query.playerId = req.player.id;
  next();
};

export const withBodyPlayerIdentity: RequestHandler[] = [requireConfiguredUser, bindBodyPlayerId];
export const withQueryPlayerIdentity: RequestHandler[] = [requireConfiguredUser, bindQueryPlayerId];

export function withParamPlayerIdentity(paramName = 'playerId'): RequestHandler[] {
  const bindParam: RequestHandler = (req, _res, next): void => {
    if (req.player) req.params[paramName] = req.player.id;
    next();
  };
  return [requireConfiguredUser, bindParam];
}

// Stacks on top of requireUser for the small number of endpoints only an
// admin may call. Kept separate from the legacy PIN-based requireAdmin in
// auth.ts, which stays wired to existing routes unchanged.
export const requireSessionAdmin: RequestHandler[] = [
  requireUser,
  (req: Request, res: Response, next: NextFunction): void => {
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
  },
];
