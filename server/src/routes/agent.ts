// Agent-facing endpoint: each player's agent periodically reports the process
// names it currently sees running. The server does the process-name -> game
// matching (FR-10), so the mapping can be edited centrally without touching
// any agent. Authenticated by the player's own API key (NFR-15), NOT the
// shared UI access token — the agent only ever knows its server URL + key.
//
// A single PC can have several games running at once (e.g. a launcher plus
// the actual game, or two games side by side), so a report can match several
// games; the server syncs the player's active-games set to match exactly what
// was just reported.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';

export const agentRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
}

// POST /api/agent/report
// Headers: x-api-key: <player's api key>
// Body: { processNames: string[] }  // every process the agent currently sees
agentRouter.post('/report', (req, res) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    return res.status(401).json({ error: 'API-Key fehlt (Header x-api-key).' });
  }

  const player = db.prepare('SELECT id, name FROM players WHERE api_key = ?').get(apiKey) as
    | PlayerRow
    | undefined;
  if (!player) {
    return res.status(401).json({ error: 'Ungültiger API-Key.' });
  }

  const { processNames } = req.body ?? {};
  if (!Array.isArray(processNames) || !processNames.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'processNames muss ein String-Array sein.' });
  }

  const normalized = [...new Set(processNames.map((p) => p.trim().toLowerCase()).filter(Boolean))];

  // A report can match several distinct games at once (e.g. cs2.exe AND
  // rocketleague.exe both running).
  let matchedGameIds: string[] = [];
  if (normalized.length > 0) {
    const placeholders = normalized.map(() => '?').join(',');
    const matches = db
      .prepare(`SELECT DISTINCT game_id FROM game_process_names WHERE process_name IN (${placeholders})`)
      .all(...normalized) as Array<{ game_id: string }>;
    matchedGameIds = matches.map((m) => m.game_id);
  }

  const now = Date.now();

  const sync = db.transaction(() => {
    db.prepare(
      `INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, NULL)
       ON CONFLICT(player_id) DO UPDATE SET last_seen = excluded.last_seen`
    ).run(player.id, now);

    const existing = db
      .prepare('SELECT game_id FROM live_status_games WHERE player_id = ?')
      .all(player.id) as Array<{ game_id: string }>;
    const existingIds = new Set(existing.map((e) => e.game_id));
    const matchedIds = new Set(matchedGameIds);

    // Games no longer detected: remove, and close their open play_sessions
    // row (FR-29) so total playtime stops accumulating for it.
    for (const gameId of existingIds) {
      if (!matchedIds.has(gameId)) {
        db.prepare('DELETE FROM live_status_games WHERE player_id = ? AND game_id = ?').run(
          player.id,
          gameId
        );
        db.prepare(
          `UPDATE play_sessions SET ended_at = ?
           WHERE player_id = ? AND game_id = ? AND ended_at IS NULL`
        ).run(now, player.id, gameId);
      }
    }
    // Newly detected games: add with since=now, and open a play_sessions row.
    // Games still running keep their original "since" untouched (no-op).
    for (const gameId of matchedIds) {
      if (!existingIds.has(gameId)) {
        db.prepare(
          'INSERT INTO live_status_games (player_id, game_id, since) VALUES (?, ?, ?)'
        ).run(player.id, gameId, now);
        db.prepare(
          'INSERT INTO play_sessions (id, player_id, game_id, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)'
        ).run(nanoid(), player.id, gameId, now);
      }
    }
  });
  sync();

  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json({ ok: true, playerId: player.id, gameIds: matchedGameIds });
});
