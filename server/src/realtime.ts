// Thin wrapper around Socket.IO so route handlers can push events without
// importing the server internals. Set once at startup via setIo().

import { Server, Socket } from 'socket.io';
import { config } from './config';
import { db } from './db';
import { parseCookieHeader, verifySession, SESSION_COOKIE_NAME } from './sessions';

let io: Server | null = null;
let latestArcadeKioskGame: unknown = null;
const latestArcadeGames = new Map<string, Record<string, unknown>>();
type ArcadeWatcherChangeListener = (server: Server, matchId: string) => void;
const arcadeWatcherChangeListeners = new Set<ArcadeWatcherChangeListener>();

function watchRoom(matchId: string): string {
  return `arcade-watch:${matchId}`;
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
  server.emit('arcade:watch:list', { matches: [...latestArcadeGames.values()].map(watchSummary) });
}

export function setIo(server: Server): void {
  io = server;
}

// Broadcast an event to every connected client. Safe to call before io is set
// (during early startup) — it simply no-ops.
export function broadcast(event: string, payload: unknown): void {
  if (!io) return;
  io.emit(event, payload);
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
    io.emit('arcade:kiosk:game', payload);
    return;
  }
  if (typeof payload === 'object' && payload !== null && typeof (payload as { matchId?: unknown }).matchId === 'string') {
    const matchId = (payload as { matchId: string }).matchId;
    const previous = latestArcadeGames.get(matchId);
    const next = { ...(latestArcadeGames.get(matchId) ?? {}), ...(payload as Record<string, unknown>) };
    latestArcadeGames.set(matchId, next);
    io.to(watchRoom(matchId)).emit('arcade:watch:state', watchState(next));
    if (JSON.stringify(watchSummary(previous ?? {})) !== JSON.stringify(watchSummary(next))) emitArcadeWatchList(io);
  }
  latestArcadeKioskGame = payload;
  io.emit('arcade:kiosk:game', payload);
}

export function registerArcadeKioskSockets(server: Server): void {
  server.on('connection', (socket) => {
    socket.on('kiosk:subscribe', () => socket.emit('arcade:kiosk:game', latestArcadeKioskGame));
    socket.emit('arcade:watch:list', { matches: [...latestArcadeGames.values()].map(watchSummary) });
    socket.on('arcade:watch:list', () => emitArcadeWatchList(server));
    socket.on('arcade:watch:join', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const matchId = payload?.matchId;
      if (typeof matchId !== 'string' || !latestArcadeGames.has(matchId)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const previousRoom = socket.data.arcadeWatchRoom;
      const previousMatchId = socket.data.arcadeWatchMatchId;
      if (typeof previousRoom === 'string') socket.leave(previousRoom);
      notifyArcadeWatcherChange(server, previousMatchId);
      const playerId = spectatorPlayerId(latestArcadeGames.get(matchId)!, payload?.playerId);
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

// Socket.IO connections bypass Express middleware entirely, so the REST
// access-token gate (requireAccess) never sees them. Without this, realtime
// data (live status, votes, leaderboard) would leak to anyone who opens a
// WebSocket, even with ACCESS_TOKEN set — enforce the same shared token here.
// Parameterized (defaulting to config.accessToken) so the exact matching
// logic is unit-testable without depending on process-wide env state.
//
// A valid per-user session cookie (see sessions.ts) is accepted as an
// alternative to the token: a browser that already holds one got there by
// passing this exact gate once already (the login/register gate only shows
// up after the shared-token screen, see public/js/authGate.js), and
// same-origin requests carry cookies automatically — nothing extra for the
// Socket.IO client to do. This does not replace the token — both still
// coexist until the shared token is retired (see
// docs/KONZEPT-USER-MANAGEMENT.md phase 4).
export function createSocketAuthGuard(accessToken: string = config.accessToken) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    if (!accessToken) return next();
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    if (token === accessToken) return next();
    const sessionToken = parseCookieHeader(socket.handshake.headers.cookie)[SESSION_COOKIE_NAME];
    if (sessionToken && verifySession(sessionToken)) return next();
    next(new Error('unauthorized'));
  };
}

// Event name constants keep client and server in sync and avoid typos.
export const Events = {
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
  pushSent: 'push:sent',
  pushChanged: 'push:changed',
  pushSeen: 'push:seen',
} as const;
