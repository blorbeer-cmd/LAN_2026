// Thin wrapper around Socket.IO so route handlers can push events without
// importing the server internals. Set once at startup via setIo().

import { Server, Socket } from 'socket.io';
import { config } from './config';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { isSessionActive, parseCookieHeader, verifySession, SESSION_COOKIE_NAME } from './sessions';
import { resolveKioskToken } from './kioskTokens';
import { isParticipant } from './events';

let io: Server | null = null;
let authSessionSweep: NodeJS.Timeout | null = null;

export function groupRoom(groupId: string): string {
  return `group:${groupId}`;
}

export function eventRoom(eventId: string): string {
  return `event:${eventId}`;
}

export function activeGroupMember(groupId: string, playerId: unknown): boolean {
  return (
    typeof playerId === 'string' &&
    Boolean(
      db
        .prepare(
          `SELECT 1 FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     JOIN players p ON p.id = gm.player_id
     WHERE gm.group_id = ? AND gm.player_id = ? AND gm.status = 'active'
       AND g.archived_at IS NULL AND p.deactivated_at IS NULL`,
        )
        .get(groupId, playerId),
    )
  );
}

export function activeEventAccess(groupId: string, eventId: string, playerId: unknown): boolean {
  if (!activeGroupMember(groupId, playerId)) return false;
  if (typeof playerId !== 'string') return false;
  const membership = db
    .prepare("SELECT role FROM group_memberships WHERE group_id = ? AND player_id = ? AND status = 'active'")
    .get(groupId, playerId) as { role: string } | undefined;
  if (membership?.role === 'admin' || membership?.role === 'owner') {
    return Boolean(db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId));
  }
  const event = db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId);
  return Boolean(event) && isParticipant(eventId, playerId);
}

function validScope(socket: Socket, groupId: unknown, eventId: unknown): boolean {
  if (typeof groupId !== 'string' || !groupId || socket.data.kioskReadOnly) return false;
  if (!activeGroupMember(groupId, socket.data.authPlayerId)) return false;
  if (eventId === undefined || eventId === null || eventId === '') return true;
  if (typeof eventId !== 'string') return false;
  return (
    Boolean(db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId)) &&
    activeEventAccess(groupId, eventId, socket.data.authPlayerId)
  );
}

function clearSocketScope(socket: Socket): void {
  for (const room of [...socket.rooms]) {
    if (room !== socket.id && (room.startsWith('group:') || room.startsWith('event:'))) socket.leave(room);
  }
  delete socket.data.groupId;
  delete socket.data.eventId;
}

function revalidateSocketScopes(server: Server, socket: Socket): void {
  const groupId = socket.data.groupId;
  if (typeof groupId !== 'string' || !activeGroupMember(groupId, socket.data.authPlayerId)) {
    clearSocketScope(socket);
    return;
  }
  const eventId = socket.data.eventId;
  if (typeof eventId === 'string' && !activeEventAccess(groupId, eventId, socket.data.authPlayerId)) {
    socket.leave(eventRoom(eventId));
    delete socket.data.eventId;
  }
  // Touching the server here is intentional: the check is performed again
  // immediately before the next delivery, not only when a socket joins.
  void server;
}

export function registerScopedSockets(server: Server): void {
  server.on('connection', (socket) => {
    const subscribe = (payload: { groupId?: unknown; eventId?: unknown }, ack?: (result: unknown) => void) => {
      const groupId = payload?.groupId;
      const eventId = payload?.eventId;
      if (!validScope(socket, groupId, eventId)) {
        ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
        return;
      }
      clearSocketScope(socket);
      socket.join(groupRoom(groupId as string));
      socket.data.groupId = groupId;
      if (typeof eventId === 'string' && eventId) {
        socket.join(eventRoom(eventId));
        socket.data.eventId = eventId;
      }
      ack?.({ ok: true, groupId, eventId: typeof eventId === 'string' && eventId ? eventId : null });
    };
    socket.on('scope:subscribe', subscribe);
    socket.on('room:subscribe', subscribe);
    socket.on('scope:leave', () => clearSocketScope(socket));
  });
}

export function setIo(server: Server | null): void {
  io = server;
  if (authSessionSweep) clearInterval(authSessionSweep);
  authSessionSweep = null;
  if (!server) return;
  authSessionSweep = setInterval(() => {
    for (const socket of server.sockets.sockets.values()) {
      const sessionId = socket.data.authSessionId;
      const scopedGroupId = socket.data.groupId;
      // A socket without a subscribed scope has nothing to revoke — only a
      // dead session or a lost membership of the subscribed group disconnects.
      const membershipLost =
        typeof scopedGroupId === 'string' && !activeGroupMember(scopedGroupId, socket.data.authPlayerId);
      if (typeof sessionId === 'string' && (!isSessionActive(sessionId) || membershipLost)) {
        socket.disconnect(true);
        continue;
      }
      revalidateSocketScopes(server, socket);
    }
  }, 60_000);
  authSessionSweep.unref();
}

export function disconnectSessionSockets(sessionId: string): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.authSessionId === sessionId) socket.disconnect(true);
  }
}

export function disconnectPlayerSockets(playerId: string, exceptSessionId?: string): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.authPlayerId !== playerId) continue;
    if (exceptSessionId && socket.data.authSessionId === exceptSessionId) continue;
    socket.disconnect(true);
  }
}

// Browser presence is intentionally tied to an authenticated, currently
// connected socket instead of the existence of a long-lived login session.
// A player may have several tabs/devices open, so they stay connected until
// the last matching socket disappears.
export function isPlayerConnected(playerId: string): boolean {
  if (!io?.sockets?.sockets) return false;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.connected && socket.data.authPlayerId === playerId) return true;
  }
  return false;
}

// Every fachliche Auslieferung carries an explicit, server-derived scope.
// Callers pass the group of the validated request or loaded resource — never
// unchecked client input.
export interface BroadcastScope {
  groupId: string;
  eventId?: string | null;
  // Personally targeted payloads (e.g. direct pushes): restricts delivery to
  // exactly these players. Kiosk delivery remains off unless includeKiosk is
  // explicitly set for a sanitised shared-screen payload.
  recipientPlayerIds?: string[];
  includeKiosk?: boolean;
}

// The shared kiosk screen is a read-only display without an identity. It only
// ever receives the refresh signals its dashboard actually renders (mirroring
// KIOSK_GET_PATHS on the REST side); everything else stays member-only even
// inside the kiosk's own group.
const KIOSK_DELIVERED_EVENTS = new Set<string>([
  'live:changed',
  'players:changed',
  'votes:changed',
  'leaderboard:changed',
  'tournaments:changed',
  'matchmaking:generated',
  'foodOrders:changed',
  'music:changed',
  'push:sent',
  'push:changed',
]);

// Deliberately global technical signals (see broadcastInstanceSignal). Fach-
// events never belong here — add a name only when the signal must reach
// clients that are, by definition, outside every deliverable group scope.
const INSTANCE_SIGNAL_EVENTS = new Set<string>(['groups:changed']);

// Kiosk access is only as good as its token: the scope captured at handshake
// time must not outlive a revocation or the archival of its group, so every
// delivery re-checks the persisted state. The group-archival check applies to
// every kiosk; only the revocation check is token-bound, because the
// installation-wide env token (config.kioskToken) has no database row.
export function kioskDeliveryAllowed(socket: Socket): boolean {
  const groupId = socket.data.kioskGroupId;
  if (typeof groupId !== 'string' || !groupId) return false;
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ? AND archived_at IS NULL').get(groupId)) return false;
  const tokenId = socket.data.kioskTokenId;
  if (typeof tokenId !== 'string' || !tokenId) return true;
  return Boolean(db.prepare('SELECT 1 FROM kiosk_tokens WHERE id = ? AND revoked_at IS NULL').get(tokenId));
}

// The tracking event for the supplied retained group_id scope. Do not use the
// unscoped getTrackingEventId() helper here: legacy or regression data may
// contain rows outside the start group. A group kiosk's /api/push/last banner
// view is scoped to exactly this event, so the live push:sent banner must
// accept it too.
function groupCurrentTrackingEventId(groupId: string): string | null {
  const row = db
    .prepare('SELECT id FROM events WHERE tracking_enabled = 1 AND group_id = ? AND id != ?')
    .get(groupId, OUTSIDE_EVENTS_ID) as { id: string } | undefined;
  return row?.id ?? null;
}

// Eagerly ends the sockets of a just-revoked kiosk token; the delivery-time
// re-check above stays the authoritative guard either way.
export function disconnectKioskTokenSockets(tokenId: string): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.kioskTokenId === tokenId) socket.disconnect(true);
  }
}

// A fachlicher Broadcast without a group scope must never fall through to a
// global emit and must never disappear silently: outside production it throws
// (so tests and development catch the missing scope immediately), in
// production it logs loudly and refuses delivery.
function rejectUnscopedBroadcast(event: string): never | void {
  const message = `[realtime] Broadcast "${event}" ohne Gruppen-Scope – Auslieferung verweigert.`;
  // eslint-disable-next-line no-console
  console.error(message);
  if (process.env.NODE_ENV !== 'production') throw new Error(message);
}

// Broadcast a group-scoped event. Safe to call before io is set (during early
// startup) — it simply no-ops.
//
// Empfängerregeln (default-deny):
// - Normale Sockets: nur an Sockets, die genau diesen
//   Gruppen-Scope abonniert haben UND deren aktive Mitgliedschaft (sowie ggf.
//   Event-Teilnahme) unmittelbar vor der Auslieferung erneut bestätigt wurde.
// - Kiosk-Sockets: nur Events aus KIOSK_DELIVERED_EVENTS,
//   nur für exakt den Gruppen-/Event-Scope des validierten Kiosk-Tokens.
export function broadcast(event: string, payload: unknown, scope: BroadcastScope): void {
  if (!io) return;
  const groupId = typeof scope?.groupId === 'string' && scope.groupId ? scope.groupId : null;
  if (!groupId) return rejectUnscopedBroadcast(event);
  const eventId = typeof scope.eventId === 'string' && scope.eventId ? scope.eventId : null;
  const hasRecipientFilter = Array.isArray(scope.recipientPlayerIds);
  const recipients = hasRecipientFilter ? new Set(scope.recipientPlayerIds) : null;
  // Unit/test adapters may expose only the historical io.emit surface.
  if (!io.sockets?.sockets) {
    io.emit(event, payload);
    return;
  }
  // Socket.IO rooms are only a routing hint. Re-check the current membership
  // at delivery time so revocation or a stale socket scope cannot leak a
  // queued payload.
  // Kiosk sockets are authenticated with a read-only kiosk token rather than
  // a player session; only the server-set kioskReadOnly flag counts (a
  // handshake claim alone must never select the kiosk path).
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.kioskReadOnly) {
      if (recipients && !scope.includeKiosk) continue;
      if (!KIOSK_DELIVERED_EVENTS.has(event)) continue;
      if (socket.data.kioskGroupId !== groupId) continue;
      if (!kioskDeliveryAllowed(socket)) continue;
      if (event === 'push:sent') {
        // The push banner is the one payload the kiosk renders directly, so
        // its scope mirrors the kiosk's /api/push/last view exactly. An event
        // kiosk shows only its own event's banner; a group kiosk shows its
        // group-room banners plus its group's currently tracking event (the
        // same event resolveGroupEventScope returns for that kiosk's REST
        // reads), so an event-scoped push is not stuck until a reload.
        const kioskEventId = (socket.data.kioskEventId ?? null) as string | null;
        const accepted =
          kioskEventId !== null
            ? eventId === kioskEventId
            : eventId === null || eventId === groupCurrentTrackingEventId(groupId);
        if (!accepted) continue;
        socket.emit(event, payload);
      } else {
        // Every other allowlisted event is a null refresh signal (fachliche
        // payloads can carry member-only details, e.g. match-ready lobby
        // credentials). The kiosk refetches through its own token-scoped REST
        // reads, so it must fire on any change in its group — including
        // event-room changes that routes emit as a plain { groupId } signal,
        // which an exact eventId match would otherwise drop for an event kiosk.
        socket.emit(event, null);
      }
      continue;
    }
    if (socket.data.groupId !== groupId) continue;
    if (recipients && !recipients.has(socket.data.authPlayerId as string)) continue;
    if (!activeGroupMember(groupId, socket.data.authPlayerId)) continue;
    if (eventId && !activeEventAccess(groupId, eventId, socket.data.authPlayerId)) continue;
    socket.emit(event, payload);
  }
}

// The deliberately named path for genuinely global technical signals: an
// allowlisted event name and no payload (clients refetch their own,
// authorization-filtered data). Used for membership-lifecycle refreshes that
// must also reach clients who just lost (or have not yet gained) a group
// scope — a group-scoped delivery could by definition never inform them.
export function broadcastInstanceSignal(event: string): void {
  if (!io) return;
  if (!INSTANCE_SIGNAL_EVENTS.has(event)) {
    const message = `[realtime] "${event}" ist kein freigegebenes globales Instanz-Signal.`;
    // eslint-disable-next-line no-console
    console.error(message);
    if (process.env.NODE_ENV !== 'production') throw new Error(message);
    return;
  }
  io.emit(event, null);
}

// Socket.IO connections bypass Express middleware entirely, so their access
// rules mirror the REST API here: a valid user session or the dedicated
// read-only kiosk credential is required.
export function createSocketAuthGuard(kioskToken: string = config.kioskToken) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    const kioskScope = socket.handshake.auth?.kiosk === true ? resolveKioskToken(socket.handshake.auth?.token) : null;
    if (
      socket.handshake.auth?.kiosk === true &&
      ((Boolean(kioskToken) && socket.handshake.auth?.token === kioskToken) || Boolean(kioskScope))
    ) {
      socket.data.kioskReadOnly = true;
      socket.data.kioskGroupId = kioskScope?.groupId ?? DEFAULT_GROUP_ID;
      socket.data.kioskEventId = kioskScope?.eventId ?? null;
      socket.data.kioskTokenId = kioskScope?.id ?? null;
      socket.use(([event], proceed) => {
        if (event === 'kiosk:subscribe') return proceed();
        proceed(new Error('unauthorized'));
      });
      return next();
    }
    const sessionToken = parseCookieHeader(socket.handshake.headers.cookie)[SESSION_COOKIE_NAME];
    const resolved = sessionToken ? verifySession(sessionToken) : undefined;
    if (resolved) {
      socket.data.authSessionId = resolved.session.id;
      socket.data.authPlayerId = resolved.player.id;
      socket.use(([_, payload], proceed) => {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          (payload as Record<string, unknown>).playerId = resolved.player.id;
        }
        proceed();
      });
      return next();
    }
    next(new Error('unauthorized'));
  };
}

// Event name constants keep client and server in sync and avoid typos.
export const Events = {
  groupsChanged: 'groups:changed',
  playersChanged: 'players:changed',
  gamesChanged: 'games:changed',
  skillsChanged: 'skills:changed',
  preferencesChanged: 'preferences:changed',
  liveStatusChanged: 'live:changed',
  votesChanged: 'votes:changed',
  leaderboardChanged: 'leaderboard:changed',
  matchmakingGenerated: 'matchmaking:generated',
  matchmakingDrawsChanged: 'matchmaking:draws-changed',
  eventsChanged: 'events:changed',
  tournamentsChanged: 'tournaments:changed',
  draftChanged: 'draft:changed',
  broadcastNew: 'broadcast:new',
  broadcastsChanged: 'broadcasts:changed',
  infoChanged: 'info:changed',
  foodOrdersChanged: 'foodOrders:changed',
  arrivalsChanged: 'arrivals:changed',
  checklistChanged: 'checklist:changed',
  musicChanged: 'music:changed',
  pushSent: 'push:sent',
  pushChanged: 'push:changed',
  pushSeen: 'push:seen',
} as const;
