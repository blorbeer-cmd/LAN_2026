import { withBettingAccounting, assertMatchEditable, correctableDrawRounds, validateBettingCorrection, rebookCorrectedRounds } from '../betting';
// Recorded match results (FR-22, FR-25). Result details (teams + winner) are
// stored as JSON with an explicit draw flag so missing results stay unscored.
// Each match is
// tagged with the event that was active when it was recorded, so results can
// be viewed per LAN afterwards; editing a match never moves it to a
// different event.

import { Router } from 'express';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { isSuggestionGame, SUGGESTION_GAME_ERROR } from './gameSelection';
import { broadcast, Events } from '../realtime';
import { applySeatConflicts, buildTeamsSnapshot } from './matchmaking';
import { lineupKey } from '../matchmaking';
import { requireGroupRole, resolveGroupResource } from '../groupAuthorization';
import { competitionPlayersBelongToGroup } from '../competitionScope';
import { requireGroupEventAccess, resolveRequestGroupEventScope } from '../groupEventScope';
import { syncCompetitionPoints } from '../orgaPoints';

export const matchesRouter = Router();

interface DrawLinkRow {
  id: string;
  created_by: string | null;
  match_id: string | null;
  tournament_id: string | null;
  event_id: string;
  seat_pairs_considered: number;
  game_id: string;
  source: string;
  teams: string;
}

class DrawAlreadyClaimedError extends Error {}
class DrawLineupChangedError extends Error {}

const DRAW_LINEUP_CHANGED = 'Die Teams dieser Auslosung wurden inzwischen geändert. Bitte die Auslosung neu öffnen.';

// The lineup a result dialog was opened with: player ids per team. Bounded
// like the teams themselves so a malformed body cannot blow up the check.
function isDrawLineup(value: unknown): value is string[][] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 64 && value.every((team) =>
    Array.isArray(team) && team.length <= 64 && team.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 64));
}

interface TeamInput {
  playerIds: string[];
  // Both optional and independent of winnerTeamIndex/each other: a game with
  // a real score (Punktestand) can carry `score`, a placement-only game
  // (Mario Kart, ein Rennen) can carry `rank` instead, some games want both.
  // Complete ranks feed placement scoring (see leaderboard.ts). Scores are
  // display values; different games need not share the same score direction.
  score?: number | null;
  rank?: number | null; // 1 = first place; ties allowed (same rank twice)
}

interface MatchResult {
  teams: TeamInput[];
  winnerTeamIndex: number | null;
  isDraw: boolean;
}

interface MatchRow {
  id: string;
  created_by: string | null;
  game_id: string;
  event_id: string;
  played_at: number;
  result: string;
  group_id: string | null;
}

function parseMatch(row: MatchRow) {
  return {
    id: row.id,
    gameId: row.game_id,
    eventId: row.event_id,
    playedAt: row.played_at,
    ...(JSON.parse(row.result) as MatchResult),
  };
}

function validateTeams(
  teams: unknown,
  winnerTeamIndex: unknown,
  isDraw: unknown = false,
): MatchResult | { error: string } {
  if (!Array.isArray(teams) || teams.length < 2) {
    return { error: 'teams muss ein Array mit mindestens 2 Teams sein.' };
  }
  const allIds: string[] = [];
  const normalizedTeams: TeamInput[] = [];
  for (const t of teams as unknown[]) {
    const team = t as { playerIds?: unknown; score?: unknown; rank?: unknown };
    if (
      !team ||
      !Array.isArray(team.playerIds) ||
      team.playerIds.length === 0 ||
      !team.playerIds.every((p) => typeof p === 'string')
    ) {
      return { error: 'Jedes Team braucht mindestens einen Spieler (playerIds).' };
    }
    allIds.push(...(team.playerIds as string[]));

    let score: number | null = null;
    if (team.score !== undefined && team.score !== null) {
      if (typeof team.score !== 'number' || !Number.isFinite(team.score)) {
        return { error: 'score muss eine Zahl sein.' };
      }
      score = team.score;
    }
    let rank: number | null = null;
    if (team.rank !== undefined && team.rank !== null) {
      if (typeof team.rank !== 'number' || !Number.isInteger(team.rank) || team.rank < 1) {
        return { error: 'rank muss eine positive ganze Zahl sein (1 = erster Platz).' };
      }
      rank = team.rank;
    }
    normalizedTeams.push({ playerIds: team.playerIds as string[], score, rank });
  }
  if (new Set(allIds).size !== allIds.length) {
    return { error: 'Ein Spieler kann nicht gleichzeitig in mehreren Teams stehen.' };
  }

  let winner: number | null = null;
  if (winnerTeamIndex !== undefined && winnerTeamIndex !== null) {
    if (
      typeof winnerTeamIndex !== 'number' ||
      !Number.isInteger(winnerTeamIndex) ||
      winnerTeamIndex < 0 ||
      winnerTeamIndex >= teams.length
    ) {
      return { error: 'winnerTeamIndex ist ungültig.' };
    }
    winner = winnerTeamIndex;
  }

  if (typeof isDraw !== 'boolean' || (isDraw && winner !== null)) {
    return { error: 'isDraw muss ein Boolean sein und darf nicht zusammen mit einem Sieger gesetzt werden.' };
  }
  return { teams: normalizedTeams, winnerTeamIndex: winner, isDraw };
}

// GET /api/matches - list, newest first, optionally filtered by ?gameId=
// and/or ?eventId=. Always scoped to the request's retained group_id, so an
// event whose stored group_id does not match simply returns no matches.
// Each entry names where it came from — the linked Match draw (`drawId`) or
// the status of its tournament (`tournamentStatus`) — so a client can tell a
// result Match's Historie lists from a round of a still-running tournament.
matchesRouter.get('/', (req, res) => {
  const { gameId, eventId } = req.query;
  const scope = resolveRequestGroupEventScope(req, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const clauses: string[] = ['m.group_id = ?', 'm.event_id = ?'];
  const params: string[] = [req.group!.id, scope.eventId!];
  if (typeof gameId === 'string') {
    clauses.push('m.game_id = ?');
    params.push(gameId);
  }
  const rows = db.prepare(`SELECT m.*,
      (SELECT md.id FROM matchmaking_draws md WHERE md.match_id = m.id LIMIT 1) AS draw_id,
      (SELECT t.status FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id
        WHERE tm.match_id = m.id LIMIT 1) AS tournament_status
    FROM matches m WHERE ${clauses.join(' AND ')} ORDER BY m.played_at DESC`)
    .all(...params) as Array<MatchRow & { draw_id: string | null; tournament_status: string | null }>;
  res.json(rows.map((row) => ({ ...parseMatch(row), drawId: row.draw_id, tournamentStatus: row.tournament_status })));
});

// POST /api/matches - record a new result.
// Body: { gameId, teams: [{ playerIds }], winnerTeamIndex?, playedAt?, drawId?, drawLineup? }
// drawId links back to the matchmaking_draws row this result came from (a
// "Teams auslosen" / draft lineup), moving it from Team-Historie to
// Ergebnis-Historie — optional since results can also be entered ad-hoc.
// drawLineup is the draw's lineup (player ids per team) the result dialog was
// opened with. Checked in the claiming transaction, it stops a stale dialog
// from overwriting a lineup that was reshuffled, extended or edited since
// (409 with code draw_lineup_changed).
matchesRouter.post('/', (req, res) => {
  const { gameId, teams, winnerTeamIndex, isDraw, playedAt, drawId, drawLineup } = req.body ?? {};

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  const game = db.prepare('SELECT id, status FROM games WHERE id = ? AND group_id = ?').get(gameId, req.group!.id) as
    | { id: string; status: string }
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (isSuggestionGame(game)) {
    // A suggestion can't be picked ad-hoc, but a draw created while the game
    // was still in the catalog has to stay completable: recording what was
    // actually played is history, not scheduling. The draw itself is fully
    // validated further below (existence, group, already-recorded); this only
    // asks whether the result belongs to one for this very game.
    const drawForGame =
      typeof drawId === 'string' && drawId
        ? db
            .prepare('SELECT id FROM matchmaking_draws WHERE id = ? AND group_id = ? AND game_id = ?')
            .get(drawId, req.group!.id, gameId)
        : undefined;
    if (!drawForGame) return res.status(400).json({ error: SUGGESTION_GAME_ERROR });
  }

  const validated = validateTeams(teams, winnerTeamIndex, isDraw);
  if ('error' in validated) return res.status(400).json({ error: validated.error });

  const scope = resolveRequestGroupEventScope(req, undefined);
  if (!scope.ok || !scope.eventId) return res.status(409).json({ error: 'Kein aktives Event verfügbar.' });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const eventId = scope.eventId;
  const allIds = validated.teams.flatMap((t) => t.playerIds);
  if (!competitionPlayersBelongToGroup(req.group!.id, eventId, allIds)) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }
  if (playedAt !== undefined && (typeof playedAt !== 'number' || !Number.isFinite(playedAt))) {
    return res.status(400).json({ error: 'playedAt muss ein Zeitstempel (ms) sein.' });
  }
  if (drawId !== undefined && (typeof drawId !== 'string' || !drawId)) {
    return res.status(400).json({ error: 'drawId ist ungültig.' });
  }
  if (drawLineup !== undefined && (!drawId || !isDrawLineup(drawLineup))) {
    return res.status(400).json({ error: 'drawLineup ist ungültig.' });
  }
  let draw: DrawLinkRow | undefined;
  if (drawId) {
    draw = db
      .prepare('SELECT id, created_by, match_id, tournament_id, event_id, seat_pairs_considered, game_id, source, teams FROM matchmaking_draws WHERE id = ? AND group_id = ?')
      .get(drawId, req.group!.id) as DrawLinkRow | undefined;
    if (!draw) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
    if (draw.match_id) return res.status(409).json({ error: 'Für diese Auslosung wurde bereits ein Ergebnis erfasst.' });
    if (draw.tournament_id) return res.status(409).json({ error: 'Aus dieser Auslosung wurde bereits ein Turnier erstellt.' });
    if (draw.event_id !== eventId) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  }

  const row: MatchRow = {
    id: nanoid(),
    created_by: draw ? draw.created_by : req.player!.id,
    game_id: gameId,
    event_id: eventId,
    played_at: playedAt ?? Date.now(),
    result: JSON.stringify(validated),
    group_id: req.group!.id,
  };
  try {
    withBettingAccounting(eventId, () => {
      if (drawId && drawLineup) {
        const currentTeams = db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').pluck().get(drawId) as string | undefined;
        const current = currentTeams
          ? (JSON.parse(currentTeams) as Array<{ players: Array<{ id: string }> }>).map((team) => team.players.map((player) => player.id))
          : [];
        if (lineupKey(current) !== lineupKey(drawLineup as string[][])) throw new DrawLineupChangedError();
      }
      db.prepare('INSERT INTO matches (id, game_id, event_id, played_at, result, group_id, created_by, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        row.id,
        row.game_id,
        row.event_id,
        row.played_at,
        row.result,
        row.group_id,
        row.created_by,
        Date.now(),
        Date.now(),
      );

      if (drawId && draw) {
        // Insert and claim share one transaction. If another request already
        // claimed the draw, throwing rolls the just-inserted match back too.
        const claimed = db
          .prepare('UPDATE matchmaking_draws SET match_id = ? WHERE id = ? AND match_id IS NULL AND tournament_id IS NULL')
          .run(row.id, drawId);
        if (claimed.changes === 0) throw new DrawAlreadyClaimedError();

      // The submitted teams can differ from the draw's original snapshot —
      // a player was moved or dropped in the entry form, or the result was
      // entered as Frei-für-alle (each participant becomes their own team)
      // instead of the drawn team shape. Re-snapshot the draw's `teams` to
      // what was actually recorded so Ergebnis-Historie shows the real
      // lineup, and so its length always matches the match's for
      // attachMatchResults' score/rank/winner enrichment.
      const teamPlayerIdLists = validated.teams.map((t) => t.playerIds);
      const originalTeams = JSON.parse(draw.teams) as Array<{
        skillSnapshot?: boolean;
        players: Array<{ id: string; rating: number | null }>;
      }>;
      const preserveDraftSkill = draw.source === 'draft' && draw.game_id === gameId
        && originalTeams.length > 0 && originalTeams.every((team) => team.skillSnapshot === true);
      // Preserve completion-time ratings by player ID, even after a move or
      // FFA regrouping. New participants get their rating at result entry.
      // An old draft or a result for another game has no applicable snapshot.
      const storedRatings = preserveDraftSkill
        ? new Map(originalTeams.flatMap((team) => team.players.map((player) => [player.id, player.rating] as const)))
        : undefined;
      const snapshotTeams = buildTeamsSnapshot(gameId, teamPlayerIdLists, storedRatings)
        .map((team) => preserveDraftSkill ? { ...team, skillSnapshot: true } : team);
      const seatConflicts = draw.seat_pairs_considered > 0
        ? applySeatConflicts(req.group!.id, draw.event_id, snapshotTeams)
        : 0;
      db.prepare('UPDATE matchmaking_draws SET teams = ?, seat_conflicts = ? WHERE id = ?').run(
        JSON.stringify(snapshotTeams),
        seatConflicts,
        drawId,
      );
      }
      syncCompetitionPoints(req.group!.id, eventId);
    });
  } catch (error) {
    if (error instanceof DrawAlreadyClaimedError) {
      return res.status(409).json({ error: 'Für diese Auslosung wurde bereits ein Ergebnis erfasst.' });
    }
    if (error instanceof DrawLineupChangedError) {
      return res.status(409).json({ error: DRAW_LINEUP_CHANGED, code: 'draw_lineup_changed' });
    }
    throw error;
  }

  if (drawId) {
    broadcast(
      Events.matchmakingDrawsChanged,
      { id: drawId, matchId: row.id },
      { groupId: req.group!.id, eventId },
    );
  }

  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.status(201).json(parseMatch(row));
});

const resolveMatch = resolveGroupResource<MatchRow>({
  resourceType: 'Match',
  load: (id) => {
    const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as MatchRow | undefined;
    return row ? { resource: row, groupId: row.group_id } : undefined;
  },
});

// PATCH /api/matches/:id - correct a mistaken entry. event_id never changes —
// a match stays tagged to the LAN it was actually played at.
matchesRouter.patch('/:id', resolveMatch, (req, res) => {
  const existing = req.groupResource as MatchRow;
  if (!requireGroupEventAccess(req, res, existing.event_id)) return;

  const { gameId, teams, winnerTeamIndex, isDraw, playedAt } = req.body ?? {};
  const prevResult = JSON.parse(existing.result) as MatchResult;

  let nextGameId = existing.game_id;
  if (gameId !== undefined) {
    if (typeof gameId !== 'string' || !gameId) {
      return res.status(400).json({ error: 'gameId ist ungültig.' });
    }
    const game = db.prepare('SELECT id, status FROM games WHERE id = ? AND group_id = ?').get(gameId, req.group!.id) as
      | { id: string; status: string }
      | undefined;
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
    // Only a *change* is guarded: a game that was moved back to the
    // suggestions after this result was recorded must stay editable (score,
    // winner) instead of freezing the whole match.
    if (gameId !== existing.game_id && isSuggestionGame(game)) {
      return res.status(400).json({ error: SUGGESTION_GAME_ERROR });
    }
    nextGameId = gameId;
  }

  let nextResultObj = prevResult;
  if (teams !== undefined || winnerTeamIndex !== undefined || isDraw !== undefined) {
    const validated = validateTeams(
      teams ?? prevResult.teams,
      winnerTeamIndex !== undefined ? winnerTeamIndex : prevResult.winnerTeamIndex,
      isDraw !== undefined ? isDraw : winnerTeamIndex !== undefined ? false : prevResult.isDraw ?? false,
    );
    if ('error' in validated) return res.status(400).json({ error: validated.error });
    if (!competitionPlayersBelongToGroup(req.group!.id, existing.event_id, validated.teams.flatMap((t) => t.playerIds))) {
      return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
    }
    nextResultObj = validated;
  }

  let nextPlayedAt = existing.played_at;
  if (playedAt !== undefined) {
    if (typeof playedAt !== 'number' || !Number.isFinite(playedAt)) {
      return res.status(400).json({ error: 'playedAt muss ein Zeitstempel (ms) sein.' });
    }
    nextPlayedAt = playedAt;
  }

  const nextResult = JSON.stringify(nextResultObj);
  withBettingAccounting(existing.event_id, () => {
    const rounds = correctableDrawRounds(req.group!.id, existing.id);
    if (!rounds.length) assertMatchEditable(req.group!.id, existing.id);
    const correction = validateBettingCorrection(req, rounds);
    if (nextGameId !== existing.game_id || nextPlayedAt !== existing.played_at || nextResult !== existing.result) {
      db.prepare('UPDATE matches SET game_id = ?, played_at = ?, result = ?, updated_at = ?, result_revision = result_revision + 1 WHERE id = ?')
        .run(nextGameId, nextPlayedAt, nextResult, Date.now(), existing.id);
    }
    rebookCorrectedRounds(rounds, correction);
    syncCompetitionPoints(req.group!.id, existing.event_id);
  });

  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId: existing.event_id });
  res.json(
    parseMatch({
      id: existing.id,
      created_by: existing.created_by,
      game_id: nextGameId,
      event_id: existing.event_id,
      played_at: nextPlayedAt,
      result: nextResult,
      group_id: existing.group_id,
    })
  );
});

// DELETE /api/matches/:id
matchesRouter.delete('/:id', resolveMatch, requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  const existing = req.groupResource as MatchRow;
  if (!requireGroupEventAccess(req, res, existing.event_id)) return;
  withBettingAccounting(existing.event_id, () => {
    assertMatchEditable(req.group!.id, existing.id);
    db.prepare('DELETE FROM matches WHERE id = ?').run(existing.id);
    syncCompetitionPoints(req.group!.id, existing.event_id);
  });
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: req.group!.id,
    action: 'match_deleted',
    targetType: 'match',
    targetId: existing.id,
  });
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId: existing.event_id });
  res.status(204).end();
});
