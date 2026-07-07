// Thin wrapper around Socket.IO so route handlers can push events without
// importing the server internals. Set once at startup via setIo().

import { Server } from 'socket.io';

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

// Event name constants keep client and server in sync and avoid typos.
export const Events = {
  playersChanged: 'players:changed',
  gamesChanged: 'games:changed',
  skillsChanged: 'skills:changed',
  liveStatusChanged: 'live:changed',
  votesChanged: 'votes:changed',
  leaderboardChanged: 'leaderboard:changed',
  matchmakingGenerated: 'matchmaking:generated',
  eventsChanged: 'events:changed',
  tournamentsChanged: 'tournaments:changed',
} as const;
