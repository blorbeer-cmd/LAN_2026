// Tournaments (FR-33): pick a game, group present players into teams, and
// get either a single-elimination bracket ("Turnierbaum") or a round-robin
// league ("jeder gegen jeden", optionally home-and-away) generated
// automatically. Recording a match's result also creates a normal `matches`
// row, so playing in a tournament counts toward the regular leaderboard too.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getTrackingEventId } from '../events';
import { isNonEmptyString } from '../validation';
import { notifyPlayers } from '../push';
import {
  generateBracket,
  applyBracketResult,
  bracketIsComplete,
  generateRoundRobin,
  computeRoundRobinStandings,
  assignGroups,
  selectAdvancers,
  type BracketMatchSlot,
  type TournamentFormat,
} from '../tournament';

export const tournamentsRouter = Router();

const FORMATS: TournamentFormat[] = ['single_elimination', 'round_robin', 'group_knockout'];

interface TournamentRow {
  id: string;
  event_id: string;
  game_id: string;
  name: string;
  format: TournamentFormat;
  two_legged: number;
  track_score: number;
  group_count: number | null;
  advancers_per_group: number | null;
  status: string;
  created_at: number;
  lobby_name: string | null;
  lobby_password: string | null;
}

interface TournamentTeamRow {
  id: string;
  tournament_id: string;
  name: string;
  player_ids: string;
  group_index: number | null;
}

interface TournamentMatchRow {
  id: string;
  tournament_id: string;
  round: number;
  slot: number;
  stage: 'group' | 'knockout' | null;
  group_index: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  score_a: number | null;
  score_b: number | null;
  is_draw: number;
  is_bye: number;
  match_id: string | null;
  played_at: number | null;
}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

function toBracketSlot(row: TournamentMatchRow): BracketMatchSlot {
  return {
    round: row.round,
    slot: row.slot,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    winnerTeamId: row.winner_team_id,
    isBye: Boolean(row.is_bye),
  };
}

// Advances a single-elimination-shaped set of rows by one result and
// persists the next round's teams if this was the last piece needed to
// complete it. Shared by single_elimination (the whole tournament is one
// bracket) and group_knockout's knockout stage (bracketRows pre-filtered to
// stage='knockout') — both progress identically once the bracket exists.
function progressBracketRows(
  bracketRows: TournamentMatchRow[],
  round: number,
  slot: number,
  winnerTeamId: string
): { readyNextMatchId: string | null; completed: boolean } {
  const before = bracketRows.map(toBracketSlot);
  const after = applyBracketResult(before, round, slot, winnerTeamId);

  let readyNextMatchId: string | null = null;
  const next = after.find((m, i) => m.teamAId !== before[i].teamAId || m.teamBId !== before[i].teamBId);
  if (next) {
    const nextRow = bracketRows.find((r) => r.round === next.round && r.slot === next.slot)!;
    db.prepare('UPDATE tournament_matches SET team_a_id = ?, team_b_id = ? WHERE id = ?').run(
      next.teamAId,
      next.teamBId,
      nextRow.id
    );
    if (next.teamAId && next.teamBId) {
      readyNextMatchId = nextRow.id;
    }
  }

  return { readyNextMatchId, completed: bracketIsComplete(after) };
}

// Builds the full detail payload shared by create/list-one/record-result.
function buildDetail(tournamentId: string) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as
    | TournamentRow
    | undefined;
  if (!tournament) return undefined;

  const game = db.prepare('SELECT id, name, icon FROM games WHERE id = ?').get(tournament.game_id) as
    | { id: string; name: string; icon: string }
    | undefined;

  const teamRows = db
    .prepare('SELECT * FROM tournament_teams WHERE tournament_id = ?')
    .all(tournamentId) as TournamentTeamRow[];

  const allPlayerIds = [...new Set(teamRows.flatMap((t) => JSON.parse(t.player_ids) as string[]))];
  const playerById = new Map<string, PlayerRow>();
  if (allPlayerIds.length > 0) {
    const placeholders = allPlayerIds.map(() => '?').join(',');
    const players = db
      .prepare(`SELECT id, name, color, avatar FROM players WHERE id IN (${placeholders})`)
      .all(...allPlayerIds) as PlayerRow[];
    players.forEach((p) => playerById.set(p.id, p));
  }

  const teams = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    groupIndex: t.group_index,
    // Deleted players are silently dropped rather than breaking the roster
    // display — rare, and the team still functions with whoever's left.
    players: (JSON.parse(t.player_ids) as string[]).map((id) => playerById.get(id)).filter(Boolean),
  }));

  const matchRows = db
    .prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, slot')
    .all(tournamentId) as TournamentMatchRow[];
  const matches = matchRows.map((m) => ({
    id: m.id,
    round: m.round,
    slot: m.slot,
    stage: m.stage,
    groupIndex: m.group_index,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    winnerTeamId: m.winner_team_id,
    scoreA: m.score_a,
    scoreB: m.score_b,
    isDraw: Boolean(m.is_draw),
    isBye: Boolean(m.is_bye),
    matchId: m.match_id,
    playedAt: m.played_at,
  }));

  const decidedResultsOf = (rows: TournamentMatchRow[]) =>
    rows
      .filter((m) => m.winner_team_id !== null || m.is_draw)
      .map((m) => ({ teamAId: m.team_a_id!, teamBId: m.team_b_id!, winnerTeamId: m.winner_team_id }));

  let standings: ReturnType<typeof computeRoundRobinStandings> | undefined;
  if (tournament.format === 'round_robin') {
    standings = computeRoundRobinStandings(teamRows.map((t) => t.id), decidedResultsOf(matchRows));
  }

  let groups: Array<{ groupIndex: number; standings: ReturnType<typeof computeRoundRobinStandings> }> | undefined;
  if (tournament.format === 'group_knockout' && tournament.group_count) {
    groups = Array.from({ length: tournament.group_count }, (_, groupIndex) => {
      const groupTeamIds = teamRows.filter((t) => t.group_index === groupIndex).map((t) => t.id);
      const groupMatches = matchRows.filter((m) => m.stage === 'group' && m.group_index === groupIndex);
      return {
        groupIndex,
        standings: computeRoundRobinStandings(groupTeamIds, decidedResultsOf(groupMatches)),
      };
    });
  }

  return {
    id: tournament.id,
    eventId: tournament.event_id,
    gameId: tournament.game_id,
    gameName: game?.name ?? 'Unbekannt',
    gameIcon: game?.icon ?? '🎮',
    name: tournament.name,
    format: tournament.format,
    twoLegged: Boolean(tournament.two_legged),
    trackScore: Boolean(tournament.track_score),
    groupCount: tournament.group_count,
    advancersPerGroup: tournament.advancers_per_group,
    status: tournament.status,
    createdAt: tournament.created_at,
    lobbyName: tournament.lobby_name,
    lobbyPassword: tournament.lobby_password,
    teams,
    matches,
    ...(standings ? { standings } : {}),
    ...(groups ? { groups } : {}),
  };
}

// GET /api/tournaments - list for the active event (or an explicit
// ?eventId=), newest first. Lightweight: no teams/matches, just enough for
// a picker list (use GET /:id for the full board).
tournamentsRouter.get('/', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();

  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.format, t.two_legged AS twoLegged, t.status, t.created_at AS createdAt,
              t.game_id AS gameId, g.name AS gameName, g.icon AS gameIcon,
              (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS teamCount
       FROM tournaments t
       JOIN games g ON g.id = t.game_id
       WHERE t.event_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(filterEventId) as Array<Record<string, unknown>>;

  res.json(rows.map((r) => ({ ...r, twoLegged: Boolean(r.twoLegged) })));
});

// GET /api/tournaments/:id - full board: teams, bracket/fixtures, standings.
tournamentsRouter.get('/:id', (req, res) => {
  const detail = buildDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Turnier nicht gefunden.' });
  res.json(detail);
});

interface TeamInput {
  name?: string;
  playerIds: string[];
}

function validateTeamsInput(teams: unknown): TeamInput[] | { error: string } {
  if (!Array.isArray(teams) || teams.length < 2) {
    return { error: 'teams muss ein Array mit mindestens 2 Teams sein.' };
  }
  const seen = new Set<string>();
  const result: TeamInput[] = [];
  for (const raw of teams) {
    const t = raw as { name?: unknown; playerIds?: unknown };
    if (!Array.isArray(t.playerIds) || t.playerIds.length === 0 || !t.playerIds.every((p) => typeof p === 'string')) {
      return { error: 'Jedes Team braucht mindestens einen Spieler (playerIds).' };
    }
    if (t.name !== undefined && !isNonEmptyString(t.name, 60)) {
      return { error: 'Team-Name muss 1-60 Zeichen lang sein.' };
    }
    for (const id of t.playerIds as string[]) {
      if (seen.has(id)) return { error: 'Ein Spieler kann nicht in mehreren Teams gleichzeitig stehen.' };
      seen.add(id);
    }
    result.push({ name: t.name as string | undefined, playerIds: t.playerIds as string[] });
  }
  return result;
}

// POST /api/tournaments - create a tournament and generate its full
// starting schedule immediately (the knockout bracket of group_knockout is
// the one exception — it can't be generated until the group stage decides
// who advances, see the result-recording handler below).
// Body: { gameId, name?, format, twoLegged?, trackScore?, groupCount?,
//         advancersPerGroup?, lobbyName?, lobbyPassword?, teams: [{ name?, playerIds }] }
tournamentsRouter.post('/', (req, res) => {
  const { gameId, name, format, twoLegged, trackScore, groupCount, advancersPerGroup, lobbyName, lobbyPassword, teams } =
    req.body ?? {};

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  const game = db.prepare('SELECT id, name, icon FROM games WHERE id = ?').get(gameId) as
    | { id: string; name: string; icon: string }
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  if (typeof format !== 'string' || !FORMATS.includes(format as TournamentFormat)) {
    return res.status(400).json({ error: `format muss eines von ${FORMATS.join(', ')} sein.` });
  }
  if (twoLegged !== undefined && typeof twoLegged !== 'boolean') {
    return res.status(400).json({ error: 'twoLegged muss ein Boolean sein.' });
  }
  if (trackScore !== undefined && typeof trackScore !== 'boolean') {
    return res.status(400).json({ error: 'trackScore muss ein Boolean sein.' });
  }
  if (name !== undefined && !isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'name muss 1-80 Zeichen lang sein.' });
  }
  if (lobbyName !== undefined && lobbyName !== null && !isNonEmptyString(lobbyName, 60)) {
    return res.status(400).json({ error: 'lobbyName muss 1-60 Zeichen lang sein.' });
  }
  if (lobbyPassword !== undefined && lobbyPassword !== null && !isNonEmptyString(lobbyPassword, 60)) {
    return res.status(400).json({ error: 'lobbyPassword muss 1-60 Zeichen lang sein.' });
  }

  const teamsInput = validateTeamsInput(teams);
  if ('error' in teamsInput) return res.status(400).json({ error: teamsInput.error });

  const resolvedFormat = format as TournamentFormat;
  let resolvedGroupCount: number | null = null;
  let resolvedAdvancersPerGroup: number | null = null;
  if (resolvedFormat === 'group_knockout') {
    if (!Number.isInteger(groupCount) || groupCount < 2) {
      return res.status(400).json({ error: 'groupCount muss eine ganze Zahl ≥ 2 sein.' });
    }
    if (!Number.isInteger(advancersPerGroup) || advancersPerGroup < 1) {
      return res.status(400).json({ error: 'advancersPerGroup muss eine ganze Zahl ≥ 1 sein.' });
    }
    if (teamsInput.length < groupCount * 2) {
      return res.status(400).json({ error: 'Jede Gruppe braucht mindestens 2 Teams — dafür sind zu wenige Teams für die gewählte Gruppenzahl vorhanden.' });
    }
    const smallestGroupSize = Math.floor(teamsInput.length / groupCount);
    if (advancersPerGroup > smallestGroupSize) {
      return res.status(400).json({
        error: `advancersPerGroup darf höchstens ${smallestGroupSize} sein (Größe der kleinsten Gruppe bei ${groupCount} Gruppen).`,
      });
    }
    resolvedGroupCount = groupCount;
    resolvedAdvancersPerGroup = advancersPerGroup;
  }

  const allPlayerIds = teamsInput.flatMap((t) => t.playerIds);
  const placeholders = allPlayerIds.map(() => '?').join(',');
  const foundPlayers = db
    .prepare(`SELECT id FROM players WHERE id IN (${placeholders})`)
    .all(...allPlayerIds) as Array<{ id: string }>;
  if (foundPlayers.length !== new Set(allPlayerIds).size) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const tournamentId = nanoid();
  const resolvedTwoLegged = resolvedFormat !== 'single_elimination' && Boolean(twoLegged);
  const resolvedTrackScore = Boolean(trackScore);
  const now = Date.now();

  const teamIds = teamsInput.map(() => nanoid());
  const tournamentName = isNonEmptyString(name, 80) ? (name as string).trim() : `${game.name}-Turnier`;
  const resolvedLobbyName = isNonEmptyString(lobbyName, 60) ? (lobbyName as string).trim() : null;
  const resolvedLobbyPassword = isNonEmptyString(lobbyPassword, 60) ? (lobbyPassword as string).trim() : null;

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO tournaments
         (id, event_id, game_id, name, format, two_legged, track_score, group_count, advancers_per_group, status, created_at, lobby_name, lobby_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      tournamentId,
      getTrackingEventId(),
      gameId,
      tournamentName,
      resolvedFormat,
      resolvedTwoLegged ? 1 : 0,
      resolvedTrackScore ? 1 : 0,
      resolvedGroupCount,
      resolvedAdvancersPerGroup,
      now,
      resolvedLobbyName,
      resolvedLobbyPassword
    );

    // Team -> group assignment (group_knockout only) has to happen before
    // insert since group_index is stored per team.
    const groupIndexByTeamId = new Map<string, number>();
    if (resolvedFormat === 'group_knockout' && resolvedGroupCount) {
      assignGroups(teamIds, resolvedGroupCount).forEach((group, groupIndex) => {
        group.forEach((teamId) => groupIndexByTeamId.set(teamId, groupIndex));
      });
    }

    const insertTeam = db.prepare(
      'INSERT INTO tournament_teams (id, tournament_id, name, player_ids, group_index) VALUES (?, ?, ?, ?, ?)'
    );
    teamsInput.forEach((t, i) => {
      insertTeam.run(
        teamIds[i],
        tournamentId,
        t.name?.trim() || `Team ${i + 1}`,
        JSON.stringify(t.playerIds),
        groupIndexByTeamId.get(teamIds[i]) ?? null
      );
    });

    const insertMatch = db.prepare(
      `INSERT INTO tournament_matches
         (id, tournament_id, round, slot, stage, group_index, team_a_id, team_b_id, winner_team_id, is_draw, is_bye, match_id, played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)`
    );

    if (resolvedFormat === 'single_elimination') {
      const bracket = generateBracket(teamIds);
      for (const m of bracket) {
        insertMatch.run(
          nanoid(),
          tournamentId,
          m.round,
          m.slot,
          null,
          null,
          m.teamAId,
          m.teamBId,
          m.winnerTeamId,
          m.isBye ? 1 : 0
        );
      }
    } else if (resolvedFormat === 'round_robin') {
      const fixtures = generateRoundRobin(teamIds, resolvedTwoLegged);
      const slotByRound = new Map<number, number>();
      for (const f of fixtures) {
        const slot = slotByRound.get(f.round) ?? 0;
        slotByRound.set(f.round, slot + 1);
        insertMatch.run(nanoid(), tournamentId, f.round, slot, null, null, f.teamAId, f.teamBId, null, 0);
      }
    } else {
      // group_knockout: only the group stage is known up front; the
      // knockout bracket is generated once every group match is decided
      // (see the result-recording handler).
      for (let groupIndex = 0; groupIndex < resolvedGroupCount!; groupIndex++) {
        const groupTeamIds = teamIds.filter((id) => groupIndexByTeamId.get(id) === groupIndex);
        const fixtures = generateRoundRobin(groupTeamIds, resolvedTwoLegged);
        const slotByRound = new Map<number, number>();
        for (const f of fixtures) {
          const slot = slotByRound.get(f.round) ?? 0;
          slotByRound.set(f.round, slot + 1);
          insertMatch.run(nanoid(), tournamentId, f.round, slot, 'group', groupIndex, f.teamAId, f.teamBId, null, 0);
        }
      }
    }
  });
  create();

  // Every participant gets nudged that they've been entered into a new
  // tournament — otherwise the only way to notice is to happen to open the
  // Turniere tab.
  broadcast(Events.tournamentsChanged, {
    type: 'created',
    tournamentId,
    tournamentName,
    gameId,
    gameIcon: game.icon,
    notify: {
      playerIds: allPlayerIds,
      message: `🏆 Neues Turnier: ${tournamentName}`,
    },
  });
  notifyPlayers(allPlayerIds, { title: '🏆 Neues Turnier', body: tournamentName, url: '/#tournaments' });
  res.status(201).json(buildDetail(tournamentId));
});

// POST /api/tournaments/:id/matches/:matchId/result
// Body: { winnerTeamId: string | null }  (null = draw; not allowed for
// knockout-shaped matches), OR — if the tournament has trackScore set —
// { scoreA: number, scoreB: number } with the winner derived from the score.
tournamentsRouter.post('/:id/matches/:matchId/result', (req, res) => {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id) as
    | TournamentRow
    | undefined;
  if (!tournament) return res.status(404).json({ error: 'Turnier nicht gefunden.' });

  const match = db
    .prepare('SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?')
    .get(req.params.matchId, req.params.id) as TournamentMatchRow | undefined;
  if (!match) return res.status(404).json({ error: 'Match nicht gefunden.' });
  if (match.is_bye) return res.status(400).json({ error: 'Ein Freilos braucht kein Ergebnis.' });
  if (!match.team_a_id || !match.team_b_id) {
    return res.status(409).json({ error: 'Beide Teams müssen feststehen, bevor ein Ergebnis eingetragen werden kann.' });
  }
  // Two phones can both still show the match as open and report "almost at
  // the same time" — without this guard the second report would insert a
  // second leaderboard match (double-counted) and, on a conflicting winner,
  // re-run bracket progression and corrupt the next round's team slots.
  if (match.winner_team_id !== null || match.is_draw) {
    return res.status(409).json({ error: 'Für dieses Match ist schon ein Ergebnis eingetragen.' });
  }

  // Knockout-shaped matches — the whole bracket in single_elimination, or
  // just the knockout stage of group_knockout — never allow a draw.
  const isKnockoutLike = tournament.format === 'single_elimination' || match.stage === 'knockout';

  let winnerTeamId: string | null;
  let scoreA: number | null = null;
  let scoreB: number | null = null;

  if (tournament.track_score) {
    const body = (req.body ?? {}) as { scoreA?: unknown; scoreB?: unknown };
    if (
      !Number.isInteger(body.scoreA) ||
      (body.scoreA as number) < 0 ||
      !Number.isInteger(body.scoreB) ||
      (body.scoreB as number) < 0
    ) {
      return res.status(400).json({ error: 'scoreA und scoreB müssen ganze Zahlen ≥ 0 sein.' });
    }
    scoreA = body.scoreA as number;
    scoreB = body.scoreB as number;
    if (scoreA === scoreB) {
      if (isKnockoutLike) {
        return res
          .status(400)
          .json({ error: 'Bei einem K.O.-Match muss ein Sieger feststehen — kein Unentschieden möglich.' });
      }
      winnerTeamId = null;
    } else {
      winnerTeamId = scoreA > scoreB ? match.team_a_id : match.team_b_id;
    }
  } else {
    const bodyWinnerTeamId = (req.body ?? {}).winnerTeamId;
    if (bodyWinnerTeamId === null) {
      if (isKnockoutLike) {
        return res.status(400).json({ error: 'Ein K.O.-Match braucht einen eindeutigen Sieger (kein Unentschieden).' });
      }
      winnerTeamId = null;
    } else if (
      typeof bodyWinnerTeamId !== 'string' ||
      (bodyWinnerTeamId !== match.team_a_id && bodyWinnerTeamId !== match.team_b_id)
    ) {
      return res
        .status(400)
        .json({ error: 'winnerTeamId muss eines der beiden Teams in diesem Match sein (oder null für Unentschieden).' });
    } else {
      winnerTeamId = bodyWinnerTeamId;
    }
  }

  const teamA = db.prepare('SELECT player_ids FROM tournament_teams WHERE id = ?').get(match.team_a_id) as
    | { player_ids: string }
    | undefined;
  const teamB = db.prepare('SELECT player_ids FROM tournament_teams WHERE id = ?').get(match.team_b_id) as
    | { player_ids: string }
    | undefined;
  if (!teamA || !teamB) return res.status(404).json({ error: 'Team nicht gefunden.' });

  const now = Date.now();
  const winnerTeamIndex = winnerTeamId === null ? null : winnerTeamId === match.team_a_id ? 0 : 1;
  const leaderboardMatchId = nanoid();

  // Set inside the transaction below when this result causes some next
  // bracket match to have both its teams known for the first time (or,
  // for group_knockout, when it's the last group result and the knockout
  // bracket gets generated) — that's the moment those players deserve a
  // "your match is up" nudge.
  let readyNextMatchId: string | null = null;
  let knockoutJustGenerated = false;
  let advancingTeamIds: string[] | null = null;

  // Round-robin fixtures already know both opponents from the start, so
  // there's no "team becomes known" moment to hook into like the bracket
  // has. The equivalent nudge-worthy moment is the round itself wrapping up:
  // once every match in a round is decided, the next round's matches are
  // "up", so their teams get notified. Populated inside the transaction
  // below with the ids of any matches that just became ready this way.
  let readyRoundRobinMatchIds: string[] = [];

  const record = db.transaction(() => {
    db.prepare(
      'INSERT INTO matches (id, game_id, event_id, played_at, result) VALUES (?, ?, ?, ?, ?)'
    ).run(
      leaderboardMatchId,
      tournament.game_id,
      tournament.event_id,
      now,
      JSON.stringify({
        teams: [{ playerIds: JSON.parse(teamA.player_ids) }, { playerIds: JSON.parse(teamB.player_ids) }],
        winnerTeamIndex,
        ...(scoreA !== null ? { score: [scoreA, scoreB] } : {}),
      })
    );

    db.prepare(
      'UPDATE tournament_matches SET winner_team_id = ?, score_a = ?, score_b = ?, is_draw = ?, match_id = ?, played_at = ? WHERE id = ?'
    ).run(winnerTeamId, scoreA, scoreB, winnerTeamId === null ? 1 : 0, leaderboardMatchId, now, match.id);

    if (tournament.format === 'single_elimination' && winnerTeamId !== null) {
      const allRows = db
        .prepare('SELECT * FROM tournament_matches WHERE tournament_id = ?')
        .all(tournament.id) as TournamentMatchRow[];
      const result = progressBracketRows(allRows, match.round, match.slot, winnerTeamId);
      readyNextMatchId = result.readyNextMatchId;
      if (result.completed) {
        db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(tournament.id);
      }
    } else if (tournament.format === 'round_robin') {
      const remaining = db
        .prepare(
          `SELECT COUNT(*) AS n FROM tournament_matches
           WHERE tournament_id = ? AND is_bye = 0 AND winner_team_id IS NULL AND is_draw = 0`
        )
        .get(tournament.id) as { n: number };
      if (remaining.n === 0) {
        db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(tournament.id);
      }

      const roundRemaining = db
        .prepare(
          `SELECT COUNT(*) AS n FROM tournament_matches
           WHERE tournament_id = ? AND round = ? AND is_bye = 0 AND winner_team_id IS NULL AND is_draw = 0`
        )
        .get(tournament.id, match.round) as { n: number };
      if (roundRemaining.n === 0) {
        readyRoundRobinMatchIds = (
          db
            .prepare('SELECT id FROM tournament_matches WHERE tournament_id = ? AND round = ? ORDER BY slot')
            .all(tournament.id, match.round + 1) as Array<{ id: string }>
        ).map((r) => r.id);
      }
    } else if (tournament.format === 'group_knockout') {
      if (match.stage === 'knockout' && winnerTeamId !== null) {
        const bracketRows = db
          .prepare(`SELECT * FROM tournament_matches WHERE tournament_id = ? AND stage = 'knockout'`)
          .all(tournament.id) as TournamentMatchRow[];
        const result = progressBracketRows(bracketRows, match.round, match.slot, winnerTeamId);
        readyNextMatchId = result.readyNextMatchId;
        if (result.completed) {
          db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(tournament.id);
        }
      } else if (match.stage === 'group') {
        const remaining = db
          .prepare(
            `SELECT COUNT(*) AS n FROM tournament_matches
             WHERE tournament_id = ? AND stage = 'group' AND is_bye = 0 AND winner_team_id IS NULL AND is_draw = 0`
          )
          .get(tournament.id) as { n: number };
        const knockoutAlreadyExists =
          (
            db
              .prepare(`SELECT COUNT(*) AS n FROM tournament_matches WHERE tournament_id = ? AND stage = 'knockout'`)
              .get(tournament.id) as { n: number }
          ).n > 0;

        // The last group-stage result decides the whole roster: build
        // per-group standings, take the configured number of advancers per
        // group, seed them into a fresh knockout bracket.
        if (remaining.n === 0 && !knockoutAlreadyExists) {
          const teamRows = db
            .prepare('SELECT * FROM tournament_teams WHERE tournament_id = ?')
            .all(tournament.id) as TournamentTeamRow[];
          const groupMatchRows = db
            .prepare(`SELECT * FROM tournament_matches WHERE tournament_id = ? AND stage = 'group'`)
            .all(tournament.id) as TournamentMatchRow[];

          const standingsByGroup = Array.from({ length: tournament.group_count! }, (_, groupIndex) => {
            const groupTeamIds = teamRows.filter((t) => t.group_index === groupIndex).map((t) => t.id);
            const decided = groupMatchRows
              .filter((m) => m.group_index === groupIndex && (m.winner_team_id !== null || m.is_draw))
              .map((m) => ({ teamAId: m.team_a_id!, teamBId: m.team_b_id!, winnerTeamId: m.winner_team_id }));
            return computeRoundRobinStandings(groupTeamIds, decided);
          });

          advancingTeamIds = selectAdvancers(standingsByGroup, tournament.advancers_per_group!);
          const bracket = generateBracket(advancingTeamIds);
          const insertKoMatch = db.prepare(
            `INSERT INTO tournament_matches
               (id, tournament_id, round, slot, stage, group_index, team_a_id, team_b_id, winner_team_id, is_draw, is_bye, match_id, played_at)
             VALUES (?, ?, ?, ?, 'knockout', NULL, ?, ?, ?, 0, ?, NULL, NULL)`
          );
          for (const m of bracket) {
            insertKoMatch.run(nanoid(), tournament.id, m.round, m.slot, m.teamAId, m.teamBId, m.winnerTeamId, m.isBye ? 1 : 0);
          }
          knockoutJustGenerated = true;

          // A tiny bracket can end up fully bye-resolved (e.g. exactly 3
          // advancers -> one bye sits straight in the final) but the final
          // itself always still needs a real result — bracketIsComplete
          // correctly only looks at the final, so this stays safe.
          if (bracketIsComplete(bracket)) {
            db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(tournament.id);
          }
        }
      }
    }
  });
  record();

  // Looks up a match's two teams and, if both are known, sends the "your
  // match is up" push + returns the notify payload for the socket broadcast.
  function buildMatchReadyNotify(matchId: string): { playerIds: string[]; message: string } | undefined {
    const nextMatch = db.prepare('SELECT team_a_id, team_b_id FROM tournament_matches WHERE id = ?').get(matchId) as
      | { team_a_id: string; team_b_id: string }
      | undefined;
    if (!nextMatch || !nextMatch.team_a_id || !nextMatch.team_b_id) return undefined;
    const nextTeams = db
      .prepare(`SELECT id, name, player_ids FROM tournament_teams WHERE id IN (?, ?)`)
      .all(nextMatch.team_a_id, nextMatch.team_b_id) as Array<{ id: string; name: string; player_ids: string }>;
    const nextTeamA = nextTeams.find((t) => t.id === nextMatch.team_a_id);
    const nextTeamB = nextTeams.find((t) => t.id === nextMatch.team_b_id);
    if (!nextTeamA || !nextTeamB) return undefined;
    // team_a_id is always the upper team in the bracket tree (see
    // propagateWinner in tournament.ts — the winner of the even-numbered
    // feeder slot becomes team A), so it's the natural default for "who
    // hosts" — no separate data field needed for this yet.
    const lobbyBits = [
      tournament!.lobby_name ? `Lobby "${tournament!.lobby_name}"` : null,
      tournament!.lobby_password ? `PW: ${tournament!.lobby_password}` : null,
    ].filter(Boolean);
    const lobbyText = lobbyBits.length > 0 ? ` (${lobbyBits.join(', ')})` : '';
    const matchNotify = {
      playerIds: [...JSON.parse(nextTeamA.player_ids), ...JSON.parse(nextTeamB.player_ids)],
      message: `⚔️ Dein nächstes Match steht an: ${nextTeamA.name} vs ${nextTeamB.name} — ${nextTeamA.name} eröffnet die Lobby${lobbyText}`,
    };
    notifyPlayers(
      matchNotify.playerIds,
      { title: '⚔️ Dein Match ist bereit', body: matchNotify.message, url: '/#tournaments' },
      'direct'
    );
    return matchNotify;
  }

  // Group stage wrapping up (group_knockout) notifies everyone who advanced
  // that the knockout bracket is ready — a different shape from
  // buildMatchReadyNotify since it's about the whole next stage, not a
  // single upcoming match.
  function buildKnockoutStageNotify(teamIds: string[]): { playerIds: string[]; message: string } {
    const placeholders = teamIds.map(() => '?').join(',');
    const advancingTeams = db
      .prepare(`SELECT player_ids FROM tournament_teams WHERE id IN (${placeholders})`)
      .all(...teamIds) as Array<{ player_ids: string }>;
    const playerIds = [...new Set(advancingTeams.flatMap((t) => JSON.parse(t.player_ids) as string[]))];
    const knockoutNotify = {
      playerIds,
      message: `🏆 Gruppenphase von ${tournament!.name} beendet – die K.O.-Runde steht!`,
    };
    notifyPlayers(playerIds, { title: '🏆 K.O.-Runde steht', body: knockoutNotify.message, url: '/#tournaments' }, 'direct');
    return knockoutNotify;
  }

  const notify =
    knockoutJustGenerated && advancingTeamIds
      ? buildKnockoutStageNotify(advancingTeamIds)
      : readyNextMatchId
        ? buildMatchReadyNotify(readyNextMatchId)
        : undefined;

  // A round wrapping up can ready several next-round matches at once (round-
  // robin isn't gated to one match at a time like the bracket is), so each
  // gets its own broadcast/toast rather than trying to cram them into the
  // single `notify` slot the response below uses.
  for (const matchId of readyRoundRobinMatchIds) {
    const roundNotify = buildMatchReadyNotify(matchId);
    if (!roundNotify) continue;
    broadcast(Events.tournamentsChanged, {
      type: 'match_ready',
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      gameId: tournament.game_id,
      notify: roundNotify,
    });
  }

  broadcast(Events.tournamentsChanged, {
    type: notify ? (knockoutJustGenerated ? 'knockout_stage_started' : 'match_ready') : 'updated',
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    gameId: tournament.game_id,
    ...(notify ? { notify } : {}),
  });
  broadcast(Events.leaderboardChanged, null);
  res.json(buildDetail(tournament.id));
});

// DELETE /api/tournaments/:id - removes the tournament and its teams/
// matches (cascade); the `matches` rows already created for the leaderboard
// are left untouched (match_id just goes stale, which is fine — they're
// independent leaderboard history at that point).
tournamentsRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM tournaments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Turnier nicht gefunden.' });
  broadcast(Events.tournamentsChanged, { type: 'deleted', tournamentId: req.params.id });
  res.status(204).end();
});
