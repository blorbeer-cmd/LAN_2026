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
import { currentArcadeDataScope } from './arcadeData';
import type { ArcadeDataScope } from './arcadeData';

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
export function startArcadeSession(playerIds: string[], key: ArcadeGameKey, immutableScope?: ArcadeDataScope): void {
  const gameId = arcadeGameId(key);
  if (!gameId || playerIds.length === 0) return;
  const scope = immutableScope ?? currentArcadeDataScope(playerIds);
  if (!scope?.eventId) return;
  const now = Date.now();
  const eventId = scope.eventId;
  // The Arcade titles themselves are shared system fixtures (games.group_id
  // NULL, see db.ts), but a live session still belongs to whichever group its
  // players are actually in. The immutable event scope is resolved before a
  // session is opened, just like the active workspace in agent.ts.
  const groupId = scope.groupId;

  const touchStatus = db.prepare(
    `INSERT INTO tracking_live_contexts
       (player_id, group_id, event_id, last_seen, manual_note, activity_tracked)
     VALUES (?, ?, ?, ?, NULL, 0)
     ON CONFLICT(player_id, group_id, event_id) DO UPDATE SET last_seen = excluded.last_seen`,
  );
  const alreadyPlaying = db.prepare(
    'SELECT 1 FROM tracking_live_games WHERE player_id = ? AND game_id = ? AND group_id = ? AND event_id = ?',
  );
  const insertGame = db.prepare(
    `INSERT OR IGNORE INTO tracking_live_games
       (player_id, game_id, group_id, event_id, since, is_foreground)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const insertSession = db.prepare(
    'INSERT INTO play_sessions (id, player_id, game_id, group_id, event_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
  );

  const run = db.transaction(() => {
    for (const playerId of playerIds) {
      touchStatus.run(playerId, groupId, eventId, now);
      const already = alreadyPlaying.get(playerId, gameId, groupId, eventId);
      insertGame.run(playerId, gameId, groupId, eventId, now);
      if (!already) insertSession.run(nanoid(), playerId, gameId, groupId, eventId, now);
    }
  });
  run();
  broadcast(Events.liveStatusChanged, getLiveBoard(groupId, eventId), { groupId, eventId });
}

// Ends the arcade session for the given real players — called on every match
// end path (completed, aborted, opponent left), mirroring how agent.ts closes
// a play_sessions row the moment a game is no longer detected as running.
export function endArcadeSession(playerIds: string[], key: ArcadeGameKey, immutableScope?: ArcadeDataScope): void {
  const gameId = arcadeGameId(key);
  if (!gameId || playerIds.length === 0) return;
  const scope = immutableScope ?? currentArcadeDataScope(playerIds);
  if (!scope?.eventId) return;
  const now = Date.now();

  const closeGame = db.prepare(
    'DELETE FROM tracking_live_games WHERE player_id = ? AND game_id = ? AND group_id = ? AND event_id = ?',
  );
  const closeSession = db.prepare(
    `UPDATE play_sessions SET ended_at = ?
     WHERE player_id = ? AND game_id = ? AND group_id = ? AND event_id = ? AND ended_at IS NULL`,
  );
  const run = db.transaction(() => {
    for (const playerId of playerIds) {
      closeGame.run(playerId, gameId, scope.groupId, scope.eventId);
      closeSession.run(now, playerId, gameId, scope.groupId, scope.eventId);
    }
  });
  run();
  broadcast(Events.liveStatusChanged, getLiveBoard(scope.groupId, scope.eventId), {
    groupId: scope.groupId,
    eventId: scope.eventId,
  });
}

// Arcade matches only exist in this server process. After a restart there
// cannot be a matching live game anymore, but the persisted tracking rows
// from an interrupted match would otherwise be picked up by the heartbeat
// below and kept "playing" forever. Close only built-in Arcade sessions;
// agent-reported PC games and the surrounding presence context stay intact.
export function recoverInterruptedArcadeSessions(): void {
  const selectOpenSessions = db.prepare(
    `SELECT ps.id, ps.started_at AS startedAt, tlc.last_seen AS lastSeen
     FROM play_sessions ps
     JOIN games g ON g.id = ps.game_id
     LEFT JOIN tracking_live_contexts tlc
       ON tlc.player_id = ps.player_id
      AND tlc.group_id = ps.group_id
      AND tlc.event_id IS ps.event_id
     WHERE ps.ended_at IS NULL AND g.arcade_key IS NOT NULL`,
  );

  const closeSession = db.prepare('UPDATE play_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL');
  const recover = db.transaction(() => {
    const openSessions = selectOpenSessions.all() as Array<{ id: string; startedAt: number; lastSeen: number | null }>;
    for (const session of openSessions) {
      closeSession.run(Math.max(session.startedAt, session.lastSeen ?? session.startedAt), session.id);
    }
    db.prepare(
      `DELETE FROM tracking_live_games
       WHERE game_id IN (SELECT id FROM games WHERE arcade_key IS NOT NULL)`,
    ).run();
  });
  recover();
}

// Every player currently in an open arcade session, across all games.
function activeArcadePlayerIds(): string[] {
  const ids = ARCADE_GAME_KEYS.map((key) => arcadeGameId(key as ArcadeGameKey)).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT DISTINCT player_id FROM tracking_live_games WHERE game_id IN (${placeholders})`)
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
    const touch = db.prepare('UPDATE tracking_live_contexts SET last_seen = ? WHERE player_id = ?');
    const run = db.transaction(() => {
      for (const id of ids) touch.run(now, id);
    });
    run();
    const scopes = db.prepare(
      `SELECT DISTINCT tlg.group_id AS groupId, tlg.event_id AS eventId
       FROM tracking_live_games tlg
       JOIN games g ON g.id = tlg.game_id
       WHERE g.arcade_key IS NOT NULL`,
    ).all() as Array<{ groupId: string; eventId: string }>;
    for (const { groupId, eventId } of scopes) {
      broadcast(Events.liveStatusChanged, getLiveBoard(groupId, eventId), { groupId, eventId });
    }
  }, 20_000).unref();
}
