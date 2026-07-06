// Agent-facing endpoint: each player's agent periodically reports the process
// names it currently sees running. The server does the process-name -> game
// matching (FR-10), so the mapping can be edited centrally without touching
// any agent. Authenticated by the player's own API key (NFR-15), NOT the
// shared UI access token — the agent only ever knows its server URL + key.

import { Router } from 'express';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';

export const agentRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
}

interface LiveStatusExisting {
  game_id: string | null;
  since: number | null;
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

  let matchedGameId: string | null = null;
  if (normalized.length > 0) {
    const placeholders = normalized.map(() => '?').join(',');
    const match = db
      .prepare(`SELECT game_id FROM game_process_names WHERE process_name IN (${placeholders}) LIMIT 1`)
      .get(...normalized) as { game_id: string } | undefined;
    matchedGameId = match?.game_id ?? null;
  }

  const existing = db
    .prepare('SELECT game_id, since FROM live_status WHERE player_id = ?')
    .get(player.id) as LiveStatusExisting | undefined;

  const now = Date.now();
  // Keep the original start time if the reported game hasn't changed, so
  // "seit wann" reflects when this session of the game actually began.
  const since =
    matchedGameId && matchedGameId === existing?.game_id ? existing!.since : matchedGameId ? now : null;

  db.prepare(
    `INSERT INTO live_status (player_id, game_id, since, last_seen, manual_note)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(player_id) DO UPDATE SET
       game_id = excluded.game_id,
       since = excluded.since,
       last_seen = excluded.last_seen`
  ).run(player.id, matchedGameId, since, now);

  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.json({ ok: true, playerId: player.id, gameId: matchedGameId });
});
