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
      if (typeof sessionId === 'string' && (!isSessionActive(sessionId) || !activeGroupMember(String(socket.data.groupId ?? ''), socket.data.authPlayerId))) {
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

// Broadcast an event to every connected client. Safe to call before io is set
// (during early startup) — it simply no-ops.
export function broadcast(event: string, payload: unknown, scope?: { groupId?: string | null; eventId?: string | null }): void {
  if (!io) return;
  const groupId = scope?.groupId ?? (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).groupId === 'string'
    ? (payload as Record<string, unknown>).groupId as string : null);
  const eventId = scope?.eventId ?? (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).eventId === 'string'
    ? (payload as Record<string, unknown>).eventId as string : null);
  if (!groupId) {
    if (config.authMode === 'legacy') io.emit(event, payload);
    return;
  }
  // Unit/test adapters may expose only the historical io.emit surface.
  if (!io.sockets?.sockets) {
    io.emit(event, payload);
    return;
  }
  // Socket.IO rooms are only a routing hint. Re-check the current membership
  // at delivery time so a revoke/group switch cannot leak a queued payload.
  for (const socket of io.sockets.sockets.values()) {
    if (!activeGroupMember(groupId, socket.data.authPlayerId)) continue;
    if (eventId && !activeEventParticipant(groupId, eventId, socket.data.authPlayerId)) continue;
    if (socket.data.groupId !== groupId) continue;
    socket.emit(event, payload);
  }
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
      if (socket.data.kioskReadOnly && targetGroup && socket.data.kioskGroupId !== targetGroup) continue;
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
    if (socket.data.kioskReadOnly && targetGroup && socket.data.kioskGroupId !== targetGroup) continue;
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
      if (!socket.data.kioskReadOnly || !groupMatches || !eventMatches) {
        ack?.({ ok: false, error: 'Kiosk-Scope stimmt nicht mit dem Token überein.' });
        return;
      }
      if (!latestArcadeKioskGame || socket.data.kioskGroupId === payloadGroupId(latestArcadeKioskGame as Record<string, unknown>)) {
        socket.emit('arcade:kiosk:game', latestArcadeKioskGame);
      }
      ack?.({ ok: true, groupId: socket.data.kioskGroupId, eventId: socket.data.kioskEventId });
    });
    socket.emit('arcade:watch:list', { matches: [...latestArcadeGames.values()]
      .filter((match) => !socket.data.groupId || match.groupId === socket.data.groupId).map(watchSummary) });
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
  pushSent: 'push:sent',
  pushChanged: 'push:changed',
  pushSeen: 'push:seen',
} as const;
