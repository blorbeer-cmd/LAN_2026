// Shared "who won this tournament" resolution, used by both the export
// snapshot and the hall-of-fame aggregation — kept in one place rather than
// duplicated across those two routers.

import { db } from '../db';
import { computeRoundRobinStandings } from '../tournament';

export interface TournamentChampionSummary {
  name: string;
  format: string;
  gameName: string;
  gameIcon: string;
  championTeamName: string | null;
  championPlayerIds: string[];
}

// All completed tournaments for one event, each resolved down to its
// champion team (bracket: winner of the final round; round-robin: top of
// the final standings).
export function getCompletedTournamentSummaries(eventId: string): TournamentChampionSummary[] {
  const tournamentRows = db
    .prepare("SELECT id, game_id, name, format FROM tournaments WHERE event_id = ? AND status = 'completed'")
    .all(eventId) as Array<{ id: string; game_id: string; name: string; format: string }>;

  return tournamentRows.map((t) => {
    const teamRows = db
      .prepare('SELECT id, name, player_ids FROM tournament_teams WHERE tournament_id = ?')
      .all(t.id) as Array<{ id: string; name: string; player_ids: string }>;
    const teamById = new Map(teamRows.map((tm) => [tm.id, tm]));

    let championTeamId: string | null = null;
    if (t.format === 'single_elimination' || t.format === 'group_knockout') {
      // group_knockout only ever reaches 'completed' once its knockout
      // bracket (not the group stage) has a decided final — same
      // "winner of the highest round" resolution as a plain bracket, just
      // scoped to the knockout-stage rows.
      const rows = db
        .prepare('SELECT round, winner_team_id, stage FROM tournament_matches WHERE tournament_id = ?')
        .all(t.id) as Array<{ round: number; winner_team_id: string | null; stage: string | null }>;
      const bracketRows = t.format === 'group_knockout' ? rows.filter((r) => r.stage === 'knockout') : rows;
      const finalRound = Math.max(...bracketRows.map((r) => r.round));
      championTeamId = bracketRows.find((r) => r.round === finalRound)?.winner_team_id ?? null;
    } else {
      const rows = db
        .prepare('SELECT team_a_id, team_b_id, winner_team_id, is_draw FROM tournament_matches WHERE tournament_id = ?')
        .all(t.id) as Array<{ team_a_id: string; team_b_id: string; winner_team_id: string | null; is_draw: number }>;
      const decided = rows
        .filter((r) => r.winner_team_id !== null || r.is_draw)
        .map((r) => ({ teamAId: r.team_a_id, teamBId: r.team_b_id, winnerTeamId: r.winner_team_id }));
      const standings = computeRoundRobinStandings(teamRows.map((tm) => tm.id), decided);
      championTeamId = standings[0]?.teamId ?? null;
    }

    const championTeam = championTeamId ? teamById.get(championTeamId) : undefined;
    const game = db.prepare('SELECT name, icon FROM games WHERE id = ?').get(t.game_id) as
      | { name: string; icon: string }
      | undefined;

    return {
      name: t.name,
      format: t.format,
      gameName: game?.name ?? 'Unbekannt',
      gameIcon: game?.icon ?? '🎮',
      championTeamName: championTeam?.name ?? null,
      championPlayerIds: championTeam ? (JSON.parse(championTeam.player_ids) as string[]) : [],
    };
  });
}
