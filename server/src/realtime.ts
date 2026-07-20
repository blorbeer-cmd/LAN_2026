// Thin wrapper around Socket.IO so route handlers can push events without
// importing the server internals. Set once at startup via setIo().

import { Server, Socket } from 'socket.io';
import { config } from './config';
import { db, DEFAULT_GROUP_ID } from './db';
import { isSessionActive, parseCookieHeader, verifySession, SESSION_COOKIE_NAME } from './sessions';
import { resolveKioskToken } from './kioskTokens';

let io: Server | null = null;
let authSessionSweep: NodeJS.Timeout | null = null;
let latestArcadeKioskGame: unknown = null;
const latestArcadeGames = new Map<string, Record<string, unknown>>();
type ArcadeWatcherChangeListener = (server: Server, matchId: string) => void;
const arcadeWatcherChangeListeners = new Set<ArcadeWatcherChangeListener>();

function watchRoom(matchId: string): string {
  return `arcade-watch:${matchId}`;
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

function activeEventParticipant(groupId: string, eventId: string, playerId: unknown): boolean {
  return activeGroupMember(groupId, playerId) && Boolean(db.prepare(
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
    activeEventParticipant(groupId, eventId, socket.data.authPlayerId);
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
  if (typeof eventId === 'string' && !activeEventParticipant(groupId, eventId, socket.data.authPlayerId)) {
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
  const socketIds = server.sockets.adapter.rooms.get(watchRoom(matchId)) ?? new Set<string>();
  return [...new Set(
    [...socketIds]
      .map((socketId) => server.sockets.sockets.get(socketId)?.data.arcadeWatchPlayerId)
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

function emitArcadeWatchList(server: Server): void {
  for (const socket of server.sockets.sockets.values()) {
    // Read-only kiosks never consume watch lists — their only arcade channel
    // is the deliberately sanitised arcade:kiosk:game stream. Without this
    // guard they would receive summaries (player refs, scores) of every
    // group, since they carry no subscribed groupId to filter on.
    if (socket.data.kioskReadOnly) continue;
    socket.emit('arcade:watch:list', { matches: [...latestArcadeGames.values()]
      .filter((match) => !socket.data.groupId || match.groupId === socket.data.groupId).map(watchSummary) });
  }
}

function payloadGroupId(payload: Record<string, unknown>): string | null {
  if (typeof payload.groupId === 'string' && payload.groupId) return payload.groupId;
  const id = [...arcadePlayerIds(payload)][0];
  if (!id) return null;
  const row = db.prepare("SELECT group_id AS groupId FROM group_memberships WHERE player_id = ? AND status = 'active' ORDER BY joined_at LIMIT 1").get(id) as { groupId: string } | undefined;
  return row?.groupId ?? null;
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
  // Legacy mode cannot enforce this — its sockets carry no identity.
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
  if (config.authMode === 'legacy') {
    io.emit(event, payload);
    return;
  }
  // Unit/test adapters may expose only the historical io.emit surface.
  if (!io.sockets?.sockets) {
    io.emit(event, payload);
    return;
  }
  // Socket.IO rooms are only a routing hint. Re-check the current membership
  // at delivery time so a revoke/group switch cannot leak a queued payload.
  // Kiosk sockets are authenticated with a read-only kiosk token rather than
  // a player session; only the server-set kioskReadOnly flag counts (a
  // handshake claim alone must never select the kiosk path). Legacy mode is
  // handled above via io.emit, kiosk screens included.
  const recipients = scope.recipientPlayerIds ? new Set(scope.recipientPlayerIds) : null;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.kioskReadOnly) {
      if (recipients) continue; // personally targeted payloads never reach the shared screen
      if (!KIOSK_DELIVERED_EVENTS.has(event)) continue;
      if (socket.data.kioskGroupId !== groupId) continue;
      if (!kioskDeliveryAllowed(socket)) continue;
      if (event === 'push:sent') {
        // The push banner is the one payload the kiosk renders directly, so
        // it is delivered only for the kiosk's exact scope: a group kiosk
        // never shows an event-only banner and an event kiosk never shows a
        // group-room one.
        if ((socket.data.kioskEventId ?? null) !== eventId) continue;
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
    if (eventId && !activeEventParticipant(groupId, eventId, socket.data.authPlayerId)) continue;
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
  if (typeof payload === 'object' && payload !== null && 'gameType' in payload && (payload as { gameType?: unknown }).gameType === null) {
    const endingMatchId = (payload as { matchId?: unknown }).matchId;
    const currentMatchId = (latestArcadeKioskGame as { matchId?: unknown } | null)?.matchId;
    if (typeof endingMatchId === 'string') {
      latestArcadeGames.delete(endingMatchId);
      io.to(watchRoom(endingMatchId)).emit('arcade:watch:ended', { matchId: endingMatchId });
    }
    emitArcadeWatchList(io);
    if (endingMatchId !== currentMatchId) return;
    latestArcadeKioskGame = payload;
    for (const socket of io.sockets.sockets.values()) {
      const targetGroup = payloadGroupId(payload as Record<string, unknown>);
      if (socket.data.kioskReadOnly && (!kioskDeliveryAllowed(socket) || (targetGroup && socket.data.kioskGroupId !== targetGroup))) continue;
      if (!socket.data.kioskReadOnly && socket.data.groupId && targetGroup && socket.data.groupId !== targetGroup) continue;
      socket.emit('arcade:kiosk:game', payload);
    }
    return;
  }
  if (typeof payload === 'object' && payload !== null && typeof (payload as { matchId?: unknown }).matchId === 'string') {
    const matchId = (payload as { matchId: string }).matchId;
    const previous = latestArcadeGames.get(matchId);
    const next = { ...(latestArcadeGames.get(matchId) ?? {}), ...(payload as Record<string, unknown>) };
    const groupId = payloadGroupId(next);
    if (groupId) next.groupId = groupId;
    latestArcadeGames.set(matchId, next);
    io.to(watchRoom(matchId)).emit('arcade:watch:state', watchState(next));
    if (JSON.stringify(watchSummary(previous ?? {})) !== JSON.stringify(watchSummary(next))) emitArcadeWatchList(io);
  }
  latestArcadeKioskGame = payload;
  for (const socket of io.sockets.sockets.values()) {
    const targetGroup = typeof payload === 'object' && payload !== null ? payloadGroupId(payload as Record<string, unknown>) : null;
    if (socket.data.kioskReadOnly && (!kioskDeliveryAllowed(socket) || (targetGroup && socket.data.kioskGroupId !== targetGroup))) continue;
    if (!socket.data.kioskReadOnly && socket.data.groupId && targetGroup && socket.data.groupId !== targetGroup) continue;
    socket.emit('arcade:kiosk:game', payload);
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
      const eventMatches = socket.data.kioskEventId === null
        ? requestedEvent === undefined || requestedEvent === null
        : requestedEvent === socket.data.kioskEventId;
      if (!socket.data.kioskReadOnly || !groupMatches || !eventMatches || !kioskDeliveryAllowed(socket)) {
        ack?.({ ok: false, error: 'Kiosk-Scope stimmt nicht mit dem Token überein.' });
        return;
      }
      if (!latestArcadeKioskGame || socket.data.kioskGroupId === payloadGroupId(latestArcadeKioskGame as Record<string, unknown>)) {
        socket.emit('arcade:kiosk:game', latestArcadeKioskGame);
      }
      ack?.({ ok: true, groupId: socket.data.kioskGroupId, eventId: socket.data.kioskEventId });
    });
    // Same kiosk exclusion as emitArcadeWatchList: the initial list on
    // connect must not hand a read-only kiosk cross-group match summaries.
    if (!socket.data.kioskReadOnly) {
      socket.emit('arcade:watch:list', { matches: [...latestArcadeGames.values()]
        .filter((match) => !socket.data.groupId || match.groupId === socket.data.groupId).map(watchSummary) });
    }
    socket.on('arcade:watch:list', () => emitArcadeWatchList(server));
    socket.on('arcade:watch:join', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const matchId = payload?.matchId;
      if (typeof matchId !== 'string' || !latestArcadeGames.has(matchId)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const match = latestArcadeGames.get(matchId)!;
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
      socket.emit('arcade:watch:state', watchState(latestArcadeGames.get(matchId)!));
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
