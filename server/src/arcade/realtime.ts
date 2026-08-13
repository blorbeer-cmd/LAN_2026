import { Server, Socket } from 'socket.io';
import { db } from '../db';
import { activeEventAccess, activeGroupMember, kioskDeliveryAllowed } from '../realtime';

interface ArcadeDeliveryScope {
  groupId: string;
  eventId: string | null;
}

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
      .filter((id): id is string => id !== null),
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
  return [
    ...new Set(
      [...socketIds]
        .map((socketId) => {
          const socket = server.sockets.sockets.get(socketId);
          return socket && normalSocketCanUseArcadeScope(socket, scope) ? socket.data.arcadeWatchPlayerId : null;
        })
        .filter((playerId): playerId is string => typeof playerId === 'string' && !!playerId),
    ),
  ];
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
  return typeof payload.groupId === 'string' &&
    payload.groupId &&
    Object.prototype.hasOwnProperty.call(payload, 'eventId') &&
    typeof payload.eventId === 'string' && payload.eventId
    ? { groupId: payload.groupId, eventId: payload.eventId as string | null }
    : null;
}

function normalSocketCanUseArcadeScope(socket: Socket, scope: ArcadeDeliveryScope): boolean {
  if (socket.data.kioskReadOnly) return false;
  const socketEventId = typeof socket.data.eventId === 'string' && socket.data.eventId ? socket.data.eventId : null;
  if (socket.data.groupId !== scope.groupId || socketEventId !== scope.eventId) return false;
  if (!activeGroupMember(scope.groupId, socket.data.authPlayerId)) return false;
  return scope.eventId !== null && activeEventAccess(scope.groupId, scope.eventId, socket.data.authPlayerId);
}

function kioskCanUseArcadeScope(socket: Socket, scope: ArcadeDeliveryScope): boolean {
  return Boolean(
    socket.data.kioskReadOnly &&
    socket.data.kioskGroupId === scope.groupId &&
    (socket.data.kioskEventId ?? null) === scope.eventId &&
    kioskDeliveryAllowed(socket),
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
  if (typeof socket.data.groupId === 'string') socket.emit('arcade:watch:list', { matches });
}

function emitArcadeWatchList(server: Server): void {
  for (const socket of server.sockets.sockets.values()) emitArcadeWatchListToSocket(socket);
}

function emitArcadeWatchRoom(
  server: Server,
  matchId: string,
  event: string,
  payload: unknown,
  scope: ArcadeDeliveryScope,
): void {
  const socketIds = server.sockets.adapter.rooms.get(watchRoom(matchId)) ?? new Set<string>();
  for (const socketId of socketIds) {
    const socket = server.sockets.sockets.get(socketId);
    if (socket && normalSocketCanUseArcadeScope(socket, scope)) socket.emit(event, payload);
  }
}

export function broadcastArcadeKiosk(io: Server, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return;
  const record = payload as Record<string, unknown>;
  const matchId = typeof record.matchId === 'string' && record.matchId ? record.matchId : null;
  const previous = matchId ? latestArcadeGames.get(matchId) : undefined;
  const requestedScope = arcadePayloadScope(record);
  const previousScope = previous ? arcadePayloadScope(previous) : null;
  if (requestedScope && previousScope && arcadeScopeKey(requestedScope) !== arcadeScopeKey(previousScope)) {
    // eslint-disable-next-line no-console
    console.error('[arcade/realtime] Änderung des immutable Arcade-Scopes verweigert.');
    return;
  }
  const scope = previousScope ?? requestedScope;
  if (!scope) {
    // eslint-disable-next-line no-console
    console.error('[arcade/realtime] Arcade-Auslieferung ohne immutable Gruppen-/Event-Scope verweigert.');
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
    if (
      socket.data.kioskReadOnly ? kioskCanUseArcadeScope(socket, scope) : normalSocketCanUseArcadeScope(socket, scope)
    ) {
      socket.emit('arcade:kiosk:game', scopedPayload);
    }
  }
}

export function registerArcadeSockets(server: Server): void {
  server.on('connection', (socket) => {
    socket.on('scope:subscribe', () => emitArcadeWatchListToSocket(socket));
    socket.on('room:subscribe', () => emitArcadeWatchListToSocket(socket));
    socket.on(
      'kiosk:subscribe',
      (payload?: { groupId?: unknown; eventId?: unknown }, ack?: (result: unknown) => void) => {
        const requestedGroup = payload?.groupId;
        const requestedEvent = payload?.eventId;
        const groupMatches = requestedGroup === undefined || requestedGroup === socket.data.kioskGroupId;
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
        const replay = latestArcadeKioskGames.get(
          arcadeScopeKey({
            groupId: socket.data.kioskGroupId as string,
            eventId: (socket.data.kioskEventId ?? null) as string | null,
          }),
        );
        if (replay) socket.emit('arcade:kiosk:game', replay);
        ack?.({ ok: true, groupId: socket.data.kioskGroupId, eventId: socket.data.kioskEventId });
      },
    );
    socket.on('arcade:watch:list', () => emitArcadeWatchListToSocket(socket));
    socket.on(
      'arcade:watch:join',
      (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
        const matchId = payload?.matchId;
        if (typeof matchId !== 'string' || !latestArcadeGames.has(matchId))
          return ack?.({ ok: false, error: 'Match nicht gefunden.' });
        const match = latestArcadeGames.get(matchId)!;
        const scope = arcadePayloadScope(match);
        if (!scope || !normalSocketCanUseArcadeScope(socket, scope)) {
          return ack?.({ ok: false, error: 'Match gehört zu einem anderen Gruppen- oder Event-Scope.' });
        }
        if (socket.data.groupId && match.groupId !== socket.data.groupId)
          return ack?.({ ok: false, error: 'Match gehört zu einer anderen Gruppe.' });
        if (socket.data.groupId && !activeGroupMember(socket.data.groupId, socket.data.authPlayerId))
          return ack?.({ ok: false, error: 'Gruppenzugriff verweigert.' });
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
      },
    );
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
