// Aggregated leaderboard (FR-23, FR-24): overall standings, or filtered to one
// game via ?gameId=.

import { Router } from 'express';
import { db } from '../db';
import { computeStandings, type MatchForScoring } from '../leaderboard';
import { eventIdSql, resolveAnalyticsEvents } from '../analyticsEventScope';

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
  const eventFilter = eventIdSql('event_id', scope.eventIds);

  const rows = (
    filterGameId
      ? db.prepare(`SELECT result FROM matches WHERE group_id = ? AND game_id = ? AND ${eventFilter.clause}`).all(
          req.group!.id,
          filterGameId,
          ...eventFilter.params,
        )
      : db.prepare(`SELECT result FROM matches WHERE group_id = ? AND ${eventFilter.clause}`).all(
          req.group!.id,
          ...eventFilter.params,
        )
  ) as Array<{ result: string }>;

  const matches: MatchForScoring[] = rows.map((r) => JSON.parse(r.result));
  const standings = computeStandings(matches);

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
