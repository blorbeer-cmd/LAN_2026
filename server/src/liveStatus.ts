// Shared live-status helpers. Kept separate from the route file because the
// offline sweeper also runs on a timer at startup, independent of any request.

import { Server } from 'socket.io';
import { db } from './db';
import { config } from './config';
import { broadcast, Events } from './realtime';

export interface LiveStatusRow {
  player_id: string;
  name: string;
  color: string;
  game_id: string | null;
  game_name: string | null;
  game_icon: string | null;
  since: number | null;
  last_seen: number | null;
  manual_note: string | null;
}

// A player is "playing" if they reported a game within the timeout window,
// "paused" if they have a manual note but no active game, otherwise "offline".
export type LiveState = 'playing' | 'paused' | 'offline';

export function deriveState(row: LiveStatusRow, now: number): LiveState {
  const fresh = row.last_seen != null && now - row.last_seen <= config.offlineTimeoutMs;
  if (fresh && row.game_id) return 'playing';
  if (row.manual_note) return 'paused';
  return 'offline';
}

// Returns the full board: every player plus their derived live state. Left-join
// so players without any status row still appear (as offline).
export function getLiveBoard(): Array<LiveStatusRow & { state: LiveState }> {
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT p.id AS player_id, p.name, p.color,
              ls.game_id, g.name AS game_name, g.icon AS game_icon,
              ls.since, ls.last_seen, ls.manual_note
       FROM players p
       LEFT JOIN live_status ls ON ls.player_id = p.id
       LEFT JOIN games g ON g.id = ls.game_id
       ORDER BY p.name COLLATE NOCASE`
    )
    .all() as LiveStatusRow[];
  return rows.map((r) => ({ ...r, state: deriveState(r, now) }));
}

// Periodically re-broadcasts the board so clients transition players to
// "offline" even when no new report arrives (e.g. a PC was switched off).
export function startOfflineSweeper(_io: Server): void {
  // Half the timeout is a good cadence: reacts quickly without busy-looping.
  const interval = Math.max(5_000, Math.floor(config.offlineTimeoutMs / 2));
  setInterval(() => {
    try {
      broadcast(Events.liveStatusChanged, getLiveBoard());
    } catch (err) {
      // Never let a sweep error take down the timer/process.
      // eslint-disable-next-line no-console
      console.error('Offline sweep failed:', err);
    }
  }, interval).unref();
}
