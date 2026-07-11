// Wires Arcade matches into the same "who's playing"/playtime machinery the
// agent uses for regular PC games (FR-29): live_status_games (Home's
// Live-Status board) and play_sessions (server/src/routes/stats.ts). Arcade
// is socket-driven, not agent-polled, so it also has to keep live_status.
// last_seen fresh itself for as long as a match runs — see
// startArcadeHeartbeat, which re-touches it periodically instead of relying
// on an agent report that will never come.

import { nanoid } from 'nanoid';
import { db, ARCADE_GAME_DEFS } from '../db';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';
import { getTrackingEventId } from '../events';

export type ArcadeGameKey = (typeof ARCADE_GAME_DEFS)[number]['key'];

const ARCADE_GAME_KEYS = ARCADE_GAME_DEFS.map((g) => g.key);

// games.id per arcade_key, looked up lazily once the seed in db.ts has run
// and cached for the process lifetime (these rows are never edited/deleted,
// see routes/games.ts).
let idCache: Map<string, string> | null = null;

function arcadeGameId(key: ArcadeGameKey): string | null {
  if (!idCache) {
    idCache = new Map();
    const rows = db.prepare('SELECT id, arcade_key FROM games WHERE arcade_key IS NOT NULL').all() as Array<{
      id: string;
      arcade_key: string;
    }>;
    for (const row of rows) idCache.set(row.arcade_key, row.id);
  }
  return idCache.get(key) ?? null;
}

// Marks the given real players (bots already filtered out by the caller) as
// currently playing an arcade match.
export function startArcadeSession(playerIds: string[], key: ArcadeGameKey): void {
  const gameId = arcadeGameId(key);
  if (!gameId || playerIds.length === 0) return;
  const now = Date.now();
  const eventId = getTrackingEventId();

  const touchStatus = db.prepare(
    `INSERT INTO live_status (player_id, last_seen, manual_note, activity_tracked) VALUES (?, ?, NULL, 0)
     ON CONFLICT(player_id) DO UPDATE SET last_seen = excluded.last_seen`
  );
  const alreadyPlaying = db.prepare('SELECT 1 FROM live_status_games WHERE player_id = ? AND game_id = ?');
  const insertGame = db.prepare(
    'INSERT OR IGNORE INTO live_status_games (player_id, game_id, since, is_foreground) VALUES (?, ?, ?, 1)'
  );
  const insertSession = db.prepare(
    'INSERT INTO play_sessions (id, player_id, game_id, event_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL)'
  );

  const run = db.transaction(() => {
    for (const playerId of playerIds) {
      touchStatus.run(playerId, now);
      const already = alreadyPlaying.get(playerId, gameId);
      insertGame.run(playerId, gameId, now);
      if (!already) insertSession.run(nanoid(), playerId, gameId, eventId, now);
    }
  });
  run();
  broadcast(Events.liveStatusChanged, getLiveBoard());
}

// Ends the arcade session for the given real players — called on every match
// end path (completed, aborted, opponent left), mirroring how agent.ts closes
// a play_sessions row the moment a game is no longer detected as running.
export function endArcadeSession(playerIds: string[], key: ArcadeGameKey): void {
  const gameId = arcadeGameId(key);
  if (!gameId || playerIds.length === 0) return;
  const now = Date.now();

  const closeGame = db.prepare('DELETE FROM live_status_games WHERE player_id = ? AND game_id = ?');
  const closeSession = db.prepare(
    `UPDATE play_sessions SET ended_at = ? WHERE player_id = ? AND game_id = ? AND ended_at IS NULL`
  );
  const run = db.transaction(() => {
    for (const playerId of playerIds) {
      closeGame.run(playerId, gameId);
      closeSession.run(now, playerId, gameId);
    }
  });
  run();
  broadcast(Events.liveStatusChanged, getLiveBoard());
}

// Every player currently in an open arcade session, across all games.
function activeArcadePlayerIds(): string[] {
  const ids = ARCADE_GAME_KEYS.map((key) => arcadeGameId(key as ArcadeGameKey)).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT DISTINCT player_id FROM live_status_games WHERE game_id IN (${placeholders})`)
    .all(...ids) as Array<{ player_id: string }>;
  return rows.map((r) => r.player_id);
}

// Keeps live_status.last_seen fresh for anyone mid-arcade-match, so a match
// that runs longer than config.offlineTimeoutMs doesn't get swept "offline"
// by liveStatus.ts's sweeper for lack of an agent report that will never
// come (arcade is played from the browser, no polling agent involved).
export function startArcadeHeartbeat(): void {
  setInterval(() => {
    const ids = activeArcadePlayerIds();
    if (ids.length === 0) return;
    const now = Date.now();
    const touch = db.prepare('UPDATE live_status SET last_seen = ? WHERE player_id = ?');
    const run = db.transaction(() => {
      for (const id of ids) touch.run(now, id);
    });
    run();
    broadcast(Events.liveStatusChanged, getLiveBoard());
  }, 20_000).unref();
}
