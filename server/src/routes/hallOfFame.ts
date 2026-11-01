import { pointsSettings, pointStandings, pointsAreVisible } from '../points';
// Mehrjahres-Hall-of-Fame (FR-36): per-event champions (overall leaderboard
// + tournament winners) across every LAN ever thrown, plus an all-time
// "who's won the most" ranking built from those same per-event results.

import { Router } from 'express';
import { db } from '../db';
import { readStandings } from '../leaderboardData';
import { getCompletedTournamentSummaries } from './tournamentChampion';
import { eventIdSql, resolveAnalyticsEvents } from '../analyticsEventScope';
import {
  includesTestPlayers,
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
    const lanPoints = pointsSettings(e.id)?.configured_at != null;
    const standings = lanPoints ? (pointsAreVisible(e.id) ? pointStandings(e.id) : []) : readStandings(req.group!.id, [e.id], null, hiddenPlayerIds);
    const firstRankByPoints = new Map<number, number>();
    const overallStandings = standings.map((standing, index) => {
      if (!firstRankByPoints.has(standing.points)) firstRankByPoints.set(standing.points, index + 1);
      return {
        ...playerSummary(playerById, standing.playerId),
        points: standing.points,
        wins: standing.wins,
        matchesPlayed: standing.matchesPlayed,
        rank: lanPoints ? firstRankByPoints.get(standing.points)! : index + 1,
      };
    });
    const top = standings[0];
    // LAN points share first place solely by points, including zero/negative
    // final balances. Legacy match scoring still needs an actual scored win.
    const overallChampions =
      top && (lanPoints || top.points > 0)
        ? overallStandings
            .filter((standing) => standing.rank === 1)
            .map((standing) => ({
              ...playerSummary(playerById, standing.playerId),
              points: standing.points,
            }))
        : [];
    // Retain the singular field for consumers of uniquely decided events.
    const overallChampion = overallChampions.length === 1 ? overallChampions[0] : null;
    for (const champion of overallChampions) {
      overallWinCounts.set(champion.playerId, (overallWinCounts.get(champion.playerId) ?? 0) + 1);
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
      scoringModel: lanPoints ? 'lan_points' : 'match_results',
      overallChampion,
      overallChampions,
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
