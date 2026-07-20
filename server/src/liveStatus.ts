// Shared live-status helpers. Kept separate from the route file because the
// offline sweeper also runs on a timer at startup, independent of any request.
//
// A player can have SEVERAL games running at once (e.g. a launcher plus the
// actual game, or genuinely two games side by side), so live state is a list
// of currently detected games per player, not a single game_id.

import { Server } from 'socket.io';
import { db, DEFAULT_GROUP_ID } from './db';
import { config } from './config';
import { broadcast, Events } from './realtime';
import { activePlayerGroupIds } from './groups';

export interface LiveGameEntry {
  game_id: string;
  game_name: string;
  game_icon: string;
  since: number;
  foreground: boolean;
}

export interface LiveBoardEntry {
  player_id: string;
  name: string;
  color: string;
  avatar: string | null;
  last_seen: number | null;
  manual_note: string | null;
  games: LiveGameEntry[];
  state: LiveState;
  // Whether the last report actually carried the foreground/idle signal
  // (the player's agent has "erweitertes Aktivitäts-Tracking" on) — tells the
  // frontend whether `foreground` above is meaningful or just unknown.
  activity_tracked: boolean;
}

export type LiveState = 'playing' | 'paused' | 'offline';

// Removes one player's currently detected games and closes their open play
// sessions. The next agent report starts a clean live-status window.
export function clearPlayerLiveStatus(playerId: string, endedAt = Date.now()): void {
  const cleanup = db.transaction(() => {
    db.prepare(
      'UPDATE play_sessions SET ended_at = ? WHERE player_id = ? AND ended_at IS NULL'
    ).run(endedAt, playerId);
    db.prepare('DELETE FROM tracking_live_games WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM tracking_live_contexts WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM live_status_games WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM live_status WHERE player_id = ?').run(playerId);
  });
  cleanup();
}

// Pure derivation rule, kept independent of the exact row shape so it's easy
// to unit-test: playing if the agent reported recently AND at least one game
// is currently detected; paused if a manual note is set (regardless of agent
// freshness — it's a player-set override); otherwise offline.
export function deriveState(
  input: { last_seen: number | null; manual_note: string | null; activeGamesCount: number },
  now: number
): LiveState {
  const fresh = input.last_seen != null && now - input.last_seen <= config.offlineTimeoutMs;
  // A player without an agent has no last_seen timestamp, so their explicit
  // manual note remains meaningful. Once an agent has reported but gone stale,
  // the stale note must not hide the offline state.
  if (input.manual_note && (input.last_seen == null || fresh)) return 'paused';
  if (fresh && input.activeGamesCount > 0) return 'playing';
  return 'offline';
}

// Returns the full board for one group: every active member plus their
// currently detected games (scoped to that group's catalog) and derived
// state. Members without any live_status row still appear (offline).
// live_status/agent_diagnostics themselves stay ungrouped (FR-13's presence
// heartbeat describes the physical PC, not a group), so a member seen from
// two groups would show the same last_seen/manual_note in both — only the
// games list and the roster are group-scoped.
export function getLiveBoard(groupId: string): LiveBoardEntry[] {
  const now = Date.now();

  // Legacy mode predates the group system: players created via the simple
  // "add a participant" flow never get a group_memberships row at all (there
  // is no account/onboarding step to attach one), so gating the roster on
  // membership there would silently drop them from their own live board.
  // Required mode enforces real membership like every other group-owned read.
  const players =
    config.authMode === 'legacy'
      ? (db
          .prepare('SELECT id, name, color, avatar FROM players WHERE deactivated_at IS NULL ORDER BY name COLLATE NOCASE')
          .all() as Array<{ id: string; name: string; color: string; avatar: string | null }>)
      : (db
          .prepare(
            `SELECT p.id, p.name, p.color, p.avatar
             FROM players p
             JOIN group_memberships gm ON gm.player_id = p.id
             WHERE p.deactivated_at IS NULL AND gm.group_id = ? AND gm.status = 'active'
             ORDER BY p.name COLLATE NOCASE`
          )
          .all(groupId) as Array<{ id: string; name: string; color: string; avatar: string | null }>);

  const statusRows = db
    .prepare('SELECT player_id, MAX(last_seen) AS last_seen, MAX(manual_note) AS manual_note, MAX(activity_tracked) AS activity_tracked FROM tracking_live_contexts WHERE group_id = ? GROUP BY player_id')
    .all(groupId) as Array<{ player_id: string; last_seen: number; manual_note: string | null; activity_tracked: number }>;
  const statusByPlayer = new Map(statusRows.map((r) => [r.player_id, r]));
  for (const row of db.prepare('SELECT player_id, last_seen, manual_note, activity_tracked FROM live_status').all() as Array<{ player_id: string; last_seen: number; manual_note: string | null; activity_tracked: number }>) {
    if (!statusByPlayer.has(row.player_id)) statusByPlayer.set(row.player_id, row);
  }

  const gameRows = db
    .prepare(
      `SELECT lsg.player_id, lsg.game_id, g.name AS game_name, g.icon AS game_icon, lsg.since, lsg.is_foreground
       FROM tracking_live_games lsg
       JOIN games g ON g.id = lsg.game_id
       WHERE lsg.group_id = ?
       ORDER BY lsg.since ASC`
    )
    .all(groupId) as Array<{
    player_id: string;
    game_id: string;
    game_name: string;
    game_icon: string;
    since: number;
    is_foreground: number;
  }>;

  const gamesByPlayer = new Map<string, LiveGameEntry[]>();
  for (const row of gameRows) {
    const list = gamesByPlayer.get(row.player_id) ?? [];
    list.push({
      game_id: row.game_id,
      game_name: row.game_name,
      game_icon: row.game_icon,
      since: row.since,
      foreground: Boolean(row.is_foreground),
    });
    gamesByPlayer.set(row.player_id, list);
  }
  for (const row of db.prepare(`SELECT lsg.player_id, lsg.game_id, g.name AS game_name, g.icon AS game_icon, lsg.since, lsg.is_foreground
    FROM live_status_games lsg JOIN games g ON g.id = lsg.game_id WHERE lsg.group_id = ?`).all(groupId) as Array<{player_id:string;game_id:string;game_name:string;game_icon:string;since:number;is_foreground:number}>) {
    const list = gamesByPlayer.get(row.player_id) ?? [];
    if (!list.some((game) => game.game_id === row.game_id)) list.push({ game_id: row.game_id, game_name: row.game_name, game_icon: row.game_icon, since: row.since, foreground: Boolean(row.is_foreground) });
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
      avatar: p.avatar,
      last_seen: lastSeen,
      manual_note: manualNote,
      games,
      state: deriveState({ last_seen: lastSeen, manual_note: manualNote, activeGamesCount: games.length }, now),
      activity_tracked: Boolean(status?.activity_tracked),
    };
  });
}

// Garbage-collects "currently playing" rows for players whose agent has gone
// silent past the timeout (crashed, PC switched off, network dead). Without
// this, a crashed agent's last known game would linger in live_status_games
// forever — masked in the UI by the "offline" state, but it would silently
// keep inflating that game's playtime (FR-29) since its play_sessions row
// would never get an ended_at. Closes sessions at last_seen (the last
// confirmed real timestamp), not "now", since the game may have stopped
// running well before we noticed.
export function closeStaleSessions(now: number): Set<string> {
  const sweptGroupIds = new Set<string>();
  const legacyStale = db.prepare(`SELECT lsg.player_id, lsg.game_id, lsg.group_id, ls.last_seen FROM live_status_games lsg JOIN live_status ls ON ls.player_id = lsg.player_id WHERE ? - ls.last_seen > ?`).all(now, config.offlineTimeoutMs) as Array<{player_id:string;game_id:string;group_id:string;last_seen:number}>;
  for (const row of legacyStale) {
    db.prepare('DELETE FROM live_status_games WHERE player_id = ? AND game_id = ?').run(row.player_id, row.game_id);
    db.prepare('UPDATE play_sessions SET ended_at = ? WHERE player_id = ? AND game_id = ? AND ended_at IS NULL').run(row.last_seen, row.player_id, row.game_id);
    sweptGroupIds.add(row.group_id ?? DEFAULT_GROUP_ID);
  }
  const stale = db
    .prepare(
      `SELECT lsg.player_id AS player_id, lsg.group_id AS group_id, lsg.event_id AS event_id,
              lsg.game_id AS game_id, ls.last_seen AS last_seen
       FROM tracking_live_games lsg
       JOIN tracking_live_contexts ls ON ls.player_id = lsg.player_id
        AND ls.group_id = lsg.group_id AND ls.event_id IS lsg.event_id
       WHERE ? - ls.last_seen > ?`
    )
    .all(now, config.offlineTimeoutMs) as Array<{ player_id: string; group_id: string; event_id: string | null; game_id: string; last_seen: number }>;

  if (stale.length === 0) return sweptGroupIds;

  const cleanup = db.transaction(() => {
    for (const row of stale) {
      db.prepare('DELETE FROM tracking_live_games WHERE player_id = ? AND group_id = ? AND event_id IS ? AND game_id = ?').run(
        row.player_id,
        row.group_id,
        row.event_id,
        row.game_id
      );
      db.prepare(
        `UPDATE play_sessions SET ended_at = ?
         WHERE player_id = ? AND group_id = ? AND event_id = COALESCE(?, 'outside-events') AND game_id = ? AND ended_at IS NULL`
      ).run(row.last_seen, row.player_id, row.group_id, row.event_id, row.game_id);
      sweptGroupIds.add(row.group_id);
    }
  });
  cleanup();
  return sweptGroupIds;
}

// One sweep pass: closes stale sessions and re-broadcasts the board. Split
// out from startOfflineSweeper so the tick logic itself is unit-testable
// without waiting on a real timer.
export function sweepOnce(now: number = Date.now()): void {
  try {
    const sweptGroupIds = closeStaleSessions(now);
    // Every group that currently carries live rows (or just had stale rows
    // closed) gets its own refreshed board, each under its own group scope.
    // The default group is always included: legacy live_status rows carry no
    // group, and its board is the one every legacy client renders.
    const groupIds = new Set<string>([DEFAULT_GROUP_ID, ...sweptGroupIds]);
    for (const row of db.prepare('SELECT DISTINCT group_id AS id FROM tracking_live_contexts').all() as Array<{ id: string }>) {
      groupIds.add(row.id);
    }
    for (const row of db.prepare('SELECT DISTINCT group_id AS id FROM tracking_live_games').all() as Array<{ id: string }>) {
      groupIds.add(row.id);
    }
    // Manual pauses/notes without an agent create a group-less live_status row
    // and no tracking rows, so the queries above miss them. Fan out to each
    // such player's active groups so a non-default group's Home/Seating board
    // keeps ticking instead of freezing on a stale manual state.
    for (const row of db.prepare('SELECT DISTINCT player_id AS id FROM live_status').all() as Array<{ id: string }>) {
      for (const gid of activePlayerGroupIds(row.id)) groupIds.add(gid);
    }
    for (const groupId of groupIds) {
      broadcast(Events.liveStatusChanged, getLiveBoard(groupId), { groupId });
    }
  } catch (err) {
    // Never let a sweep error take down the timer/process.
    // eslint-disable-next-line no-console
    console.error('Offline sweep failed:', err);
  }
}

// Periodically re-broadcasts the board so clients transition players to
// "offline" even when no new report arrives (e.g. a PC was switched off).
export function startOfflineSweeper(_io: Server): void {
  // Half the timeout is a good cadence: reacts quickly without busy-looping.
  const interval = Math.max(5_000, Math.floor(config.offlineTimeoutMs / 2));
  setInterval(() => sweepOnce(), interval).unref();
}
