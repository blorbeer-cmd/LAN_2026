import { withBettingAccounting, assertCompetitionEditable, assertMatchEditable, retireRerolledDraw, publishBettingChanges, type BettingRound } from '../betting';
import { syncCompetitionPoints } from '../orgaPoints';
import { PointsError } from '../pointsAccess';
// Matchmaking endpoint (FR-16..18): draws balanced teams for a game from a
// set of present players, using their skill ratings. Stateless — every call
// is a fresh draw, so "re-roll" is just calling it again. The result is
// broadcast to everyone so the whole LAN sees the same teams, not just
// whoever clicked the button.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { isSuggestionGame, SUGGESTION_GAME_ERROR } from './gameSelection';
import { broadcast, Events } from '../realtime';
import {
  balanceTeams,
  computeTeamCount,
  countSeatConflicts,
  reshuffleTeams,
  seatConflictNeighbors,
  type PlayerRating,
  type SeatPair,
} from '../matchmaking';
import { isIntInRange } from '../validation';
import { competitionPlayersBelongToGroup } from '../competitionScope';
import { requireGroupEventAccess, resolveRequestGroupEventScope } from '../groupEventScope';
import { requireGroupRole } from '../groupAuthorization';
import { requireRecentReauthentication } from '../sessions';
import { writeAdminAudit } from '../adminAudit';
import { listMatchScreenshots, pruneMatchScreenshotFiles } from '../matchScreenshots';
import { assertDrawLineup, DRAW_LINEUP_CHANGED, DRAW_LINEUP_CHANGED_CODE, DrawLineupChangedError, isDrawLineup } from '../drawLineup';

export const matchmakingRouter = Router();

// Neutral middle rating for players without one. It is what balanceTeams
// works with, but a stored teams snapshot keeps `rating: null` for such a
// player instead of the substituted number: only then can a later reader tell
// "rated 3" from "had no rating and was drawn as a 3". The frontend shows the
// same value in parentheses for a null and includes it in the team total
// (UNRATED_SKILL_VALUE in public/js/skillDisplay.js) — change both together,
// or the displayed totals stop matching the draw they came from.
const DEFAULT_RATING = 3;

// Team total the way the draw itself saw it: a player without an own rating
// contributes the neutral fallback, exactly as in the balancing input.
const totalRatingOf = (players: Array<{ rating: number | null }>): number =>
  players.reduce((sum, p) => sum + (p.rating ?? DEFAULT_RATING), 0);
const deliveryEventId = (eventId: string): string => eventId;

interface GameRow {
  id: string;
  name: string;
  max_team_size: number;
  status: string;
}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

// Re-derives a draw-shaped teams snapshot (full player info + totalRating)
// from plain player-id lists — used wherever a fresh matchmaking_draws.teams
// value needs to be built from scratch: the rematch endpoint, and POST
// /api/matches re-snapshotting a linked draw to whatever was actually
// submitted (see the comment on that call site). A draft can supply its
// completion-time ratings by player ID; only new IDs read current ratings.
export function buildTeamsSnapshot(
  gameId: string,
  teamPlayerIdLists: string[][],
  storedRatings?: ReadonlyMap<string, number | null>,
) {
  const allIds = [...new Set(teamPlayerIdLists.flat())];
  const playerById = new Map<string, PlayerRow>();
  const ratingByPlayer = new Map<string, number>();
  if (allIds.length > 0) {
    const placeholders = allIds.map(() => '?').join(',');
    const players = db
      .prepare(`SELECT id, name, color, avatar FROM players WHERE deactivated_at IS NULL AND id IN (${placeholders})`)
      .all(...allIds) as PlayerRow[];
    players.forEach((p) => playerById.set(p.id, p));
    const ratingRows = db
      .prepare(`SELECT player_id, rating FROM skills WHERE game_id = ? AND player_id IN (${placeholders})`)
      .all(gameId, ...allIds) as Array<{ player_id: string; rating: number }>;
    ratingRows.forEach((r) => ratingByPlayer.set(r.player_id, r.rating));
  }
  return teamPlayerIdLists.map((ids) => {
    const teamPlayers = ids.map((id) => {
      const p = playerById.get(id);
      return {
        id,
        name: p?.name ?? '?',
        color: p?.color ?? '#888888',
        avatar: p?.avatar ?? null,
        rating: storedRatings?.has(id) ? storedRatings.get(id)! : ratingByPlayer.get(id) ?? null,
      };
    });
    return { players: teamPlayers, totalRating: totalRatingOf(teamPlayers) };
  });
}

// Recomputes and applies per-player seatConflict/seatConflictNames flags for
// a teams snapshot (mutates the player objects in place) and returns the
// aggregate conflict count. Shared by the Feinschliff move handler and the
// POST /api/matches re-snapshot below — both need to re-derive conflicts
// after a team lineup changes post-draw.
export function applySeatConflicts(
  groupId: string,
  eventId: string,
  teams: Array<{ players: Array<{ id: string; name: string; seatConflict?: boolean; seatConflictNames?: string[] }> }>
): number {
  const allPlayers = teams.flatMap((t) => t.players);
  const nameById = new Map(allPlayers.map((p) => [p.id, p.name]));
  const avoidPairs = loadAvoidPairs(groupId, eventId, allPlayers.map((p) => p.id));
  const teamIdLists = teams.map((t) => t.players.map((p) => p.id));
  const seatConflicts = countSeatConflicts(teamIdLists, avoidPairs);
  const conflictNeighbors = seatConflictNeighbors(teamIdLists, avoidPairs);
  for (const p of allPlayers) {
    const neighborIds = conflictNeighbors.get(p.id);
    p.seatConflict = !!neighborIds;
    p.seatConflictNames = neighborIds?.map((nid) => nameById.get(nid)).filter((n): n is string => !!n) ?? [];
  }
  return seatConflicts;
}

// Declared seat-neighbor pairs among a set of players, deduped (neighbors are
// stored per-direction — see seat_neighbors' comment in db.ts). Shared by the
// initial draw and by re-deriving conflicts after a manual Feinschliff move.
function loadAvoidPairs(groupId: string, eventId: string, playerIds: string[]): SeatPair[] {
  const placeholders = playerIds.map(() => '?').join(',');
  const neighborRows = db
    .prepare(
      `SELECT player_id, neighbor_id FROM seat_neighbors
       WHERE group_id = ? AND event_id IS ?
         AND player_id IN (${placeholders}) AND neighbor_id IN (${placeholders})`
    )
    .all(groupId, eventId, ...playerIds, ...playerIds) as Array<{
      player_id: string;
      neighbor_id: string;
    }>;
  const seen = new Set<string>();
  const pairs: SeatPair[] = [];
  for (const r of neighborRows) {
    const key = [r.player_id, r.neighbor_id].sort().join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([r.player_id, r.neighbor_id]);
  }
  return pairs;
}

// POST /api/matchmaking
// Body: { gameId: string, playerIds: string[], teamCount?: number,
//         avoidAdjacentOpponents?: boolean, bettingAllowed?: boolean,
//         replacesDrawId?: string }
// replacesDrawId names the unplayed draw this re-roll discards; it only takes
// effect for the same game and roster (see retireRerolledDraw).
// avoidAdjacentOpponents is always an explicit per-draw choice here, never
// implied by the game. games.consider_seat_neighbors_default (routes/games.ts)
// only prefills this checkbox client-side when a game is selected — it still
// arrives as an ordinary boolean in this request body and stays freely
// overridable per draw, since whether it's worth keeping seat-neighbors off
// opposing teams can depend on how competitive/serious that particular round
// is, not just the game itself.
matchmakingRouter.post('/', (req, res) => {
  const { gameId, playerIds, teamCount, avoidAdjacentOpponents, bettingAllowed: requestedBettingAllowed, replacesDrawId } = req.body ?? {};
  if (requestedBettingAllowed !== undefined && typeof requestedBettingAllowed !== 'boolean')
    return res.status(400).json({ error: 'Wetten erlauben muss Ja oder Nein sein.' });
  if (replacesDrawId !== undefined && (typeof replacesDrawId !== 'string' || !replacesDrawId || replacesDrawId.length > 64))
    return res.status(400).json({ error: 'replacesDrawId ist ungültig.' });

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (!Array.isArray(playerIds) || playerIds.length < 2 || !playerIds.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'playerIds muss ein Array mit mindestens 2 Spielern sein.' });
  }
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length !== playerIds.length) {
    return res.status(400).json({ error: 'playerIds enthält Duplikate.' });
  }
  if (teamCount !== undefined && !isIntInRange(teamCount, 2, uniqueIds.length)) {
    // Surfaced directly as a toast by the matchmaking view, so phrase it for
    // humans (the other shape errors here are unreachable through the UI).
    return res
      .status(400)
      .json({ error: `Anzahl Teams muss zwischen 2 und ${uniqueIds.length} (Anzahl Spieler) liegen.` });
  }
  if (avoidAdjacentOpponents !== undefined && typeof avoidAdjacentOpponents !== 'boolean') {
    return res.status(400).json({ error: 'avoidAdjacentOpponents muss ein Boolean sein.' });
  }

  const game = db
    .prepare('SELECT id, name, max_team_size, status FROM games WHERE id = ? AND group_id = ?')
    .get(gameId, req.group!.id) as GameRow | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (isSuggestionGame(game)) return res.status(400).json({ error: SUGGESTION_GAME_ERROR });

  const scope = resolveRequestGroupEventScope(req, undefined);
  if (!scope.ok || !scope.eventId) return res.status(409).json({ error: 'Kein aktives Event verfügbar.' });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const eventId = scope.eventId;
  if (!competitionPlayersBelongToGroup(req.group!.id, eventId, uniqueIds)) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(`SELECT id, name, color, avatar FROM players WHERE deactivated_at IS NULL AND id IN (${placeholders})`)
    .all(...uniqueIds) as PlayerRow[];
  if (players.length !== uniqueIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const ratingRows = db
    .prepare(`SELECT player_id, rating FROM skills WHERE game_id = ? AND player_id IN (${placeholders})`)
    .all(gameId, ...uniqueIds) as Array<{ player_id: string; rating: number }>;
  const ratingByPlayer = new Map(ratingRows.map((r) => [r.player_id, r.rating]));

  const ratings: PlayerRating[] = players.map((p) => ({
    id: p.id,
    rating: ratingByPlayer.get(p.id) ?? DEFAULT_RATING,
  }));

  // Seat neighbors only get looked up when this particular draw asked for
  // it (FR-18 extension) — skip the query entirely otherwise.
  const avoidPairs: SeatPair[] = avoidAdjacentOpponents ? loadAvoidPairs(req.group!.id, eventId, uniqueIds) : [];

  const resolvedTeamCount = computeTeamCount(teamCount, players.length, game.max_team_size);
  const bettingAllowed = requestedBettingAllowed ?? true;
  const teamIdLists = balanceTeams(ratings, resolvedTeamCount, avoidPairs);
  const seatConflicts = countSeatConflicts(teamIdLists, avoidPairs);
  const conflictNeighbors = seatConflictNeighbors(teamIdLists, avoidPairs);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const teams = teamIdLists.map((ids) => {
    const teamPlayers = ids.map((id) => {
      const neighborIds = conflictNeighbors.get(id);
      return {
        ...playerById.get(id)!,
        rating: ratingByPlayer.get(id) ?? null,
        seatConflict: !!neighborIds,
        seatConflictNames: neighborIds?.map((nid) => playerById.get(nid)?.name).filter((n): n is string => !!n) ?? [],
      };
    });
    return {
      players: teamPlayers,
      totalRating: totalRatingOf(teamPlayers),
    };
  });

  const drawId = nanoid();
  const result = {
    id: drawId,
    gameId,
    gameName: game.name,
    teams,
    seatConflicts,
    seatPairsConsidered: avoidPairs.length,
    // Only used client-side to re-derive per-player conflict flags after a
    // manual Feinschliff move on an unsaved proposal (e.g. the tournament
    // create form) — not persisted, the saved draw's `teams` already carries
    // the flags baked in.
    avoidPairs,
    generatedAt: Date.now(),
    matchId: null as string | null,
    source: null as string | null,
    bettingAllowed,
    serverAddress: null as string | null,
    serverPassword: null as string | null,
    createdByName: req.player!.name,
  };

  // Logged for the history view (every draw, including re-rolls — see the
  // matchmaking_draws comment in db.ts for why this is separate from the
  // actually-recorded `matches`).
  // A re-roll of the draw shown before closes that draw's open market in the
  // same transaction; its refund is published with the other changes.
  let retired: BettingRound[] = [];
  withBettingAccounting(eventId, () => {
    db.prepare(
      `INSERT INTO matchmaking_draws (id, game_id, event_id, group_id, teams, seat_conflicts, seat_pairs_considered, generated_at, created_by, betting_allowed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(drawId, gameId, eventId, req.group!.id, JSON.stringify(teams), seatConflicts, avoidPairs.length, result.generatedAt, req.player!.id, Number(bettingAllowed));
    if (replacesDrawId) retired = retireRerolledDraw(req.group!.id, eventId, replacesDrawId, gameId, uniqueIds);
  });
  publishBettingChanges(retired);
  broadcast(Events.matchmakingGenerated, result, { groupId: req.group!.id, eventId: deliveryEventId(eventId) });
  res.json(result);
});

// POST /api/matchmaking/rematch - re-run the *same* team lineup (no
// rebalancing) as a fresh draw, so entering a result for it lands in
// Ergebnis-Historie like any other draw instead of only in the leaderboard.
// Body: { gameId: string, teams: [{ playerIds: string[] }] } (same shape the
// frontend already has lying around from the draw it's rematching).
matchmakingRouter.post('/rematch', (req, res) => {
  const { gameId, teams: teamsInput, bettingAllowed: requestedBettingAllowed } = req.body ?? {};
  if (requestedBettingAllowed !== undefined && typeof requestedBettingAllowed !== 'boolean')
    return res.status(400).json({ error: 'Wetten erlauben muss Ja oder Nein sein.' });

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (!Array.isArray(teamsInput) || teamsInput.length < 2) {
    return res.status(400).json({ error: 'teams muss ein Array mit mindestens 2 Teams sein.' });
  }
  const teamPlayerIdLists: string[][] = [];
  const allIds: string[] = [];
  for (const t of teamsInput as unknown[]) {
    const playerIds = (t as { playerIds?: unknown }).playerIds;
    if (!Array.isArray(playerIds) || playerIds.length === 0 || !playerIds.every((p) => typeof p === 'string')) {
      return res.status(400).json({ error: 'Jedes Team braucht mindestens einen Spieler.' });
    }
    teamPlayerIdLists.push(playerIds);
    allIds.push(...playerIds);
  }
  const uniqueIds = [...new Set(allIds)];
  if (uniqueIds.length !== allIds.length) {
    return res.status(400).json({ error: 'Ein Spieler ist in mehreren Teams.' });
  }

  const game = db
    .prepare('SELECT id, name, max_team_size, status FROM games WHERE id = ? AND group_id = ?')
    .get(gameId, req.group!.id) as GameRow | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (isSuggestionGame(game)) return res.status(400).json({ error: SUGGESTION_GAME_ERROR });

  const scope = resolveRequestGroupEventScope(req, undefined);
  if (!scope.ok || !scope.eventId) return res.status(409).json({ error: 'Kein aktives Event verfügbar.' });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const eventId = scope.eventId;
  if (!competitionPlayersBelongToGroup(req.group!.id, eventId, uniqueIds)) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(`SELECT id, name, color, avatar FROM players WHERE deactivated_at IS NULL AND id IN (${placeholders})`)
    .all(...uniqueIds) as PlayerRow[];
  if (players.length !== uniqueIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const teams = buildTeamsSnapshot(gameId, teamPlayerIdLists);
  const bettingAllowed = requestedBettingAllowed ?? true;

  const drawId = nanoid();
  const result = {
    id: drawId,
    gameId,
    gameName: game.name,
    teams,
    seatConflicts: 0,
    seatPairsConsidered: 0,
    generatedAt: Date.now(),
    matchId: null as string | null,
    source: 'rematch' as string | null,
    bettingAllowed,
    serverAddress: null as string | null,
    serverPassword: null as string | null,
    createdByName: req.player!.name,
  };

  withBettingAccounting(eventId, () => db.prepare(
    `INSERT INTO matchmaking_draws (id, game_id, event_id, group_id, teams, seat_conflicts, seat_pairs_considered, generated_at, source, created_by, betting_allowed)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'rematch', ?, ?)`
  ).run(drawId, gameId, eventId, req.group!.id, JSON.stringify(teams), result.generatedAt, req.player!.id, Number(bettingAllowed)));
  broadcast(Events.matchmakingGenerated, result, { groupId: req.group!.id, eventId: deliveryEventId(eventId) });
  res.json(result);
});

interface DrawRow {
  id: string;
  gameId: string;
  gameName: string;
  gameIcon: string;
  teamsJson: string;
  seatConflicts: number;
  seatPairsConsidered: number;
  generatedAt: number;
  matchId: string | null;
  source: string | null;
  tournamentId?: string | null;
  tournamentName?: string | null;
  bettingAllowed: number;
  serverAddress: string | null;
  serverPassword: string | null;
  createdByName: string | null;
}

const DRAW_COLUMNS = `md.id AS id, md.game_id AS gameId, g.name AS gameName, g.icon AS gameIcon,
              md.teams AS teamsJson, md.seat_conflicts AS seatConflicts,
              md.seat_pairs_considered AS seatPairsConsidered, md.generated_at AS generatedAt,
              md.match_id AS matchId, md.source AS source, md.betting_allowed AS bettingAllowed,
              md.tournament_id AS tournamentId, t.name AS tournamentName,
              md.server_address AS serverAddress, md.server_password AS serverPassword,
              creator.name AS createdByName`;
// The creator is shown as "Ausgelost von …"; a since-removed account simply
// leaves the name empty instead of hiding the draw.
const DRAW_JOINS = `FROM matchmaking_draws md
       JOIN games g ON g.id = md.game_id
       LEFT JOIN tournaments t ON t.id = md.tournament_id
       LEFT JOIN players creator ON creator.id = md.created_by`;

function parseDrawRow(r: DrawRow) {
  return {
    id: r.id,
    gameId: r.gameId,
    gameName: r.gameName,
    gameIcon: r.gameIcon,
    teams: JSON.parse(r.teamsJson),
    seatConflicts: r.seatConflicts,
    seatPairsConsidered: r.seatPairsConsidered,
    generatedAt: r.generatedAt,
    matchId: r.matchId,
    source: r.source,
    tournamentId: r.tournamentId ?? null,
    tournamentName: r.tournamentName ?? null,
    bettingAllowed: Boolean(r.bettingAllowed),
    // Server details only matter while the Match is still open; a recorded or
    // tournament-owned draw no longer exposes them (nor can they be edited).
    serverAddress: r.matchId || r.tournamentId ? null : r.serverAddress ?? null,
    serverPassword: r.matchId || r.tournamentId ? null : r.serverPassword ?? null,
    createdByName: r.createdByName ?? null,
  };
}

interface MatchResultRow {
  id: string;
  result: string;
}

// Ergebnis-Historie shows the actual entered score/rank/winner, not just the
// draw's original team snapshot — merges each linked match's per-team result
// data in by index. Draws are only ever linked right after being recorded
// with that exact team lineup (see POST /api/matches), so the indices line
// up; if a draw was somehow re-shaped since (defensive, shouldn't happen),
// the length check just skips enrichment instead of misattributing scores.
function attachMatchResults(draws: ReturnType<typeof parseDrawRow>[]): void {
  const matchIds = draws.map((d) => d.matchId).filter((id): id is string => !!id);
  if (matchIds.length === 0) return;

  const placeholders = matchIds.map(() => '?').join(',');
  const matchRows = db
    .prepare(`SELECT id, result FROM matches WHERE id IN (${placeholders})`)
    .all(...matchIds) as MatchResultRow[];
  const resultById = new Map(
    matchRows.map((m) => [m.id, JSON.parse(m.result) as { teams: Array<{ score?: number | null; rank?: number | null }>; winnerTeamIndex: number | null; isDraw?: boolean }])
  );
  const screenshotsByMatch = listMatchScreenshots(matchIds);

  for (const draw of draws) {
    if (!draw.matchId) continue;
    (draw as { screenshots?: unknown }).screenshots = screenshotsByMatch.get(draw.matchId) ?? [];
    const matchResult = resultById.get(draw.matchId);
    if (!matchResult || matchResult.teams.length !== draw.teams.length) continue;
    draw.teams.forEach((t: { score?: number | null; rank?: number | null }, i: number) => {
      t.score = matchResult.teams[i].score ?? null;
      t.rank = matchResult.teams[i].rank ?? null;
    });
    (draw as { winnerTeamIndex?: number | null }).winnerTeamIndex = matchResult.winnerTeamIndex ?? null;
    (draw as { isDraw?: boolean }).isDraw = matchResult.isDraw === true;
  }
}

// GET /api/matchmaking/history - past draws for the active event (or an
// explicit ?eventId=), newest first, optionally narrowed to one ?gameId=.
// The full history includes still-unrecorded draws; kind=matches pages only
// recorded results. Open draws are returned separately on the first page.
matchmakingRouter.get('/history', (req, res) => {
  const { eventId, gameId, limit, kind, mine, before, beforeId } = req.query;
  const scope = resolveRequestGroupEventScope(req, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const filterEventId = scope.eventId!;
  const limitNum = Math.min(50, Math.max(1, parseInt(typeof limit === 'string' ? limit : '', 10) || 20));
  if (kind !== undefined && kind !== 'all' && kind !== 'matches') {
    return res.status(400).json({ error: 'kind ist ungültig.' });
  }
  if (mine !== undefined && mine !== '0' && mine !== '1') {
    return res.status(400).json({ error: 'mine ist ungültig.' });
  }
  if ((before !== undefined || beforeId !== undefined) &&
    (typeof before !== 'string' || !/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) ||
      typeof beforeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(beforeId))) {
    return res.status(400).json({ error: 'Historien-Cursor ist ungültig.' });
  }

  const clauses = ['md.group_id = ?', 'md.event_id = ?'];
  const params: Array<string | number> = [req.group!.id, filterEventId];
  // Scope participation before LIMIT/cursor paging, using the authenticated
  // player and the persisted lineup rather than the draw creator.
  if (mine === '1') {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(md.teams) team,
      json_each(team.value, '$.players') player WHERE json_extract(player.value, '$.id') = ?)`);
    params.push(req.player!.id);
  }
  if (kind === 'matches') clauses.push('md.tournament_id IS NULL');
  // Lineups without a result are listed for every game: an open match of
  // another game must stay findable for its result and its tips while the
  // game picker only prepares the next draw.
  const openClauses = [...clauses];
  const openParams = [...params];
  if (typeof gameId === 'string' && gameId) {
    clauses.push('md.game_id = ?');
    params.push(gameId);
  }
  if (kind === 'matches') clauses.push('md.match_id IS NOT NULL');
  if (before !== undefined) {
    clauses.push('(md.generated_at < ? OR (md.generated_at = ? AND md.id < ?))');
    params.push(Number(before), Number(before), beforeId as string);
  }

  const columns = DRAW_COLUMNS;
  const joins = DRAW_JOINS;

  const rows = db
    .prepare(
      `SELECT ${columns}
       ${joins}
       WHERE ${clauses.join(' AND ')}
       ORDER BY md.generated_at DESC, md.id DESC
       LIMIT ?`
    )
    .all(...params, limitNum + 1) as DrawRow[];

  const hasMore = rows.length > limitNum;
  const pageRows = rows.slice(0, limitNum);
  const draws = pageRows.map(parseDrawRow);
  attachMatchResults(draws);
  const last = pageRows.at(-1);
  // Open rerolls are collected independently so even an old unused lineup is
  // visible in the single "Ohne Ergebnis" tile before older pages are loaded.
  const openDraws = before === undefined
    ? (db.prepare(`SELECT ${columns} ${joins}
        WHERE ${openClauses.join(' AND ')} AND md.match_id IS NULL AND md.tournament_id IS NULL
        ORDER BY md.generated_at DESC, md.id DESC`).all(...openParams) as DrawRow[]).map(parseDrawRow)
    : undefined;
  res.json({ history: draws, openDraws, nextCursor: hasMore && last ? { before: last.generatedAt, beforeId: last.id } : null });
});

// GET /api/matchmaking/draws/:id - one draw in its client shape, for a view
// that must refresh a specific draw independent of the history filters (a
// lineup conflict on the "Neue Auslosung" card, which "Meine" may hide).
matchmakingRouter.get('/draws/:id', (req, res) => {
  const row = db.prepare('SELECT id, event_id FROM matchmaking_draws WHERE id = ? AND group_id = ?')
    .get(req.params.id, req.group!.id) as { id: string; event_id: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (!requireGroupEventAccess(req, res, row.event_id)) return;
  res.json(loadDrawView(row.id));
});

// Removing a card also removes its linked standalone leaderboard result.
// A tournament-owned draw must go through the tournament delete flow instead.
matchmakingRouter.delete('/draws/:id', requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  const draw = db.prepare(
    'SELECT id, event_id, match_id, tournament_id FROM matchmaking_draws WHERE id = ? AND group_id = ?'
  ).get(req.params.id, req.group!.id) as {
    id: string; event_id: string; match_id: string | null; tournament_id: string | null;
  } | undefined;
  if (!draw) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (!requireGroupEventAccess(req, res, draw.event_id)) return;
  if (draw.tournament_id) {
    return res.status(409).json({ error: 'Diese Auslosung gehört zu einem Turnier. Bitte das Turnier separat löschen.' });
  }

  assertCompetitionEditable(req.group!.id, draw.event_id, 'draw', draw.id);

  withBettingAccounting(draw.event_id, () => {
    if (draw.match_id) db.prepare('DELETE FROM matches WHERE id = ? AND group_id = ?').run(draw.match_id, req.group!.id);
    db.prepare('DELETE FROM matchmaking_draws WHERE id = ? AND group_id = ?').run(draw.id, req.group!.id);
    syncCompetitionPoints(req.group!.id, draw.event_id);
    writeAdminAudit({
      actorPlayerId: req.player?.id,
      groupId: req.group!.id,
      action: 'matchmaking_draw_deleted',
      targetType: 'matchmaking_draw',
      targetId: draw.id,
      details: { hadResult: Boolean(draw.match_id) },
    });
  });
  if (draw.match_id) pruneMatchScreenshotFiles();
  broadcast(Events.matchmakingDrawsChanged, { id: draw.id, deleted: true }, { groupId: req.group!.id, eventId: draw.event_id });
  if (draw.match_id) broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId: draw.event_id });
  res.status(204).end();
});

// PATCH /api/matchmaking/draws/:id/move - Feinschliff: move one player to a
// different team of a still-unrecorded draw. Recomputes totalRating for both
// affected teams; a draw with an already-recorded result is frozen (the
// result was entered for the team lineup as it stood then).
matchmakingRouter.patch('/draws/:id/move', (req, res) => {
  const { playerId, toTeamIndex } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!Number.isInteger(toTeamIndex) || toTeamIndex < 0) {
    return res.status(400).json({ error: 'toTeamIndex ist ungültig.' });
  }

  const row = db.prepare('SELECT * FROM matchmaking_draws WHERE id = ? AND group_id = ?').get(req.params.id, req.group!.id) as
    | {
        id: string;
        game_id: string;
        event_id: string;
        teams: string;
        match_id: string | null;
        tournament_id: string | null;
        seat_pairs_considered: number;
        source: string | null;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  // The group_id filter above is not the event boundary: a draw belongs to a
  // concrete event, and only its accepted participants may reshuffle it —
  // same rule POST /, POST /rematch and GET /history apply.
  if (!requireGroupEventAccess(req, res, row.event_id)) return;
  if (row.match_id) {
    return res.status(409).json({ error: 'Für diese Auslosung wurde bereits ein Ergebnis erfasst.' });
  }
  if (row.tournament_id) {
    return res.status(409).json({ error: 'Aus dieser Auslosung wurde bereits ein Turnier erstellt.' });
  }

  const teams = JSON.parse(row.teams) as Array<{
    players: Array<{ id: string; name: string; rating: number | null; seatConflict?: boolean; seatConflictNames?: string[] }>;
    totalRating: number;
    skillSnapshot?: boolean;
  }>;
  if (toTeamIndex >= teams.length) {
    return res.status(400).json({ error: 'toTeamIndex ist ungültig.' });
  }

  const fromTeamIndex = teams.findIndex((t) => t.players.some((p) => p.id === playerId));
  if (fromTeamIndex === -1) {
    return res.status(404).json({ error: 'Spieler ist in keinem Team dieser Auslosung.' });
  }

  if (fromTeamIndex !== toTeamIndex) {
    if (teams[fromTeamIndex].players.length <= 1) {
      return res.status(409).json({ error: 'Ein Team kann nicht komplett leer werden.' });
    }
    const [player] = teams[fromTeamIndex].players.splice(
      teams[fromTeamIndex].players.findIndex((p) => p.id === playerId),
      1
    );
    teams[toTeamIndex].players.push(player);
    // New drafts carry an informational completion-time snapshot. Older ones
    // have no marker and must not acquire a misleading skill total on move.
    for (const t of [teams[fromTeamIndex], teams[toTeamIndex]]) {
      t.totalRating = row.source === 'draft' && !t.skillSnapshot ? 0 : totalRatingOf(t.players);
    }
  }

  // The move can turn a resolved seat-neighbor pair into a conflict (or fix
  // one) — only re-derive it when this draw actually considered seat
  // neighbors in the first place (avoidAdjacentOpponents was on for it).
  const seatConflicts = row.seat_pairs_considered > 0 ? applySeatConflicts(req.group!.id, row.event_id, teams) : 0;

  withBettingAccounting(row.event_id, () => {
    db.prepare('UPDATE matchmaking_draws SET teams = ?, seat_conflicts = ? WHERE id = ?').run(
      JSON.stringify(teams),
      seatConflicts,
      row.id
    );
  });

  const draw = loadDrawView(row.id);
  broadcast(Events.matchmakingDrawsChanged, draw, {
    groupId: req.group!.id,
    eventId: deliveryEventId(row.event_id),
  });
  res.json(draw);
});

// The client-facing shape of one draw, including a linked result.
function loadDrawView(drawId: string) {
  const row = db
    .prepare(`SELECT ${DRAW_COLUMNS} ${DRAW_JOINS} WHERE md.id = ?`)
    .get(drawId) as DrawRow;
  const draw = parseDrawRow(row);
  attachMatchResults([draw]);
  return draw;
}

type DrawTeamSnapshot = {
  players: Array<{ id: string; name: string; rating: number | null; seatConflict?: boolean; seatConflictNames?: string[] }>;
  totalRating: number;
  skillSnapshot?: boolean;
};

// DELETE /api/matchmaking/draws/:id/players/:playerId - removes one player
// from a drawn lineup entirely (left the LAN, does not want to play).
// - Open draw: a team that loses its last player is dropped as long as two
//   teams remain; the betting reconcile then treats it like any lineup change.
// - Recorded result: the player leaves the draw and the match result together,
//   so they lose this match's game points (including the participation point
//   of a last place). Every team keeps its place, so nobody else's points
//   change; a team's last player cannot be removed because that would change
//   the placements. Settled tips block the edit like a result correction.
// - Tournament draws stay frozen: their teams live in the tournament.
// Check and write run in one immediate transaction: of two parallel requests
// for the same lineup exactly one wins, the other sees the new state (409).
matchmakingRouter.delete('/draws/:id/players/:playerId', (req, res) => {
  const { playerId } = req.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(playerId)) {
    return res.status(400).json({ error: 'playerId ist ungültig.' });
  }
  const groupId = req.group!.id;
  const existing = db.prepare('SELECT id, event_id FROM matchmaking_draws WHERE id = ? AND group_id = ?')
    .get(req.params.id, groupId) as { id: string; event_id: string } | undefined;
  if (!existing) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (!requireGroupEventAccess(req, res, existing.event_id)) return;

  const recorded = withBettingAccounting(existing.event_id, () => {
    const row = db.prepare('SELECT teams, match_id, tournament_id, seat_pairs_considered, source FROM matchmaking_draws WHERE id = ?')
      .get(existing.id) as { teams: string; match_id: string | null; tournament_id: string | null; seat_pairs_considered: number; source: string | null } | undefined;
    if (!row) throw new PointsError('Auslosung nicht gefunden.', 404);
    if (row.tournament_id) {
      throw new PointsError('Aus dieser Auslosung wurde bereits ein Turnier erstellt. Turnierteams lassen sich hier nicht ändern.');
    }
    const teams = JSON.parse(row.teams) as DrawTeamSnapshot[];
    const teamIndex = teams.findIndex((t) => t.players.some((p) => p.id === playerId));
    if (teamIndex === -1) throw new PointsError('Dieser Spieler ist nicht mehr in der Auslosung.');
    const team = teams[teamIndex];

    if (row.match_id) {
      assertMatchEditable(groupId, row.match_id);
      if (team.players.length <= 1) {
        throw new PointsError('Der letzte Spieler eines Teams mit Ergebnis kann nicht entfernt werden. Bitte das Ergebnis bearbeiten oder das Spiel löschen.');
      }
      const match = db.prepare('SELECT result FROM matches WHERE id = ?').get(row.match_id) as { result: string } | undefined;
      const result = match ? (JSON.parse(match.result) as { teams: Array<{ playerIds: string[] }> }) : null;
      const resultTeam = result?.teams.find((t) => t.playerIds.includes(playerId));
      if (!result || !resultTeam || resultTeam.playerIds.length <= 1) {
        throw new PointsError('Das Ergebnis passt nicht mehr zu dieser Auslosung. Bitte neu laden.');
      }
      resultTeam.playerIds = resultTeam.playerIds.filter((id) => id !== playerId);
      db.prepare('UPDATE matches SET result = ?, updated_at = ?, result_revision = result_revision + 1 WHERE id = ?')
        .run(JSON.stringify(result), Date.now(), row.match_id);
      team.players = team.players.filter((p) => p.id !== playerId);
    } else if (team.players.length <= 1) {
      if (teams.length <= 2) {
        throw new PointsError('Ein Match braucht mindestens zwei Teams. Entferne stattdessen die ganze Auslosung oder verschiebe zuerst einen Spieler.');
      }
      teams.splice(teamIndex, 1);
    } else {
      team.players = team.players.filter((p) => p.id !== playerId);
    }
    if (teams[teamIndex] === team) {
      // Same rule as a move: older drafts without a snapshot keep no total.
      team.totalRating = row.source === 'draft' && !team.skillSnapshot ? 0 : totalRatingOf(team.players);
    }
    const seatConflicts = row.seat_pairs_considered > 0 ? applySeatConflicts(groupId, existing.event_id, teams) : 0;
    db.prepare('UPDATE matchmaking_draws SET teams = ?, seat_conflicts = ? WHERE id = ?')
      .run(JSON.stringify(teams), seatConflicts, existing.id);
    if (row.match_id) syncCompetitionPoints(groupId, existing.event_id);
    return Boolean(row.match_id);
  });

  const draw = loadDrawView(existing.id);
  const scope = { groupId, eventId: deliveryEventId(existing.event_id) };
  broadcast(Events.matchmakingDrawsChanged, draw, scope);
  if (recorded) broadcast(Events.leaderboardChanged, null, scope);
  res.json(draw);
});

type OpenDrawRow = { teams: string; seat_pairs_considered: number; source: string | null };

// Re-reads a draw inside the caller's immediate transaction and refuses one
// whose lineup is frozen, so a check and its write can never be split by a
// parallel result, tournament or lineup edit.
function loadOpenDrawForEdit(drawId: string): OpenDrawRow {
  const row = db.prepare('SELECT teams, match_id, tournament_id, seat_pairs_considered, source FROM matchmaking_draws WHERE id = ?')
    .get(drawId) as (OpenDrawRow & { match_id: string | null; tournament_id: string | null }) | undefined;
  if (!row) throw new PointsError('Auslosung nicht gefunden.', 404);
  if (row.tournament_id) throw new PointsError('Aus dieser Auslosung wurde bereits ein Turnier erstellt.');
  if (row.match_id) throw new PointsError('Für diese Auslosung wurde bereits ein Ergebnis erfasst.');
  return row;
}

// POST /api/matchmaking/draws/:id/shuffle - "Neu mischen": redistributes the
// players of an open draw into the same number of teams, balanced with their
// current ratings (and seat neighbors, if the draw considered them; see
// reshuffleTeams). The draw keeps its id, creator, server details and betting
// link; the betting reconcile treats the new lineup like any other lineup
// edit. A lineup without any other split is refused (409) instead of being
// reported as reshuffled. Recorded and tournament-owned draws stay frozen.
matchmakingRouter.post('/draws/:id/shuffle', (req, res) => {
  const groupId = req.group!.id;
  const existing = db.prepare('SELECT id, event_id, game_id FROM matchmaking_draws WHERE id = ? AND group_id = ?')
    .get(req.params.id, groupId) as { id: string; event_id: string; game_id: string } | undefined;
  if (!existing) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (!requireGroupEventAccess(req, res, existing.event_id)) return;

  withBettingAccounting(existing.event_id, () => {
    const row = loadOpenDrawForEdit(existing.id);
    const teams = JSON.parse(row.teams) as DrawTeamSnapshot[];
    const players = teams.flatMap((team) => team.players);
    const ids = players.map((player) => player.id);
    const placeholders = ids.map(() => '?').join(',');
    const ratingByPlayer = new Map((db.prepare(`SELECT player_id, rating FROM skills WHERE game_id = ? AND player_id IN (${placeholders})`)
      .all(existing.game_id, ...ids) as Array<{ player_id: string; rating: number }>).map((r) => [r.player_id, r.rating]));
    const ratings: PlayerRating[] = ids.map((id) => ({ id, rating: ratingByPlayer.get(id) ?? DEFAULT_RATING }));
    const avoidPairs = row.seat_pairs_considered > 0 ? loadAvoidPairs(groupId, existing.event_id, ids) : [];

    const teamIdLists = reshuffleTeams(ratings, teams.map((team) => team.players.map((player) => player.id)), avoidPairs);
    if (!teamIdLists) throw new PointsError('Jedes Team hat nur einen Spieler, neu mischen ändert daran nichts.');

    const playerById = new Map(players.map((player) => [player.id, player]));
    const shuffled: DrawTeamSnapshot[] = teamIdLists.map((teamIds) => {
      const teamPlayers = teamIds.map((id) => {
        const { seatConflict: _conflict, seatConflictNames: _names, ...player } = playerById.get(id)!;
        return { ...player, rating: ratingByPlayer.get(id) ?? null };
      });
      return { players: teamPlayers, totalRating: totalRatingOf(teamPlayers) };
    });
    const seatConflicts = avoidPairs.length > 0 ? applySeatConflicts(groupId, existing.event_id, shuffled) : 0;
    // The new lineup is a rating-balanced draw, also when it started as a
    // Captain Draft or a rematch of fixed teams.
    db.prepare('UPDATE matchmaking_draws SET teams = ?, seat_conflicts = ?, source = NULL WHERE id = ?')
      .run(JSON.stringify(shuffled), seatConflicts, existing.id);
  });

  const draw = loadDrawView(existing.id);
  broadcast(Events.matchmakingDrawsChanged, draw, { groupId, eventId: deliveryEventId(existing.event_id) });
  res.json(draw);
});

// POST /api/matchmaking/draws/:id/players - adds an event participant who is
// not in the lineup yet to an open draw. Body: { playerId, teamIndex?, drawLineup? };
// without teamIndex the player joins the team with the fewest players, ties
// going to the lower skill total and then to the first such team. A chosen
// team is a position in the lineup the dialog showed, so the dialog sends that
// lineup along: a draw reshuffled or edited since answers 409
// draw_lineup_changed instead of placing the player into a different team. Check and
// write run in one immediate transaction, so of two parallel additions of the
// same player exactly one wins and the other sees the new state (409).
matchmakingRouter.post('/draws/:id/players', (req, res) => {
  const { playerId, teamIndex, drawLineup } = req.body ?? {};
  if (typeof playerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(playerId)) {
    return res.status(400).json({ error: 'playerId ist ungültig.' });
  }
  if (teamIndex !== undefined && teamIndex !== null && (!Number.isInteger(teamIndex) || teamIndex < 0)) {
    return res.status(400).json({ error: 'teamIndex ist ungültig.' });
  }
  if (drawLineup !== undefined && !isDrawLineup(drawLineup)) {
    return res.status(400).json({ error: 'drawLineup ist ungültig.' });
  }
  const groupId = req.group!.id;
  const existing = db.prepare('SELECT id, event_id, game_id FROM matchmaking_draws WHERE id = ? AND group_id = ?')
    .get(req.params.id, groupId) as { id: string; event_id: string; game_id: string } | undefined;
  if (!existing) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (!requireGroupEventAccess(req, res, existing.event_id)) return;
  if (!competitionPlayersBelongToGroup(groupId, existing.event_id, [playerId])) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  const player = db.prepare('SELECT id, name, color, avatar FROM players WHERE id = ? AND deactivated_at IS NULL')
    .get(playerId) as PlayerRow | undefined;
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  try {
    withBettingAccounting(existing.event_id, () => {
      const row = loadOpenDrawForEdit(existing.id);
      const teams = JSON.parse(row.teams) as DrawTeamSnapshot[];
      if (drawLineup) assertDrawLineup(existing.id, drawLineup as string[][], typeof teamIndex === 'number' ? teamIndex : undefined);
      if (teams.some((team) => team.players.some((p) => p.id === playerId))) {
        throw new PointsError(`${player.name} ist bereits in dieser Auslosung.`);
      }
      if (typeof teamIndex === 'number' && teamIndex >= teams.length) throw new PointsError('teamIndex ist ungültig.', 400);
      const skillTotal = (team: DrawTeamSnapshot) => totalRatingOf(team.players);
      const target = typeof teamIndex === 'number'
        ? teamIndex
        : teams.reduce((best, team, index) => {
          const current = teams[best];
          if (team.players.length !== current.players.length) return team.players.length < current.players.length ? index : best;
          return skillTotal(team) < skillTotal(current) ? index : best;
        }, 0);
      const rating = db.prepare('SELECT rating FROM skills WHERE game_id = ? AND player_id = ?')
        .pluck().get(existing.game_id, playerId) as number | undefined;
      const team = teams[target];
      team.players.push({ ...player, rating: rating ?? null });
      // Same rule as a move: older drafts without a snapshot keep no total.
      team.totalRating = row.source === 'draft' && !team.skillSnapshot ? 0 : totalRatingOf(team.players);
      const seatConflicts = row.seat_pairs_considered > 0 ? applySeatConflicts(groupId, existing.event_id, teams) : 0;
      db.prepare('UPDATE matchmaking_draws SET teams = ?, seat_conflicts = ? WHERE id = ?')
        .run(JSON.stringify(teams), seatConflicts, existing.id);
    });
  } catch (error) {
    if (error instanceof DrawLineupChangedError) {
      return res.status(409).json({ error: DRAW_LINEUP_CHANGED, code: DRAW_LINEUP_CHANGED_CODE });
    }
    throw error;
  }

  const draw = loadDrawView(existing.id);
  broadcast(Events.matchmakingDrawsChanged, draw, { groupId, eventId: deliveryEventId(existing.event_id) });
  res.json(draw);
});

// PATCH /api/matchmaking/draws/:id/server - note where an open Match is
// hosted. Body: { serverAddress: string | null, serverPassword: string | null };
// blank values clear the field. Like moving players it is only allowed while
// the draw has neither a result nor a tournament, so a recorded lineup stays
// frozen. Concurrent edits are last-write-wins: both fields are written in
// one statement whose WHERE clause re-checks that the draw is still open.
matchmakingRouter.patch('/draws/:id/server', (req, res) => {
  const serverAddress = normalizeServerField(req.body?.serverAddress, SERVER_ADDRESS_MAX_LENGTH);
  if (serverAddress === 'invalid') return res.status(400).json({ error: 'Server ist ungültig.' });
  if (serverAddress === 'too-long') {
    return res.status(400).json({ error: `Server darf höchstens ${SERVER_ADDRESS_MAX_LENGTH} Zeichen lang sein.` });
  }
  const serverPassword = normalizeServerField(req.body?.serverPassword, SERVER_PASSWORD_MAX_LENGTH);
  if (serverPassword === 'invalid') return res.status(400).json({ error: 'Passwort ist ungültig.' });
  if (serverPassword === 'too-long') {
    return res.status(400).json({ error: `Passwort darf höchstens ${SERVER_PASSWORD_MAX_LENGTH} Zeichen lang sein.` });
  }

  const row = db
    .prepare('SELECT id, event_id, match_id, tournament_id FROM matchmaking_draws WHERE id = ? AND group_id = ?')
    .get(req.params.id, req.group!.id) as
    | { id: string; event_id: string; match_id: string | null; tournament_id: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (!requireGroupEventAccess(req, res, row.event_id)) return;

  const updated = db
    .prepare(
      `UPDATE matchmaking_draws SET server_address = ?, server_password = ?
       WHERE id = ? AND match_id IS NULL AND tournament_id IS NULL`
    )
    .run(serverAddress.value, serverPassword.value, row.id);
  if (updated.changes === 0) {
    return res.status(409).json({
      error: row.tournament_id
        ? 'Aus dieser Auslosung wurde bereits ein Turnier erstellt.'
        : 'Für diese Auslosung wurde bereits ein Ergebnis erfasst.',
    });
  }

  const draw = loadDrawView(row.id);
  broadcast(Events.matchmakingDrawsChanged, draw, {
    groupId: req.group!.id,
    eventId: deliveryEventId(row.event_id),
  });
  res.json(draw);
});

const SERVER_ADDRESS_MAX_LENGTH = 100;
const SERVER_PASSWORD_MAX_LENGTH = 60;

// Optional free-text field: missing, null or blank clears it (null), a string
// within the limit is stored trimmed; a non-string is 'invalid' and an
// over-long string 'too-long', so each gets its own error message.
type ServerFieldResult = { value: string | null } | 'invalid' | 'too-long';
function normalizeServerField(value: unknown, maxLength: number): ServerFieldResult {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  return trimmed.length <= maxLength ? { value: trimmed } : 'too-long';
}
