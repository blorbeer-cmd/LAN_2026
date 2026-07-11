// Thin wrapper around Socket.IO so route handlers can push events without
// importing the server internals. Set once at startup via setIo().

import { Server, Socket } from 'socket.io';
import { config } from './config';

let io: Server | null = null;

export function setIo(server: Server): void {
  io = server;
}

// Broadcast an event to every connected client. Safe to call before io is set
// (during early startup) — it simply no-ops.
export function broadcast(event: string, payload: unknown): void {
  if (!io) return;
  io.emit(event, payload);
}

// Socket.IO connections bypass Express middleware entirely, so the REST
// access-token gate (requireAccess) never sees them. Without this, realtime
// data (live status, votes, leaderboard) would leak to anyone who opens a
// WebSocket, even with ACCESS_TOKEN set — enforce the same shared token here.
// Parameterized (defaulting to config.accessToken) so the exact matching
// logic is unit-testable without depending on process-wide env state.
export function createSocketAuthGuard(accessToken: string = config.accessToken) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    if (!accessToken) return next();
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    if (token === accessToken) return next();
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
  infoChanged: 'info:changed',
  foodOrdersChanged: 'foodOrders:changed',
  arrivalsChanged: 'arrivals:changed',
  pushSent: 'push:sent',
} as const;
