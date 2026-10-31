// Read the same event/game-scoped scoring inputs for every points-based view.
import { db } from './db';
import { eventIdSql } from './analyticsEventScope';
import { computeStandings, type MatchForScoring, type TournamentPlacementForScoring } from './leaderboard';
import { computeBracketPlacements, computeRoundRobinStandings } from './tournament';
import { matchResultContainsPlayerIds } from './testDataVisibility';

export function readStandings(
  groupId: string,
  eventIds: string[],
  gameId: string | null = null,
  hiddenPlayerIds: Set<string> = new Set(),
) {
  const eventFilter = eventIdSql('m.event_id', eventIds);
  const gameFilter = gameId ? ' AND m.game_id = ?' : '';
  const rows = db
    .prepare(
      `SELECT m.result, tm.is_draw FROM matches m
     LEFT JOIN tournament_matches tm ON tm.match_id = m.id
     WHERE m.group_id = ? AND ${eventFilter.clause}${gameFilter}`,
    )
    .all(groupId, ...eventFilter.params, ...(gameId ? [gameId] : [])) as Array<{
    result: string;
    is_draw: number | null;
  }>;
  const matches: MatchForScoring[] = rows
    .filter((row) => !matchResultContainsPlayerIds(row.result, hiddenPlayerIds))
    .map((row) => {
      const result = JSON.parse(row.result) as MatchForScoring;
      // Older tournament draws have an explicit flag on their fixture only.
      return { ...result, isDraw: result.isDraw ?? row.is_draw === 1 };
    });

  const tournamentFilter = eventIdSql('event_id', eventIds);
  const tournaments = db
    .prepare(
      `SELECT id, format FROM tournaments WHERE group_id = ? AND ${tournamentFilter.clause}
     AND status = 'completed' AND ended_early = 0${gameId ? ' AND game_id = ?' : ''}`,
    )
    .all(groupId, ...tournamentFilter.params, ...(gameId ? [gameId] : [])) as Array<{ id: string; format: string }>;
  const placements: TournamentPlacementForScoring[] = [];
  for (const tournament of tournaments) {
    const teams = db
      .prepare('SELECT id, player_ids FROM tournament_teams WHERE tournament_id = ?')
      .all(tournament.id) as Array<{ id: string; player_ids: string }>;
    const playerIdsByTeam = new Map(teams.map((team) => [team.id, JSON.parse(team.player_ids) as string[]]));
    if ([...playerIdsByTeam.values()].some((ids) => ids.some((id) => hiddenPlayerIds.has(id)))) continue;
    const fixtures = db
      .prepare(
        'SELECT round, slot, team_a_id, team_b_id, winner_team_id, is_draw, is_bye, is_third_place, stage FROM tournament_matches WHERE tournament_id = ? ORDER BY round, slot',
      )
      .all(tournament.id) as Array<{
      round: number;
      slot: number;
      team_a_id: string | null;
      team_b_id: string | null;
      winner_team_id: string | null;
      is_draw: number;
      is_bye: number;
      is_third_place: number;
      stage: string | null;
    }>;
    let teamPlacements: Array<{ teamId: string; place: number }>;
    if (tournament.format === 'round_robin') {
      const standings = computeRoundRobinStandings(
        teams.map((team) => team.id),
        fixtures
          .filter(
            (fixture) => fixture.team_a_id && fixture.team_b_id && (fixture.winner_team_id !== null || fixture.is_draw),
          )
          .map((fixture) => ({
            teamAId: fixture.team_a_id!,
            teamBId: fixture.team_b_id!,
            winnerTeamId: fixture.winner_team_id,
          })),
      );
      // Equal table points and wins share the same place and bonus.
      let place = 1;
      teamPlacements = standings.map((standing, index) => {
        const previous = standings[index - 1];
        if (previous && (previous.points !== standing.points || previous.wins !== standing.wins)) place = index + 1;
        return { teamId: standing.teamId, place };
      });
    } else {
      teamPlacements = computeBracketPlacements(
        fixtures
          .filter((fixture) => tournament.format === 'single_elimination' || fixture.stage === 'knockout')
          .map((fixture) => ({
            round: fixture.round,
            slot: fixture.slot,
            teamAId: fixture.team_a_id,
            teamBId: fixture.team_b_id,
            winnerTeamId: fixture.winner_team_id,
            isBye: Boolean(fixture.is_bye),
            isThirdPlace: Boolean(fixture.is_third_place),
          })),
      );
    }
    placements.push(
      ...teamPlacements.map((placement) => ({
        playerIds: playerIdsByTeam.get(placement.teamId) ?? [],
        place: placement.place,
      })),
    );
  }
  return computeStandings(matches, placements);
}
