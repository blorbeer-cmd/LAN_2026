// Mehrjahres-Hall-of-Fame (FR-36): per-event champions (overall leaderboard
// + tournament winners) across every LAN ever thrown, plus an all-time
// "who's won the most" ranking built from those same per-event results.

import { Router } from 'express';
import { db } from '../db';
import { computeStandings, type MatchForScoring } from '../leaderboard';
import { getCompletedTournamentSummaries } from './tournamentChampion';
import { eventIdSql, resolveAnalyticsEvents } from '../analyticsEventScope';
import {
  includesTestPlayers,
  matchResultContainsPlayerIds,
  testPlayerIds,
} from '../testDataVisibility';

export const hallOfFameRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

function playerSummary(playerById: Map<string, PlayerRow>, playerId: string) {
  const p = playerById.get(playerId);
  return {
    playerId,
    name: p?.name ?? 'Unbekannt',
    color: p?.color ?? '#999999',
    avatar: p?.avatar ?? null,
  };
}

hallOfFameRouter.get('/', (req, res) => {
  const scope = resolveAnalyticsEvents(req, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const filter = eventIdSql('id', scope.eventIds);
  const events = db
    .prepare(
      `SELECT id, name, starts_at, ends_at
       FROM events
       WHERE group_id = ? AND ${filter.clause}
       ORDER BY starts_at DESC`,
    )
    .all(req.group!.id, ...filter.params) as Array<{
    id: string;
    name: string;
    starts_at: number;
    ends_at: number | null;
  }>;
  const includeTestData = includesTestPlayers(req);
  const players = db
    .prepare('SELECT id, name, color, avatar FROM players WHERE deactivated_at IS NULL AND (? = 1 OR is_test = 0)')
    .all(includeTestData ? 1 : 0) as PlayerRow[];
  const playerById = new Map(players.map((p) => [p.id, p]));
  const hiddenPlayerIds = includeTestData ? new Set<string>() : testPlayerIds();

  const overallWinCounts = new Map<string, number>();
  const tournamentWinCounts = new Map<string, number>();

  const eventSummaries = events.map((e) => {
    const matchRows = db.prepare('SELECT result FROM matches WHERE event_id = ? AND group_id = ?').all(e.id, req.group!.id) as Array<{
      result: string;
    }>;
    const matches: MatchForScoring[] = matchRows
      .filter((row) => !matchResultContainsPlayerIds(row.result, hiddenPlayerIds))
      .map((r) => JSON.parse(r.result));
    const standings = computeStandings(matches);
    const overallStandings = standings.map((standing) => ({
      ...playerSummary(playerById, standing.playerId),
      points: standing.points,
      wins: standing.wins,
      matchesPlayed: standing.matchesPlayed,
    }));
    const top = standings[0];
    // Only crown a champion if someone actually scored — an event with no
    // recorded matches has no "Gesamtsieger" to speak of.
    const overallChampion = top && top.points > 0 ? { ...playerSummary(playerById, top.playerId), points: top.points } : null;
    if (overallChampion) {
      overallWinCounts.set(overallChampion.playerId, (overallWinCounts.get(overallChampion.playerId) ?? 0) + 1);
    }

    const tournamentChampions = getCompletedTournamentSummaries(e.id, req.group!.id)
      .filter((t) => !t.championPlayerIds.some((playerId) => hiddenPlayerIds.has(playerId)))
      .map((t) => {
        for (const playerId of t.championPlayerIds) {
          tournamentWinCounts.set(playerId, (tournamentWinCounts.get(playerId) ?? 0) + 1);
        }
        return {
          name: t.name,
          format: t.format,
          gameName: t.gameName,
          gameIcon: t.gameIcon,
          championTeamName: t.championTeamName,
          championPlayers: t.championPlayerIds.map((id) => playerById.get(id)?.name ?? 'Unbekannt'),
        };
      });

    return {
      eventId: e.id,
      eventName: e.name,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      overallChampion,
      overallStandings,
      tournamentChampions,
    };
  });

  const toRanked = (counts: Map<string, number>) =>
    [...counts.entries()]
      .map(([playerId, count]) => ({ ...playerSummary(playerById, playerId), count }))
      .sort((a, b) => b.count - a.count);

  res.json({
    eventIds: scope.eventIds,
    events: eventSummaries,
    allTime: {
      mostOverallWins: toRanked(overallWinCounts),
      mostTournamentWins: toRanked(tournamentWinCounts),
    },
  });
});
