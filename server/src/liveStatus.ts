// Shared live-status helpers. Kept separate from the route file because the
// offline sweeper also runs on a timer at startup, independent of any request.
//
// A player can have SEVERAL games running at once (e.g. a launcher plus the
// actual game, or genuinely two games side by side), so live state is a list
// of currently detected games per player, not a single game_id.

import { Server } from 'socket.io';
import { db } from './db';
import { config } from './config';
import { broadcast, Events } from './realtime';

export interface LiveGameEntry {
  game_id: string;
  game_name: string;
  game_icon: string;
  since: number;
}

export interface LiveBoardEntry {
  player_id: string;
  name: string;
  color: string;
  last_seen: number | null;
  manual_note: string | null;
  games: LiveGameEntry[];
  state: LiveState;
}

export type LiveState = 'playing' | 'paused' | 'offline';

// Pure derivation rule, kept independent of the exact row shape so it's easy
// to unit-test: playing if the agent reported recently AND at least one game
// is currently detected; paused if a manual note is set (regardless of agent
// freshness — it's a player-set override); otherwise offline.
export function deriveState(
  input: { last_seen: number | null; manual_note: string | null; activeGamesCount: number },
  now: number
): LiveState {
  const fresh = input.last_seen != null && now - input.last_seen <= config.offlineTimeoutMs;
  if (fresh && input.activeGamesCount > 0) return 'playing';
  if (input.manual_note) return 'paused';
  return 'offline';
}

// Returns the full board: every player plus their currently detected games and
// derived state. Players without any live_status row still appear (offline).
export function getLiveBoard(): LiveBoardEntry[] {
  const now = Date.now();

  const players = db
    .prepare('SELECT id, name, color FROM players ORDER BY name COLLATE NOCASE')
    .all() as Array<{ id: string; name: string; color: string }>;

  const statusRows = db
    .prepare('SELECT player_id, last_seen, manual_note FROM live_status')
    .all() as Array<{ player_id: string; last_seen: number; manual_note: string | null }>;
  const statusByPlayer = new Map(statusRows.map((r) => [r.player_id, r]));

  const gameRows = db
    .prepare(
      `SELECT lsg.player_id, lsg.game_id, g.name AS game_name, g.icon AS game_icon, lsg.since
       FROM live_status_games lsg
       JOIN games g ON g.id = lsg.game_id
       ORDER BY lsg.since ASC`
    )
    .all() as Array<{
    player_id: string;
    game_id: string;
    game_name: string;
    game_icon: string;
    since: number;
  }>;

  const gamesByPlayer = new Map<string, LiveGameEntry[]>();
  for (const row of gameRows) {
    const list = gamesByPlayer.get(row.player_id) ?? [];
    list.push({
      game_id: row.game_id,
      game_name: row.game_name,
      game_icon: row.game_icon,
      since: row.since,
    });
    gamesByPlayer.set(row.player_id, list);
  }

  return players.map((p) => {
    const status = statusByPlayer.get(p.id);
    const games = gamesByPlayer.get(p.id) ?? [];
    const lastSeen = status?.last_seen ?? null;
    const manualNote = status?.manual_note ?? null;
    return {
      player_id: p.id,
      name: p.name,
      color: p.color,
      last_seen: lastSeen,
      manual_note: manualNote,
      games,
      state: deriveState({ last_seen: lastSeen, manual_note: manualNote, activeGamesCount: games.length }, now),
    };
  });
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
