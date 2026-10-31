// Aggregated leaderboard (FR-23, FR-24): overall standings, or filtered to one
// game via ?gameId=.

import { Router } from 'express';
import { db } from '../db';
import { readStandings } from '../leaderboardData';
import { resolveAnalyticsEvents } from '../analyticsEventScope';
import {
  includesTestPlayers,
  testPlayerIds,
} from '../testDataVisibility';

export const leaderboardRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  color: string;
}

leaderboardRouter.get('/', (req, res) => {
  const { gameId, eventId } = req.query;
  const filterGameId = typeof gameId === 'string' ? gameId : null;
  const scope = resolveAnalyticsEvents(req, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const hiddenPlayerIds = includesTestPlayers(req) ? new Set<string>() : testPlayerIds();
  const standings = readStandings(req.group!.id, scope.eventIds, filterGameId, hiddenPlayerIds);

  const playerIds = standings.map((s) => s.playerId);
  let players: PlayerRow[] = [];
  if (playerIds.length > 0) {
    const placeholders = playerIds.map(() => '?').join(',');
    players = db
      .prepare(`SELECT id, name, color FROM players WHERE deactivated_at IS NULL AND id IN (${placeholders})`)
      .all(...playerIds) as PlayerRow[];
  }
  const playerById = new Map(players.map((p) => [p.id, p]));

  const enriched = standings.filter((s) => playerById.has(s.playerId)).map((s) => ({
    ...s,
    name: playerById.get(s.playerId)?.name ?? 'Unbekannt',
    color: playerById.get(s.playerId)?.color ?? '#999999',
  }));

  res.json({ gameId: filterGameId, eventIds: scope.eventIds, standings: enriched });
});
