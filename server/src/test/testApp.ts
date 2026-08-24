import express from 'express';
import type { Server } from 'socket.io';
import { createApp } from '../app';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';
import { ensureDefaultGroupMembership } from '../groups';
import {
  createSession,
  markSessionReauthenticated,
  SESSION_COOKIE_NAME,
  verifySession,
} from '../sessions';
import { ensureAccountEventContext, getOrRepairActiveEvent } from '../eventContext';
import { setEventTrackingConsent } from '../trackingContexts';

const TEST_ADMIN_ID = '__integration-test-admin__';

function ensureTestAdmin(): void {
  db.prepare(
    `INSERT OR IGNORE INTO players
       (id, name, color, api_key, password_hash, is_admin, created_at)
     VALUES (?, ?, '#4f9dff', ?, ?, 1, ?)`,
  ).run(TEST_ADMIN_ID, 'Integration Test Admin', 'integration-test-api-key', 'integration-test-password-hash', Date.now());
  ensureDefaultGroupMembership(TEST_ADMIN_ID, { bootstrapAdmin: true });
}

/**
 * Builds the real application behind a real owner session. Older feature
 * integration suites can therefore exercise their APIs without reviving the
 * retired browser identity header or an unauthenticated production mode.
 */
export function createTestApp(): express.Express {
  ensureTestAdmin();
  const cookies = new Map<string, string>([[TEST_ADMIN_ID, sessionCookie(TEST_ADMIN_ID)]]);
  const wrapper = express();
  wrapper.use(express.json({ limit: '1mb' }));
  wrapper.use((req, _res, next) => {
    if (!req.headers.cookie) {
      const headerPlayerId = req.header('x-test-player-id');
      const bodyPlayerId = typeof req.body?.playerId === 'string' ? req.body.playerId : undefined;
      const queryPlayerId = typeof req.query.playerId === 'string' ? req.query.playerId : undefined;
      let routePlayerId: string | undefined;
      const playerPath = req.path.match(/^\/api\/players\/([^/]+)(?:\/(?:stats|neighbors))?\/?$/);
      if (playerPath && (req.method === 'GET' || req.method === 'PATCH' || req.path.endsWith('/stats') || req.path.endsWith('/neighbors'))) {
        routePlayerId = decodeURIComponent(playerPath[1]);
      }
      const livePath = req.path.match(/^\/api\/live\/([^/]+)\/note\/?$/);
      if (livePath) routePlayerId = decodeURIComponent(livePath[1]);
      const ratingPath = req.path.match(/^\/api\/(?:preferences|skills)\/([^/]+)\/[^/]+\/?$/);
      if (req.method === 'DELETE' && ratingPath) routePlayerId = decodeURIComponent(ratingPath[1]);
      const candidate = headerPlayerId || bodyPlayerId || queryPlayerId || routePlayerId;
      const activePlayer = candidate
        ? (db.prepare('SELECT id FROM players WHERE id = ? AND deactivated_at IS NULL').get(candidate) as { id: string } | undefined)
        : undefined;
      if (candidate && !activePlayer) {
        req.headers.cookie = `${SESSION_COOKIE_NAME}=invalid-test-identity`;
        next();
        return;
      }
      const playerId = activePlayer?.id ?? TEST_ADMIN_ID;
      let cookie = cookies.get(playerId);
      if (!cookie) {
        cookie = sessionCookie(playerId);
        cookies.set(playerId, cookie);
      }
      req.headers.cookie = cookie;
    }
    next();
  });
  wrapper.use(createApp());
  return wrapper;
}

export function sessionCookie(playerId: string): string {
  const token = createSession(playerId);
  markSessionReauthenticated(verifySession(token)!.session.id);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

/** Explicit opt-in for legacy integration suites that exercise Agent data. */
export function enableTestTracking(playerId: string, eventId = BASE_EVENT_ID): void {
  const event = db.prepare('SELECT group_id AS groupId FROM events WHERE id = ?').get(eventId) as
    | { groupId: string }
    | undefined;
  if (!event) throw new Error(`Test event ${eventId} does not exist.`);
  ensureAccountEventContext(playerId, eventId);
  db.prepare('UPDATE events SET tracking_enabled = 1, starts_at = 0 WHERE id = ?').run(eventId);
  setEventTrackingConsent(eventId, event.groupId, playerId, true);
}

/**
 * Compatibility fixture for feature-level Socket.IO suites. Production
 * sockets always authenticate during the handshake; these older tests focus
 * on game state machines and select their fixture player in the event body.
 */
export function installTestSocketIdentity(io: Server): void {
  io.on('connection', (socket) => {
    socket.use((packet, next) => {
      const payload = packet[1] as { playerId?: unknown } | undefined;
      const playerId = typeof payload?.playerId === 'string' ? payload.playerId : undefined;
      const activePlayer = playerId
        ? (db.prepare('SELECT id FROM players WHERE id = ? AND deactivated_at IS NULL').get(playerId) as
            | { id: string }
            | undefined)
        : undefined;
      if (activePlayer) {
        socket.data.authPlayerId = activePlayer.id;
        socket.data.groupId = DEFAULT_GROUP_ID;
        socket.data.eventId = getOrRepairActiveEvent(activePlayer.id).id;
      }
      next();
    });
  });
}

export { TEST_ADMIN_ID, DEFAULT_GROUP_ID };
