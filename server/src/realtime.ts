// Thin wrapper around Socket.IO so route handlers can push events without
// importing the server internals. Set once at startup via setIo().

import { Server, Socket } from 'socket.io';
import { config } from './config';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { isSessionActive, parseCookieHeader, verifySession, SESSION_COOKIE_NAME } from './sessions';
import { resolveKioskToken } from './kioskTokens';

let io: Server | null = null;
let authSessionSweep: NodeJS.Timeout | null = null;
interface ArcadeDeliveryScope { groupId: string; eventId: string | null }
const latestArcadeKioskGames = new Map<string, Record<string, unknown>>();
const latestArcadeGames = new Map<string, Record<string, unknown>>();
type ArcadeWatcherChangeListener = (server: Server, matchId: string) => void;
const arcadeWatcherChangeListeners = new Set<ArcadeWatcherChangeListener>();

function watchRoom(matchId: string): string {
  return `arcade-watch:${matchId}`;
}

function arcadeScopeKey(scope: ArcadeDeliveryScope): string {
  return `${scope.groupId}\u0000${scope.eventId ?? ''}`;
}

export function groupRoom(groupId: string): string {
  return `group:${groupId}`;
}

export function eventRoom(eventId: string): string {
  return `event:${eventId}`;
}

function activeGroupMember(groupId: string, playerId: unknown): boolean {
  return typeof playerId === 'string' && Boolean(db.prepare(
    `SELECT 1 FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     JOIN players p ON p.id = gm.player_id
     WHERE gm.group_id = ? AND gm.player_id = ? AND gm.status = 'active'
       AND g.archived_at IS NULL AND p.deactivated_at IS NULL`,
  ).get(groupId, playerId));
}

function activeEventAccess(groupId: string, eventId: string, playerId: unknown): boolean {
  if (!activeGroupMember(groupId, playerId)) return false;
  const membership = db
    .prepare("SELECT role FROM group_memberships WHERE group_id = ? AND player_id = ? AND status = 'active'")
    .get(groupId, playerId) as { role: string } | undefined;
  if (membership?.role === 'admin' || membership?.role === 'owner') {
    return Boolean(db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId));
  }
  return Boolean(db.prepare(
    `SELECT 1 FROM event_participants ep JOIN events e ON e.id = ep.event_id
     WHERE ep.event_id = ? AND ep.player_id = ? AND e.group_id = ?`
  ).get(eventId, playerId, groupId));
}

function validScope(socket: Socket, groupId: unknown, eventId: unknown): boolean {
  if (typeof groupId !== 'string' || !groupId || socket.data.kioskReadOnly) return false;
  if (!activeGroupMember(groupId, socket.data.authPlayerId)) return false;
  if (eventId === undefined || eventId === null || eventId === '') return true;
  if (typeof eventId !== 'string') return false;
  return Boolean(db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId)) &&
    activeEventAccess(groupId, eventId, socket.data.authPlayerId);
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

function arcadePlayerIds(payload: Record<string, unknown>): Set<string> {
  const entries = Array.isArray(payload.players)
    ? payload.players
    : Array.isArray(payload.playerRefs)
      ? payload.playerRefs
      : [];
  return new Set(
    entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as { id?: unknown; playerId?: unknown; ref?: { id?: unknown } };
        const id = item.id ?? item.playerId ?? item.ref?.id;
        return typeof id === 'string' ? id : null;
      })
      .filter((id): id is string => id !== null)
  );
}

function spectatorPlayerId(payload: Record<string, unknown>, playerId: unknown): string | null {
  if (typeof playerId !== 'string' || !playerId || arcadePlayerIds(payload).has(playerId)) return null;
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId) as { id: string } | undefined;
  return player?.id ?? null;
}

export function arcadeWatcherPlayerIds(server: Server, matchId: string): string[] {
  const match = latestArcadeGames.get(matchId);
  const scope = match ? arcadePayloadScope(match) : null;
  if (!scope) return [];
  const socketIds = server.sockets.adapter.rooms.get(watchRoom(matchId)) ?? new Set<string>();
  return [...new Set(
    [...socketIds]
      .map((socketId) => {
        const socket = server.sockets.sockets.get(socketId);
        return socket && normalSocketCanUseArcadeScope(socket, scope) ? socket.data.arcadeWatchPlayerId : null;
      })
      .filter((playerId): playerId is string => typeof playerId === 'string' && !!playerId)
  )];
}

export function onArcadeWatcherChange(listener: ArcadeWatcherChangeListener): () => void {
  arcadeWatcherChangeListeners.add(listener);
  return () => arcadeWatcherChangeListeners.delete(listener);
}

function notifyArcadeWatcherChange(server: Server, matchId: unknown): void {
  if (typeof matchId !== 'string') return;
  for (const listener of arcadeWatcherChangeListeners) listener(server, matchId);
}

function watchState(payload: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...payload };
  // Quiz and Scribble must never expose their answer/word state to viewers.
  delete safe.question;
  delete safe.correctAnswer;
  delete safe.answer;
  delete safe.word;
  delete safe.currentWord;
  delete safe.mask;
  delete safe.wordOptions;
  delete safe.guesses;
  delete safe.chat;
  return safe;
}

function watchSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    matchId: payload.matchId,
    gameType: payload.gameType,
    phase: payload.phase ?? (payload.running === false ? 'countdown' : 'playing'),
    paused: payload.paused === true,
    players: payload.players ?? payload.playerRefs ?? [],
    scores: payload.scores ?? [],
  };
}

function arcadePayloadScope(payload: Record<string, unknown>): ArcadeDeliveryScope | null {
  const explicit =
    typeof payload.groupId === 'string' && payload.groupId &&
    Object.prototype.hasOwnProperty.call(payload, 'eventId') &&
    (payload.eventId === null || (typeof payload.eventId === 'string' && payload.eventId))
      ? { groupId: payload.groupId, eventId: payload.eventId as string | null }
      : null;
  return explicit ?? (config.authMode === 'legacy' ? { groupId: DEFAULT_GROUP_ID, eventId: null } : null);
}

function normalSocketCanUseArcadeScope(socket: Socket, scope: ArcadeDeliveryScope): boolean {
  if (socket.data.kioskReadOnly) return false;
  if (config.authMode === 'legacy') return true;
  const socketEventId = typeof socket.data.eventId === 'string' && socket.data.eventId ? socket.data.eventId : null;
  if (socket.data.groupId !== scope.groupId || socketEventId !== scope.eventId) return false;
  if (!activeGroupMember(scope.groupId, socket.data.authPlayerId)) return false;
  return scope.eventId === null || activeEventAccess(scope.groupId, scope.eventId, socket.data.authPlayerId);
}

function kioskCanUseArcadeScope(socket: Socket, scope: ArcadeDeliveryScope): boolean {
  return Boolean(
    socket.data.kioskReadOnly &&
    socket.data.kioskGroupId === scope.groupId &&
    (socket.data.kioskEventId ?? null) === scope.eventId &&
    kioskDeliveryAllowed(socket)
  );
}

function emitArcadeWatchListToSocket(socket: Socket): void {
  if (socket.data.kioskReadOnly) return;
  const matches = [...latestArcadeGames.values()]
    .filter((match) => {
      const scope = arcadePayloadScope(match);
      return scope && normalSocketCanUseArcadeScope(socket, scope);
    })
    .map(watchSummary);
  if (config.authMode === 'legacy' || typeof socket.data.groupId === 'string') {
    socket.emit('arcade:watch:list', { matches });
  }
}

function emitArcadeWatchList(server: Server): void {
  for (const socket of server.sockets.sockets.values()) emitArcadeWatchListToSocket(socket);
}

function emitArcadeWatchRoom(server: Server, matchId: string, event: string, payload: unknown, scope: ArcadeDeliveryScope): void {
  const socketIds = server.sockets.adapter.rooms.get(watchRoom(matchId)) ?? new Set<string>();
  for (const socketId of socketIds) {
    const socket = server.sockets.sockets.get(socketId);
    if (socket && normalSocketCanUseArcadeScope(socket, scope)) socket.emit(event, payload);
  }
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

// Every fachliche Auslieferung carries an explicit, server-derived scope.
// Callers pass the group of the validated request or loaded resource — never
// unchecked client input.
export interface BroadcastScope {
  groupId: string;
  eventId?: string | null;
  // Personally targeted payloads (e.g. direct pushes): restricts delivery to
  // exactly these players and keeps the payload off kiosk sockets entirely.
  // Legacy sockets carry no proven identity, so these payloads are not sent
  // through realtime there at all.
  recipientPlayerIds?: string[];
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
function kioskDeliveryAllowed(socket: Socket): boolean {
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
    .prepare("SELECT id FROM events WHERE tracking_enabled = 1 AND group_id = ? AND id != ?")
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
// - Legacy-Modus: die Installation ist ein einzelner Mandant ohne echte
//   Gruppen-Sockets; jeder gescopte Broadcast geht an alle Clients.
// - Required-Modus, normale Sockets: nur an Sockets, die genau diesen
//   Gruppen-Scope abonniert haben UND deren aktive Mitgliedschaft (sowie ggf.
//   Event-Teilnahme) unmittelbar vor der Auslieferung erneut bestätigt wurde.
// - Required-Modus, Kiosk-Sockets: nur Events aus KIOSK_DELIVERED_EVENTS,
//   nur für exakt den Gruppen-/Event-Scope des validierten Kiosk-Tokens.
export function broadcast(event: string, payload: unknown, scope: BroadcastScope): void {
  if (!io) return;
  const groupId = typeof scope?.groupId === 'string' && scope.groupId ? scope.groupId : null;
  if (!groupId) return rejectUnscopedBroadcast(event);
  const eventId = typeof scope.eventId === 'string' && scope.eventId ? scope.eventId : null;
  const hasRecipientFilter = Array.isArray(scope.recipientPlayerIds);
  const recipients = hasRecipientFilter ? new Set(scope.recipientPlayerIds) : null;
  if (config.authMode === 'legacy') {
    // A legacy socket has neither a session-bound player id nor a validated
    // group subscription. Falling back to io.emit for a personally targeted
    // payload would disclose it to every browser and kiosk, so the safe
    // compatibility behavior is no realtime delivery. The persisted entry
    // remains available through the recipient's authenticated history after
    // upgrading to required mode.
    if (hasRecipientFilter) return;
    io.emit(event, payload);
    return;
  }
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
  // handshake claim alone must never select the kiosk path). Legacy mode is
  // handled above via io.emit, kiosk screens included.
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.kioskReadOnly) {
      if (recipients) continue; // personally targeted payloads never reach the shared screen
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

// Public, read-only stream for the shared kiosk. Callers must only pass
// deliberately sanitised game state; this is separate from private match
// rooms so the kiosk can follow a match without joining it.
export function broadcastArcadeKiosk(io: Server, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return;
  const record = payload as Record<string, unknown>;
  const matchId = typeof record.matchId === 'string' && record.matchId ? record.matchId : null;
  const previous = matchId ? latestArcadeGames.get(matchId) : undefined;
  const requestedScope = arcadePayloadScope(record);
  const previousScope = previous ? arcadePayloadScope(previous) : null;
  if (requestedScope && previousScope && arcadeScopeKey(requestedScope) !== arcadeScopeKey(previousScope)) {
    // eslint-disable-next-line no-console
    console.error('[realtime] Änderung des immutable Arcade-Scopes verweigert.');
    return;
  }
  const scope = previousScope ?? requestedScope;
  if (!scope) {
    // eslint-disable-next-line no-console
    console.error('[realtime] Arcade-Auslieferung ohne immutable Gruppen-/Event-Scope verweigert.');
    return;
  }
  const scopedPayload = { ...record, groupId: scope.groupId, eventId: scope.eventId };

  if (record.gameType === null) {
    if (matchId) {
      latestArcadeGames.delete(matchId);
      emitArcadeWatchRoom(io, matchId, 'arcade:watch:ended', { matchId }, scope);
    }
    emitArcadeWatchList(io);
    const latest = latestArcadeKioskGames.get(arcadeScopeKey(scope));
    if (!matchId || latest?.matchId === matchId) latestArcadeKioskGames.set(arcadeScopeKey(scope), scopedPayload);
  } else if (matchId) {
    const next = { ...(previous ?? {}), ...scopedPayload };
    latestArcadeGames.set(matchId, next);
    latestArcadeKioskGames.set(arcadeScopeKey(scope), next);
    emitArcadeWatchRoom(io, matchId, 'arcade:watch:state', watchState(next), scope);
    if (JSON.stringify(watchSummary(previous ?? {})) !== JSON.stringify(watchSummary(next))) emitArcadeWatchList(io);
  } else {
    latestArcadeKioskGames.set(arcadeScopeKey(scope), scopedPayload);
  }

  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.kioskReadOnly ? kioskCanUseArcadeScope(socket, scope) : normalSocketCanUseArcadeScope(socket, scope)) {
      socket.emit('arcade:kiosk:game', scopedPayload);
    }
  }
}

export function registerArcadeKioskSockets(server: Server): void {
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
      emitArcadeWatchListToSocket(socket);
      ack?.({ ok: true, groupId, eventId: typeof eventId === 'string' && eventId ? eventId : null });
    };
    // Browser clients use scope:subscribe; aliases keep the transport easy
    // to consume from the agent and make re-rooming explicit.
    socket.on('scope:subscribe', subscribe);
    socket.on('room:subscribe', subscribe);
    socket.on('scope:leave', () => clearSocketScope(socket));
    socket.on('kiosk:subscribe', (payload?: { groupId?: unknown; eventId?: unknown }, ack?: (result: unknown) => void) => {
      const requestedGroup = payload?.groupId;
      const requestedEvent = payload?.eventId;
      const groupMatches = requestedGroup === undefined || requestedGroup === socket.data.kioskGroupId;
      // kiosk.js emits kiosk:subscribe without a payload, so an absent event
      // must fall back to the socket's already-bound token scope. Requiring an
      // explicit match otherwise rejected every event kiosk's replay request
      // (kioskEventId set, requestedEvent undefined) and left it blank on join.
      const eventMatches =
        requestedEvent === undefined
          ? true
          : socket.data.kioskEventId === null
            ? requestedEvent === null
            : requestedEvent === socket.data.kioskEventId;
      if (!socket.data.kioskReadOnly || !groupMatches || !eventMatches || !kioskDeliveryAllowed(socket)) {
        ack?.({ ok: false, error: 'Kiosk-Scope stimmt nicht mit dem Token überein.' });
        return;
      }
      const replay = latestArcadeKioskGames.get(arcadeScopeKey({
        groupId: socket.data.kioskGroupId as string,
        eventId: (socket.data.kioskEventId ?? null) as string | null,
      }));
      if (replay) socket.emit('arcade:kiosk:game', replay);
      ack?.({ ok: true, groupId: socket.data.kioskGroupId, eventId: socket.data.kioskEventId });
    });
    // Same kiosk exclusion as emitArcadeWatchList: the initial list on
    // connect must not show a read-only kiosk match summaries outside its token's
    // retained group/event scope.
    socket.on('arcade:watch:list', () => emitArcadeWatchListToSocket(socket));
    socket.on('arcade:watch:join', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const matchId = payload?.matchId;
      if (typeof matchId !== 'string' || !latestArcadeGames.has(matchId)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const match = latestArcadeGames.get(matchId)!;
      const scope = arcadePayloadScope(match);
      if (!scope || !normalSocketCanUseArcadeScope(socket, scope)) {
        return ack?.({ ok: false, error: 'Match gehört zu einem anderen Gruppen- oder Event-Scope.' });
      }
      if (socket.data.groupId && match.groupId !== socket.data.groupId) return ack?.({ ok: false, error: 'Match gehört zu einer anderen Gruppe.' });
      if (socket.data.groupId && !activeGroupMember(socket.data.groupId, socket.data.authPlayerId)) return ack?.({ ok: false, error: 'Gruppenzugriff verweigert.' });
      const previousRoom = socket.data.arcadeWatchRoom;
      const previousMatchId = socket.data.arcadeWatchMatchId;
      if (typeof previousRoom === 'string') socket.leave(previousRoom);
      notifyArcadeWatcherChange(server, previousMatchId);
      const playerId = spectatorPlayerId(match, payload?.playerId);
      const room = watchRoom(matchId);
      socket.join(room);
      socket.data.arcadeWatchRoom = room;
      socket.data.arcadeWatchMatchId = matchId;
      if (playerId) socket.data.arcadeWatchPlayerId = playerId;
      else delete socket.data.arcadeWatchPlayerId;
      socket.emit('arcade:watch:state', watchState(match));
      notifyArcadeWatcherChange(server, matchId);
      ack?.({ ok: true, matchId, votingPlayerId: playerId, canVote: playerId !== null });
    });
    socket.on('arcade:watch:leave', () => {
      const room = socket.data.arcadeWatchRoom;
      const matchId = socket.data.arcadeWatchMatchId;
      if (typeof room === 'string') socket.leave(room);
      notifyArcadeWatcherChange(server, matchId);
      delete socket.data.arcadeWatchRoom;
      delete socket.data.arcadeWatchMatchId;
      delete socket.data.arcadeWatchPlayerId;
    });
    socket.on('disconnect', () => notifyArcadeWatcherChange(server, socket.data.arcadeWatchMatchId));
  });
}

// Socket.IO connections bypass Express middleware entirely, so their access
// rules mirror the REST API here: required mode accepts only a valid user
// session, while legacy mode also supports the shared ACCESS_TOKEN.
// Parameterized (defaulting to config.accessToken) so the exact matching
// logic is unit-testable without depending on process-wide env state.
//
// Same-origin clients send the session cookie automatically. In legacy mode,
// an existing user session remains a valid alternative to the shared token.
export function createSocketAuthGuard(
  accessToken: string = config.accessToken,
  authMode: 'legacy' | 'required' = config.authMode,
  kioskToken: string = config.kioskToken
) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    const kioskScope = socket.handshake.auth?.kiosk === true ? resolveKioskToken(socket.handshake.auth?.token) : null;
    if (
      authMode === 'required' &&
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
      if (authMode === 'required') {
        socket.use(([_, payload], proceed) => {
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            (payload as Record<string, unknown>).playerId = resolved.player.id;
          }
          proceed();
        });
      }
      return next();
    }
    if (authMode === 'required') return next(new Error('unauthorized'));
    if (!accessToken) return next();
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    if (token === accessToken) return next();
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
