// Matchmaking endpoint (FR-16..18): draws balanced teams for a game from a
// set of present players, using their skill ratings. Stateless — every call
// is a fresh draw, so "re-roll" is just calling it again. The result is
// broadcast to everyone so the whole LAN sees the same teams, not just
// whoever clicked the button.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import {
  balanceTeams,
  computeTeamCount,
  countSeatConflicts,
  seatConflictNeighbors,
  type PlayerRating,
  type SeatPair,
} from '../matchmaking';
import { isIntInRange } from '../validation';
import { getTrackingEventId, OUTSIDE_EVENTS_ID } from '../events';
import { competitionPlayersBelongToGroup, trackingEventIdForGroup } from '../competitionScope';

export const matchmakingRouter = Router();

const DEFAULT_RATING = 5; // neutral middle rating for players without one

interface GameRow {
  id: string;
  name: string;
  max_team_size: number;
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
// submitted (see the comment on that call site).
export function buildTeamsSnapshot(gameId: string, teamPlayerIdLists: string[][]) {
  const allIds = [...new Set(teamPlayerIdLists.flat())];
  const playerById = new Map<string, PlayerRow>();
  const ratingByPlayer = new Map<string, number>();
  if (allIds.length > 0) {
    const placeholders = allIds.map(() => '?').join(',');
    const players = db
      .prepare(`SELECT id, name, color, avatar FROM players WHERE id IN (${placeholders})`)
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
        rating: ratingByPlayer.get(id) ?? DEFAULT_RATING,
      };
    });
    return { players: teamPlayers, totalRating: teamPlayers.reduce((sum, p) => sum + p.rating, 0) };
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
    .all(groupId, eventId === OUTSIDE_EVENTS_ID ? null : eventId, ...playerIds, ...playerIds) as Array<{
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
//         avoidAdjacentOpponents?: boolean }
// avoidAdjacentOpponents is a per-draw choice, not a game setting — whether
// it's worth keeping seat-neighbors off opposing teams depends on how
// competitive/serious that particular round is, not the game itself.
matchmakingRouter.post('/', (req, res) => {
  const { gameId, playerIds, teamCount, avoidAdjacentOpponents } = req.body ?? {};

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

  const game = db.prepare('SELECT id, name, max_team_size FROM games WHERE id = ? AND group_id = ?').get(gameId, req.group!.id) as
    | GameRow
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const eventId = trackingEventIdForGroup(req.group!.id);
  if (!eventId) {
    return res.status(409).json({ error: 'Tracking läuft derzeit in einem anderen Gruppenkontext.' });
  }
  if (!competitionPlayersBelongToGroup(req.group!.id, eventId, uniqueIds)) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(`SELECT id, name, color, avatar FROM players WHERE id IN (${placeholders})`)
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
  const teamIdLists = balanceTeams(ratings, resolvedTeamCount, avoidPairs);
  const seatConflicts = countSeatConflicts(teamIdLists, avoidPairs);
  const conflictNeighbors = seatConflictNeighbors(teamIdLists, avoidPairs);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const teams = teamIdLists.map((ids) => {
    const teamPlayers = ids.map((id) => {
      const neighborIds = conflictNeighbors.get(id);
      return {
        ...playerById.get(id)!,
        rating: ratingByPlayer.get(id) ?? DEFAULT_RATING,
        seatConflict: !!neighborIds,
        seatConflictNames: neighborIds?.map((nid) => playerById.get(nid)?.name).filter((n): n is string => !!n) ?? [],
      };
    });
    return {
      players: teamPlayers,
      totalRating: teamPlayers.reduce((sum, p) => sum + p.rating, 0),
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
  };

  // Logged for the history view (every draw, including re-rolls — see the
  // matchmaking_draws comment in db.ts for why this is separate from the
  // actually-recorded `matches`).
  db.prepare(
    `INSERT INTO matchmaking_draws (id, game_id, event_id, group_id, teams, seat_conflicts, seat_pairs_considered, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(drawId, gameId, eventId, req.group!.id, JSON.stringify(teams), seatConflicts, avoidPairs.length, result.generatedAt);

  broadcast(Events.matchmakingGenerated, result, { groupId: req.group!.id });
  res.json(result);
});

// POST /api/matchmaking/rematch - re-run the *same* team lineup (no
// rebalancing) as a fresh draw, so entering a result for it lands in
// Ergebnis-Historie like any other draw instead of only in the leaderboard.
// Body: { gameId: string, teams: [{ playerIds: string[] }] } (same shape the
// frontend already has lying around from the draw it's rematching).
matchmakingRouter.post('/rematch', (req, res) => {
  const { gameId, teams: teamsInput } = req.body ?? {};

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

  const game = db.prepare('SELECT id, name, max_team_size FROM games WHERE id = ? AND group_id = ?').get(gameId, req.group!.id) as
    | GameRow
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const eventId = trackingEventIdForGroup(req.group!.id);
  if (!eventId) {
    return res.status(409).json({ error: 'Tracking läuft derzeit in einem anderen Gruppenkontext.' });
  }
  if (!competitionPlayersBelongToGroup(req.group!.id, eventId, uniqueIds)) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(`SELECT id, name, color, avatar FROM players WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as PlayerRow[];
  if (players.length !== uniqueIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const teams = buildTeamsSnapshot(gameId, teamPlayerIdLists);

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
  };

  db.prepare(
    `INSERT INTO matchmaking_draws (id, game_id, event_id, group_id, teams, seat_conflicts, seat_pairs_considered, generated_at, source)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'rematch')`
  ).run(drawId, gameId, eventId, req.group!.id, JSON.stringify(teams), result.generatedAt);

  broadcast(Events.matchmakingGenerated, result, { groupId: req.group!.id });
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
}

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
    matchRows.map((m) => [m.id, JSON.parse(m.result) as { teams: Array<{ score?: number | null; rank?: number | null }>; winnerTeamIndex: number | null }])
  );

  for (const draw of draws) {
    if (!draw.matchId) continue;
    const matchResult = resultById.get(draw.matchId);
    if (!matchResult || matchResult.teams.length !== draw.teams.length) continue;
    draw.teams.forEach((t: { score?: number | null; rank?: number | null }, i: number) => {
      t.score = matchResult.teams[i].score ?? null;
      t.rank = matchResult.teams[i].rank ?? null;
    });
    (draw as { winnerTeamIndex?: number | null }).winnerTeamIndex = matchResult.winnerTeamIndex ?? null;
  }
}

// GET /api/matchmaking/history - past draws for the active event (or an
// explicit ?eventId=), newest first, optionally narrowed to one ?gameId=.
// Includes both still-unrecorded draws (Team-Historie) and draws a result was
// already entered for (Ergebnis-Historie, matchId set) — the frontend splits
// them by matchId.
matchmakingRouter.get('/history', (req, res) => {
  const { eventId, gameId, limit } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();
  const limitNum = Math.min(50, Math.max(1, parseInt(typeof limit === 'string' ? limit : '', 10) || 20));

  const clauses = ['md.group_id = ?', 'md.event_id = ?'];
  const params: Array<string | number> = [req.group!.id, filterEventId];
  if (typeof gameId === 'string' && gameId) {
    clauses.push('md.game_id = ?');
    params.push(gameId);
  }

  const rows = db
    .prepare(
      `SELECT md.id AS id, md.game_id AS gameId, g.name AS gameName, g.icon AS gameIcon,
              md.teams AS teamsJson, md.seat_conflicts AS seatConflicts,
              md.seat_pairs_considered AS seatPairsConsidered, md.generated_at AS generatedAt,
              md.match_id AS matchId, md.source AS source
       FROM matchmaking_draws md
       JOIN games g ON g.id = md.game_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY md.generated_at DESC
       LIMIT ?`
    )
    .all(...params, limitNum) as DrawRow[];

  const draws = rows.map(parseDrawRow);
  attachMatchResults(draws);
  res.json({ history: draws });
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
    | { id: string; game_id: string; event_id: string; teams: string; match_id: string | null; seat_pairs_considered: number }
    | undefined;
  if (!row) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
  if (row.match_id) {
    return res.status(409).json({ error: 'Für diese Auslosung wurde bereits ein Ergebnis erfasst.' });
  }

  const teams = JSON.parse(row.teams) as Array<{
    players: Array<{ id: string; name: string; rating: number | null; seatConflict?: boolean; seatConflictNames?: string[] }>;
    totalRating: number;
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
    for (const t of [teams[fromTeamIndex], teams[toTeamIndex]]) {
      t.totalRating = t.players.reduce((sum, p) => sum + (p.rating ?? 0), 0);
    }
  }

  // The move can turn a resolved seat-neighbor pair into a conflict (or fix
  // one) — only re-derive it when this draw actually considered seat
  // neighbors in the first place (avoidAdjacentOpponents was on for it).
  const seatConflicts = row.seat_pairs_considered > 0 ? applySeatConflicts(req.group!.id, row.event_id, teams) : 0;

  db.prepare('UPDATE matchmaking_draws SET teams = ?, seat_conflicts = ? WHERE id = ?').run(
    JSON.stringify(teams),
    seatConflicts,
    row.id
  );

  const updated = db
    .prepare(
      `SELECT md.id AS id, md.game_id AS gameId, g.name AS gameName, g.icon AS gameIcon,
              md.teams AS teamsJson, md.seat_conflicts AS seatConflicts,
              md.seat_pairs_considered AS seatPairsConsidered, md.generated_at AS generatedAt,
              md.match_id AS matchId, md.source AS source
       FROM matchmaking_draws md JOIN games g ON g.id = md.game_id WHERE md.id = ?`
    )
    .get(row.id) as DrawRow;

  const draw = parseDrawRow(updated);
  broadcast(Events.matchmakingDrawsChanged, draw, { groupId: req.group!.id });
  res.json(draw);
});
