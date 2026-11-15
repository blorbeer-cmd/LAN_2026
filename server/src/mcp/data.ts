import { z } from 'zod/v3';
import { db } from '../db';
import { getEnabledEventFeatures } from '../eventFeatures';
import { getLiveBoard } from '../liveStatus';
import { aggregateByGame, computePlaytime, type PlaySession } from '../playtime';
import { clipSessionsToRange } from '../sessionStats';
import { balanceTeams, computeTeamCount, type SeatPair } from '../matchmaking';
import { buildExportSnapshot } from '../routes/export';
import { computeFeatureUsage } from '../featureUsage';
import { getEvent } from '../events';
import { canManageDatePoll, getDatePolls, getDatePollInvitees, getDatePollResponses, hasAnsweredDatePoll } from '../eventDatePolls';
import { matchResultContainsPlayerIds, testPlayerIds } from '../testDataVisibility';
import { IntegrationError, requireFeature, requireIntegrationAdmin, type Principal } from './access';
import { isEventFeatureEnabled } from '../eventFeatures';
import { pointsAreVisible, pointsSettings } from '../points';

const id = z.string().regex(/^[\w-]{1,64}$/);
export const statisticsSchema = z.object({
  metric: z.enum(['playtime_by_game', 'players_by_game', 'team_formations', 'draws_without_result',
    'recorded_matches', 'tournament_counts', 'poll_usage', 'poll_participation', 'feature_usage']),
  gameId: id.optional(), from: z.number().int().nonnegative().safe().optional(),
  to: z.number().int().nonnegative().safe().optional(),
  topN: z.number().int().min(1).max(50).default(20),
  olderThanHours: z.number().int().min(1).max(876_000).optional(),
}).strict();
export type StatisticsInput = z.infer<typeof statisticsSchema>;

export function context(principal: Principal) {
  const roster = db.prepare(`SELECT p.id,p.name FROM players p JOIN event_participants ep ON ep.player_id=p.id
    JOIN group_memberships gm ON gm.player_id=p.id AND gm.group_id=? AND gm.status='active'
    WHERE ep.event_id=? AND ep.status='accepted' AND p.deactivated_at IS NULL AND p.is_test=0 ORDER BY p.name`)
    .all(principal.groupId, principal.eventId);
  return { player: { id: principal.playerId, name: principal.playerName },
    communityId: principal.groupId, event: { id: principal.eventId, name: principal.eventName, ended: principal.ended },
    features: getEnabledEventFeatures(principal.eventId), role: principal.role, roster };
}

export function overview(principal: Principal) {
  requireFeature(principal, 'tracking');
  const hidden = testPlayerIds();
  return getLiveBoard(principal.groupId, principal.eventId)
    .filter((entry) => !hidden.has(entry.player_id))
    .map((entry) => ({ playerId: entry.player_id, name: entry.name, state: entry.state, lastSeen: entry.last_seen,
      games: entry.games.map((game) => ({ id: game.game_id, name: game.game_name, since: game.since })),
      availability: 'Unbekannt; Live-Status ist keine Teilnahmezusage.' }));
}

export const gameOptionsSchema = z.object({ playerCount: z.number().int().min(1).max(100).optional(),
  playerIds: z.array(id).min(1).max(100).optional() }).strict();

export function gameOptions(principal: Principal, input: z.infer<typeof gameOptionsSchema>) {
  requireFeature(principal, 'games');
  if (input.playerIds) checkRoster(principal, input.playerIds);
  if (input.playerIds && input.playerCount !== undefined && input.playerCount !== input.playerIds.length) {
    throw new IntegrationError('Teilnehmerzahl stimmt nicht mit der ausgewählten Gruppe überein.');
  }
  const selected = input.playerIds ? JSON.stringify(input.playerIds) : null;
  const games = db.prepare(`SELECT g.id,g.name,g.genre,g.min_team_size AS minTeamSize,g.max_team_size AS maxTeamSize,
      (SELECT AVG(s.rating) FROM skills s JOIN players p ON p.id=s.player_id AND p.is_test=0
        AND p.deactivated_at IS NULL WHERE s.game_id=g.id AND s.group_id=?
          AND (? IS NULL OR s.player_id IN (SELECT value FROM json_each(?)))) AS averageSkill
    FROM games g WHERE g.group_id=? AND g.status='catalog' ORDER BY g.name LIMIT 151`)
    .all(principal.groupId, selected, selected, principal.groupId).map((row) => ({ ...(row as object),
      suitability: 'Teamgröße ist keine maximale Gesamtspielerzahl; Installation und Verfügbarkeit sind unbekannt.' }));
  return { games: games.slice(0, 150), hasMore: games.length > 150,
    requestedPlayerCount: input.playerCount ?? input.playerIds?.length ?? null,
    skillScope: input.playerIds ? 'Ausgewählte Teilnehmer' : 'Aktive bewertende Community-Mitglieder' };
}

function checkRoster(principal: Principal, ids: string[]) {
  const allowed = new Set((context(principal).roster as Array<{ id: string }>).map((player) => player.id));
  if (new Set(ids).size !== ids.length || ids.some((playerId) => !allowed.has(playerId))) {
    throw new IntegrationError('Teilnehmer müssen eindeutig sein und zum zugänglichen Event gehören.');
  }
}

export const teamPreviewSchema = z.object({ gameId: id, playerIds: z.array(id).min(2).max(100),
  teamCount: z.number().int().min(2).max(20).optional(), avoidAdjacentOpponents: z.boolean().default(false) }).strict();

export function previewTeams(principal: Principal, input: z.infer<typeof teamPreviewSchema>) {
  requireFeature(principal, 'competition');
  checkRoster(principal, input.playerIds);
  const game = db.prepare("SELECT id,name,max_team_size FROM games WHERE id=? AND group_id=? AND status='catalog'")
    .get(input.gameId, principal.groupId) as { id: string; name: string; max_team_size: number } | undefined;
  if (!game) throw new IntegrationError('Spiel nicht gefunden.', 404);
  const count = computeTeamCount(input.teamCount, input.playerIds.length, game.max_team_size);
  if (count > input.playerIds.length || Math.ceil(input.playerIds.length / count) > game.max_team_size) {
    throw new IntegrationError('Teamanzahl passt nicht zu Teilnehmern und maximaler Teamgröße.');
  }
  const players = input.playerIds.map((playerId) => {
    const row = db.prepare(`SELECT p.id,p.name,s.rating FROM players p LEFT JOIN skills s
      ON s.player_id=p.id AND s.game_id=? AND s.group_id=? WHERE p.id=?`)
      .get(input.gameId, principal.groupId, playerId) as { id: string; name: string; rating: number | null };
    return row;
  });
  const seatPairs = input.avoidAdjacentOpponents ? (db.prepare(`SELECT player_id,neighbor_id FROM seat_neighbors
    WHERE group_id=? AND event_id=?`).all(principal.groupId, principal.eventId) as Array<{ player_id: string; neighbor_id: string }>)
    .map((pair): SeatPair => [pair.player_id, pair.neighbor_id]) : [];
  const teams = balanceTeams(players.map((player) => ({ id: player.id, rating: player.rating ?? 3 })), count, seatPairs);
  return { game: { id: game.id, name: game.name }, previewOnly: true,
    teams: teams.map((team) => ({ players: team.map((playerId) => players.find((p) => p.id === playerId)),
      totalRating: team.reduce((sum, playerId) => sum + (players.find((p) => p.id === playerId)!.rating ?? 3), 0) })), missingRatingDefault: 3 };
}

export function competitions(principal: Principal) {
  requireFeature(principal, 'competition');
  const tournaments = db.prepare(`SELECT id,name,game_id AS gameId,format,status FROM tournaments
    WHERE group_id=? AND event_id=? ORDER BY created_at DESC LIMIT 100`).all(principal.groupId, principal.eventId);
  // Deliberately no hidden scores, ballots, point distributions or rankings.
  const votes = db.prepare(`SELECT round,title,mode,started_at AS startedAt,closed_at AS closedAt,
      CASE WHEN closed_at IS NOT NULL OR hide_live_results=0 THEN winner_game_ids ELSE NULL END AS winners
    FROM vote_rounds WHERE group_id=? AND event_id=? ORDER BY round DESC LIMIT 100`).all(principal.groupId, principal.eventId);
  return { tournaments, votes };
}

function pollStatistics(principal: Principal, input: StatisticsInput) {
  const event = getEvent(principal.eventId)!;
  const allowed = new Set((db.prepare('SELECT id FROM players WHERE is_test=0 AND deactivated_at IS NULL').all() as Array<{ id: string }>).map((p) => p.id));
  const current = new Set((context(principal).roster as Array<{ id: string }>).map((p) => p.id));
  const unique = new Set<string>();
  const perPoll: Array<Record<string, unknown>> = [];
  let hidden = 0;
  const inRange = (time: number) => (input.from === undefined || time >= input.from) && (input.to === undefined || time < input.to);
  for (const poll of getDatePolls(principal.eventId).filter((p) => inRange(p.created_at))) {
    const visible = poll.status !== 'open' || !poll.live_results_hidden || canManageDatePoll(poll, event, principal.playerId, principal.role);
    const invitees = getDatePollInvitees(poll.id).filter((invitee) => allowed.has(invitee.player_id) && (poll.status !== 'open' || current.has(invitee.player_id)));
    const ids = new Set(getDatePollResponses(poll.id).filter((response) => allowed.has(response.player_id) &&
      (poll.status !== 'open' || current.has(response.player_id))).map((response) => response.player_id));
    const complete = [...ids].filter((playerId) => hasAnsweredDatePoll(poll.id, playerId)).length;
    if (visible) ids.forEach((playerId) => unique.add(playerId)); else hidden++;
    perPoll.push({ id: poll.id, type: 'event_poll', title: poll.title, topic: poll.topic, mode: poll.response_mode,
      status: poll.status, createdAt: poll.created_at, respondents: visible ? ids.size : null,
      completeRespondents: visible ? complete : null, recordedInvitees: invitees.length,
      // No historic denominator snapshot: do not claim current invitees are
      // the population at the time of a past ballot.
      participationRate: null, rateUnavailableReason: 'Kein unveränderlicher historischer Teilnehmerkreis gespeichert.', resultsVisible: visible });
  }
  const voteRows = db.prepare(`SELECT round,title,mode,started_at,closed_at FROM vote_rounds
    WHERE group_id=? AND event_id=? ORDER BY round`).all(principal.groupId, principal.eventId) as
    Array<{ round: number; title: string | null; mode: string; started_at: number; closed_at: number | null }>;
  for (const round of voteRows.filter((r) => inRange(r.started_at))) {
    const respondents = db.prepare(`SELECT DISTINCT v.player_id FROM votes v JOIN players p ON p.id=v.player_id
      WHERE v.group_id=? AND v.event_id=? AND v.round=? AND p.is_test=0 AND p.deactivated_at IS NULL`)
      .all(principal.groupId, principal.eventId, round.round) as Array<{ player_id: string }>;
    respondents.forEach((p) => unique.add(p.player_id));
    perPoll.push({ id: `vote:${round.round}`, type: 'game_vote', title: round.title, mode: round.mode,
      status: round.closed_at === null ? 'open' : 'closed', createdAt: round.started_at,
      respondents: respondents.length, completeRespondents: respondents.length, participationRate: null,
      rateUnavailableReason: 'Kein historischer Teilnehmerkreis gespeichert.', resultsVisible: true });
  }
  const visible = perPoll.filter((poll) => poll.respondents !== null);
  const participations = visible.reduce((sum, poll) => sum + Number(poll.respondents), 0);
  const ordered = perPoll.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  return { totalPolls: perPoll.length, byType: { eventPolls: perPoll.filter((p) => p.type === 'event_poll').length,
    gameVotes: perPoll.filter((p) => p.type === 'game_vote').length },
    distinctRespondents: hidden ? null : unique.size, visibleDistinctRespondents: unique.size,
    responseParticipations: hidden ? null : participations, visibleResponseParticipations: participations,
    averageRespondents: hidden ? null : (perPoll.length ? participations / perPoll.length : 0),
    pollsWithoutResponses: hidden ? null : perPoll.filter((p) => p.respondents === 0).length,
    hiddenParticipationPolls: hidden, rows: ordered.slice(0, input.topN), totalRows: ordered.length };
}

export function statistics(principal: Principal, input: StatisticsInput) {
  if (input.from !== undefined && input.to !== undefined && input.from >= input.to) throw new IntegrationError('from muss vor to liegen.');
  const metric = input.metric;
  const pollMetric = metric === 'poll_usage' || metric === 'poll_participation';
  if ((pollMetric || metric === 'feature_usage') && input.gameId) throw new IntegrationError('Diese Kennzahl unterstützt keinen Spielfilter.');
  if (input.olderThanHours !== undefined && metric !== 'draws_without_result' && metric !== 'team_formations') {
    throw new IntegrationError('Altersfilter ist nur für Auslosungen verfügbar.');
  }
  if (input.gameId && !db.prepare('SELECT 1 FROM games WHERE id=? AND group_id=?').get(input.gameId, principal.groupId)) {
    throw new IntegrationError('Spiel nicht gefunden.', 404);
  }
  const now = Date.now();
  const envelope = { metric, eventId: principal.eventId, eventName: principal.eventName, asOf: now,
    filters: input, coverage: 'Zugängliche, vorhandene Daten; gelöschte Einträge und fehlendes Tracking sind nicht rekonstruierbar.' };
  if (pollMetric) return { ...envelope, unit: 'Personen und Umfragen', ...pollStatistics(principal, input) };
  if (metric === 'feature_usage') {
    requireIntegrationAdmin(principal);
    if (input.from !== undefined || input.to !== undefined) throw new IntegrationError('Nutzungsauswertung unterstützt nur den Eventfilter.');
    // Exclude group-wide entries: one event grant must not leak global data.
    const report = computeFeatureUsage(principal.groupId, principal.eventId);
    return { ...envelope, unit: 'Dokumentierte Vorgänge und eindeutige Personen',
      rows: report.entries.filter((entry) => entry.eventScoped) };
  }
  if (metric === 'playtime_by_game' || metric === 'players_by_game') {
    requireFeature(principal, 'tracking');
    const sessions = db.prepare(`SELECT s.player_id AS playerId,s.game_id AS gameId,s.started_at AS startedAt,
        s.ended_at AS endedAt,s.active_ms AS activeMs FROM play_sessions s JOIN players p ON p.id=s.player_id
      WHERE s.group_id=? AND s.event_id=? AND p.is_test=0 AND p.deactivated_at IS NULL AND (? IS NULL OR s.game_id=?)
        AND (? IS NULL OR COALESCE(s.ended_at,?)>?) AND (? IS NULL OR s.started_at<?) LIMIT 50001`)
      .all(principal.groupId, principal.eventId, input.gameId ?? null, input.gameId ?? null,
        input.from ?? null, now, input.from ?? null, input.to ?? null, input.to ?? null) as PlaySession[];
    if (sessions.length > 50_000) throw new IntegrationError('Zu viele Sessions. Bitte die Auswahl eingrenzen.');
    const clipped = clipSessionsToRange(sessions, now, input.from, input.to);
    const rows = aggregateByGame(computePlaytime(clipped, now)).map((game) => ({ gameId: game.gameId,
      gameName: (db.prepare('SELECT name FROM games WHERE id=?').get(game.gameId) as { name: string }).name,
      playerHours: game.totalMs / 3_600_000,
      players: new Set(clipped.filter((s) => s.gameId === game.gameId).map((s) => s.playerId)).size,
      sessions: clipped.filter((s) => s.gameId === game.gameId).length }));
    rows.sort((a, b) => metric === 'players_by_game' ? b.players - a.players : b.playerHours - a.playerHours);
    return { ...envelope, unit: metric === 'players_by_game' ? 'Eindeutige Spieler' : 'Erfasste Spielerstunden',
      totalRows: rows.length, rows: rows.slice(0, input.topN),
      definition: 'Summierte erfasste Laufzeit, keine Veranstaltungsdauer oder gemessene aktive Spielzeit.' };
  }
  requireFeature(principal, 'competition');
  if (metric === 'team_formations' || metric === 'draws_without_result') {
    const cutoff = input.olderThanHours === undefined ? null : now - input.olderThanHours * 3_600_000;
    const rows = db.prepare(`SELECT md.game_id AS gameId,g.name AS gameName,COALESCE(md.source,'automatic') AS source,
      COUNT(*) AS total,SUM(md.match_id IS NULL) AS withoutResult,SUM(md.match_id IS NOT NULL) AS withResult,
      SUM(md.tournament_id IS NOT NULL) AS tournamentLinked,MIN(md.generated_at) AS oldestCreatedAt,
      MIN(CASE WHEN md.match_id IS NULL THEN md.generated_at END) AS oldestWithoutResultAt
      FROM matchmaking_draws md JOIN games g ON g.id=md.game_id
      WHERE md.group_id=? AND md.event_id=? AND (? IS NULL OR md.game_id=?)
        AND (? IS NULL OR md.generated_at>=?) AND (? IS NULL OR md.generated_at<?)
        AND (? IS NULL OR md.generated_at<?)
      GROUP BY md.game_id,md.source ORDER BY total DESC,md.game_id,source`).all(principal.groupId, principal.eventId,
        input.gameId ?? null, input.gameId ?? null, input.from ?? null, input.from ?? null,
        input.to ?? null, input.to ?? null, cutoff, cutoff) as Array<{ total: number; withoutResult: number; withResult: number }>;
    return { ...envelope, unit: 'Gespeicherte Teamaufstellungen', definition: 'Auslosungen, Drafts und Rematches getrennt; ohne Ergebnis bedeutet match_id IS NULL.',
      total: rows.reduce((sum, row) => sum + row.total, 0), withoutResult: rows.reduce((sum, row) => sum + row.withoutResult, 0),
      withResult: rows.reduce((sum, row) => sum + row.withResult, 0), totalRows: rows.length, rows: rows.slice(0, input.topN) };
  }
  if (metric === 'recorded_matches') {
    const rows = db.prepare(`SELECT m.game_id AS gameId,g.name AS gameName,m.result FROM matches m JOIN games g ON g.id=m.game_id
      WHERE m.group_id=? AND m.event_id=? AND (? IS NULL OR m.game_id=?)
      AND (? IS NULL OR m.played_at>=?) AND (? IS NULL OR m.played_at<?)`)
      .all(principal.groupId, principal.eventId, input.gameId ?? null, input.gameId ?? null,
        input.from ?? null, input.from ?? null, input.to ?? null, input.to ?? null) as Array<{ gameId: string; gameName: string; result: string }>;
    const hidden = testPlayerIds();
    const counts = new Map<string, { gameId: string; gameName: string; count: number }>();
    for (const row of rows.filter((r) => !matchResultContainsPlayerIds(r.result, hidden))) {
      const entry = counts.get(row.gameId) ?? { gameId: row.gameId, gameName: row.gameName, count: 0 };
      entry.count++; counts.set(row.gameId, entry);
    }
    const result = [...counts.values()].sort((a, b) => b.count - a.count);
    return { ...envelope, unit: 'Eindeutige gespeicherte Matches', total: result.reduce((sum, row) => sum + row.count, 0),
      timeBasis: 'played_at', totalRows: result.length, rows: result.slice(0, input.topN) };
  }
  const rows = db.prepare(`SELECT game_id AS gameId,status,format,COUNT(*) AS count FROM tournaments
    WHERE group_id=? AND event_id=? AND (? IS NULL OR game_id=?)
    AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<?) GROUP BY game_id,status,format ORDER BY count DESC`)
    .all(principal.groupId, principal.eventId, input.gameId ?? null, input.gameId ?? null,
      input.from ?? null, input.from ?? null, input.to ?? null, input.to ?? null) as Array<{ count: number }>;
  return { ...envelope, unit: 'Turniere', timeBasis: 'created_at', total: rows.reduce((sum, row) => sum + row.count, 0),
    totalRows: rows.length, rows: rows.slice(0, input.topN) };
}

export function eventSummary(principal: Principal) {
  const snapshot = buildExportSnapshot(principal.eventId, principal.groupId);
  if (!snapshot) throw new IntegrationError('Event nicht gefunden.', 404);
  // Explicit projection: export also contains communications and info secrets.
  const competition = isEventFeatureEnabled(principal.eventId, 'competition');
  const tracking = isEventFeatureEnabled(principal.eventId, 'tracking');
  const settings = pointsSettings(principal.eventId);
  return { event: snapshot.event, exportedAt: snapshot.exportedAt, scoringModel: snapshot.scoringModel,
    leaderboardStatus: !competition ? 'disabled' : settings?.configured_at != null && !pointsAreVisible(principal.eventId) ? 'not_published' : 'available',
    leaderboard: competition ? snapshot.leaderboard : [], playtimeByPlayer: tracking ? snapshot.playtimeByPlayer : [],
    playtimeByGame: tracking ? snapshot.playtimeByGame : [], awards: tracking ? snapshot.awards : [], tournaments: competition ? snapshot.tournaments : [] };
}
