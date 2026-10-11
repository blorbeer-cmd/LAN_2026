// One reconnect grace for every Arcade game. A phone that locks its screen
// or switches apps drops its socket and comes back on a new one; until the
// grace runs out the player is only "away", never gone, and the match keeps
// their seat for the new socket to claim back.

import { Socket } from 'socket.io';
import { ArcadeScope, canUseLobby, socketArcadeScope } from './scope';
import { arcadeTestTimersEnabled } from './timing';

export const RECONNECT_REFUSED = 'Das Match ist nicht mehr verfügbar.';

export const RECONNECT_GRACE_MS = 60_000;
// A paused match freezes the game, so when nobody else is waiting (a KI
// match, or every human is away) a player who locked their phone during the
// pause loses nothing by coming back later. The cap only stops an abandoned
// pause from holding the match (and its arcade session) open forever.
export const PAUSED_RECONNECT_GRACE_MS = 10 * 60_000;
// The fast test-timer profile shortens only the running grace: the suites
// close a socket or browser context to make a player vanish and expect the
// forfeit or host handover right away, but never wait out a paused grace.
const FAST_TIMER_RECONNECT_GRACE_MS = 250;

export function runningReconnectGraceMs(): number {
  return arcadeTestTimersEnabled(process.env) ? FAST_TIMER_RECONNECT_GRACE_MS : RECONNECT_GRACE_MS;
}

export function graceMsFor(
  { paused, otherHumanConnected }: { paused: boolean; otherHumanConnected: boolean },
  runningMs = runningReconnectGraceMs(),
): number {
  return paused && !otherHumanConnected ? PAUSED_RECONNECT_GRACE_MS : runningMs;
}

export interface GraceMatch {
  paused: boolean;
  players: Array<{ id: string }>;
  socketIds: Map<string, string>;
}

interface AwayEntry {
  since: number;
  graceMs: number;
  deadline: number;
  timer: NodeJS.Timeout | null;
}

// Tracks the players of one match whose socket is gone. Every change that
// can alter a grace (a disconnect, a return, a departure, a pause or resume)
// re-evaluates all pending countdowns: an unchanged grace keeps its deadline,
// a longer one counts from the disconnect and a shorter one gives at most
// the new grace from now.
export class ReconnectGrace {
  private readonly away = new Map<string, AwayEntry>();

  // The match is read lazily so a match can create its grace inside its own
  // object literal. Games with their own test override pass `runningGraceMs`.
  constructor(
    private readonly match: () => GraceMatch,
    private readonly isBot: (playerId: string) => boolean,
    private readonly onExpire: (playerId: string) => void,
    private readonly runningGraceMs: () => number = runningReconnectGraceMs,
  ) {}

  isAway(playerId: string): boolean {
    return this.away.has(playerId);
  }

  disconnected(playerId: string): void {
    this.match().socketIds.delete(playerId);
    if (!this.away.has(playerId)) this.away.set(playerId, { since: Date.now(), graceMs: 0, deadline: Infinity, timer: null });
    this.rearm();
  }

  returned(playerId: string): void {
    this.forget(playerId);
    this.rearm();
  }

  // The player left for good: no countdown remains for them, and the others
  // may now have nobody left to wait for.
  left(playerId: string): void {
    this.forget(playerId);
    this.rearm();
  }

  rearm(): void {
    const match = this.match();
    const now = Date.now();
    for (const [playerId, entry] of this.away) {
      const otherHumanConnected = match.players.some(
        (player) => player.id !== playerId && !this.isBot(player.id) && match.socketIds.has(player.id),
      );
      const graceMs = graceMsFor({ paused: match.paused, otherHumanConnected }, this.runningGraceMs());
      if (graceMs === entry.graceMs) continue;
      entry.deadline = graceMs > entry.graceMs ? entry.since + graceMs : Math.min(entry.deadline, now + graceMs);
      entry.graceMs = graceMs;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (this.away.get(playerId) !== entry) return;
        this.away.delete(playerId);
        this.onExpire(playerId);
      }, Math.max(0, entry.deadline - now));
      entry.timer.unref();
    }
  }

  clear(): void {
    for (const entry of this.away.values()) if (entry.timer) clearTimeout(entry.timer);
    this.away.clear();
  }

  private forget(playerId: string): void {
    const entry = this.away.get(playerId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.away.delete(playerId);
  }
}

export interface SeatMatch extends GraceMatch, ArcadeScope {
  room: string;
  grace: ReconnectGrace;
}

// Hands a player's seat in a still-running match to their new socket. Only
// the authenticated player themself may claim it, and only from the match's
// own group and event.
export function claimMatchSeat(
  socket: Socket,
  match: SeatMatch,
  playerId: unknown,
  isBot: (playerId: string) => boolean,
): playerId is string {
  if (
    typeof playerId !== 'string' ||
    isBot(playerId) ||
    !match.players.some((player) => player.id === playerId) ||
    !socketArcadeScope(socket, playerId) ||
    !canUseLobby(socket, match)
  ) {
    return false;
  }
  match.socketIds.set(playerId, socket.id);
  match.grace.returned(playerId);
  socket.join(match.room);
  return true;
}
