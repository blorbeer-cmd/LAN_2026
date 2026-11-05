import { db } from './db';
import { computeMatchPlacements, type MatchForScoring } from './leaderboard';
import { matchResultContainsPlayerIds } from './testDataVisibility';
import { pointsAreVisible } from './points';

interface FeedPlayer {
  name: string;
  points?: number;
}
export interface FeedResult {
  id: string;
  gameName: string;
  activityAt: number;
  revision: number;
  corrected: boolean;
  draw: boolean;
  teams: Array<{ name: string | null; place: number; winner: boolean; players: FeedPlayer[] }>;
}

// This projection is strictly read-only: a kiosk request never mints points
// or initializes accounts. The source handlers and startup backfill journal them.
export function readResultsFeed(groupId: string, eventId: string, hiddenPlayers: Set<string> = new Set()) {
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId))
      return { showPoints: false, items: [] as FeedResult[] };
    const showPoints = pointsAreVisible(eventId);
    const names = new Map(
      (
        db
          .prepare(
            `SELECT p.id, p.name FROM players p WHERE EXISTS
      (SELECT 1 FROM group_memberships gm WHERE gm.player_id = p.id AND gm.group_id = ?)`,
          )
          .all(groupId) as Array<{ id: string; name: string }>
      ).map((p) => [p.id, p.name]),
    );
    const journal = db
      .prepare(
        `SELECT s.source_key, s.player_id, SUM(j.amount) AS points,
      MAX(j.revision) AS revision, MAX(CASE WHEN j.revision > 1 THEN j.created_at ELSE 0 END) AS corrected_at
      FROM points_sources s JOIN points_journal j ON j.source_id = s.id
      JOIN events e ON e.id = s.event_id
      WHERE s.event_id = ? AND e.group_id = ? AND s.account = 'playing'
      GROUP BY s.source_key, s.player_id`,
      )
      .all(eventId, groupId) as Array<{
      source_key: string;
      player_id: string;
      points: number;
      revision: number;
      corrected_at: number;
    }>;
    const byMatch = new Map<string, typeof journal>();
    for (const row of journal) {
      if (!row.source_key.startsWith('match:')) continue;
      const id = row.source_key.slice('match:'.length);
      byMatch.set(id, [...(byMatch.get(id) ?? []), row]);
    }
    const rows = db
      .prepare(
        `SELECT m.id, m.result, m.played_at, m.recorded_at, m.updated_at, m.result_revision,
      COALESCE(g.name, 'Unbekanntes Spiel') AS game_name, MAX(tm.is_draw) AS fixture_draw,
      MAX(ta.name) AS team_a_name, MAX(tb.name) AS team_b_name
      FROM matches m LEFT JOIN games g ON g.id = m.game_id AND g.group_id = m.group_id
      LEFT JOIN tournament_matches tm ON tm.match_id = m.id
      LEFT JOIN tournaments t ON t.id = tm.tournament_id AND t.group_id = m.group_id AND t.event_id = m.event_id
      LEFT JOIN tournament_teams ta ON ta.id = tm.team_a_id AND ta.tournament_id = t.id
      LEFT JOIN tournament_teams tb ON tb.id = tm.team_b_id AND tb.tournament_id = t.id
      WHERE m.group_id = ? AND m.event_id = ? GROUP BY m.id`,
      )
      .all(groupId, eventId) as Array<{
      id: string;
      result: string;
      played_at: number;
      recorded_at: number;
      updated_at: number;
      result_revision: number;
      game_name: string;
      fixture_draw: number | null;
      team_a_name: string | null;
      team_b_name: string | null;
    }>;
    const items: FeedResult[] = [];
    for (const row of rows) {
      if (matchResultContainsPlayerIds(row.result, hiddenPlayers)) continue;
      let match: MatchForScoring;
      try {
        match = JSON.parse(row.result) as MatchForScoring;
      } catch {
        continue;
      }
      if (!Array.isArray(match?.teams) || !match.teams.every((team) => Array.isArray(team?.playerIds))) continue;
      match.isDraw = match.isDraw ?? row.fixture_draw === 1;
      const placements = computeMatchPlacements(match);
      if (!placements) continue;
      const entries = byMatch.get(row.id) ?? [];
      const credited = new Map(entries.map((entry) => [entry.player_id, entry.points]));
      const corrected = row.result_revision > 1 || entries.some((entry) => entry.revision > 1);
      const activityAt = Math.max(
        row.updated_at || row.recorded_at || row.played_at,
        ...entries.map((entry) => entry.corrected_at),
      );
      items.push({
        id: row.id,
        gameName: row.game_name,
        activityAt,
        revision: row.result_revision,
        corrected,
        draw: match.isDraw === true,
        teams: match.teams
          .map((team, index) => ({
            name: match.teams.length === 2 ? (index === 0 ? row.team_a_name : row.team_b_name) : null,
            place: placements[index].place,
            winner: placements[index].points === 4,
            players: team.playerIds.map((id) => ({
              name: names.get(id) ?? 'Gelöschtes Konto',
              ...(showPoints ? { points: credited.get(id) ?? 0 } : {}),
            })),
          }))
          .sort((a, b) => a.place - b.place),
      });
    }
    items.sort((a, b) => b.activityAt - a.activityAt || a.id.localeCompare(b.id));
    return { showPoints, items: items.slice(0, 10) };
  })();
}
