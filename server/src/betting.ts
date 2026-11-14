import { nanoid } from 'nanoid';
import { db } from './db';
import { requirePointsAdmin } from './pointsAccess';
import { computeRoundRobinStandings } from './tournament';
import { distributePool, type BettingPayoutPolicy } from './bettingMath';
import { computeMatchPlacements, type MatchForScoring } from './leaderboard';
import { bookBettingMarket } from './bettingAccounting';
import {
  ensurePointAccounts,
  pointParticipants,
  PointsError,
  requirePointsOpen,
  pointsAreVisible,
  requirePointsVisible,
  wallet,
  BETTING_MAX_STAKE,
} from './points';
import { notifyPlayers, resolvePushTopic, unresolvedPushTopics } from './push';
import { broadcast, Events } from './realtime';
import type { Request } from 'express';
import { writeAdminAudit } from './adminAudit';

export type BetSource = 'draw' | 'tournament_match' | 'tournament';
export const DRAW_BET_OUTCOME = '__draw__';
export interface BetOutcome {
  id: string;
  label: string;
  playerIds: string[];
}
export interface BettingRound {
  id: string;
  group_id: string;
  event_id: string;
  source_type: BetSource;
  source_id: string;
  title: string;
  outcomes: string;
  status: 'open' | 'locked' | 'settled' | 'refunded';
  closes_at: number;
  locked_at: number | null;
  settled_at: number | null;
  result_key: string | null;
  revision: number;
  created_at: number;
  notice_sent: number;
  payout_policy: BettingPayoutPolicy;
  // Why an automatically refunded round was refunded: 'result' keeps it
  // correctable, 'replaced' lets the unchanged source open a fresh round.
  refund_cause: RefundCause;
}
type RefundCause = 'result' | 'replaced' | null;
interface TipRow {
  id: string;
  player_id: string | null;
  outcome_id: string;
  stake: number;
  payout: number | null;
  day: string;
  created_at: number;
  sequence: number;
}
interface SourceState {
  title: string;
  outcomes: BetOutcome[];
  finished: boolean;
  winner: string | null;
  invalid: boolean;
  started: boolean;
}
interface TournamentRow {
  id: string;
  name: string;
  format: string;
  status: string;
  ended_early: number;
}
interface Fixture {
  id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  is_draw: number;
  is_bye: number;
  played_at: number | null;
  round: number;
  stage: string | null;
  is_third_place: number;
}

function tournamentOutcomes(id: string): BetOutcome[] {
  return (
    db
      .prepare('SELECT id, name, player_ids FROM tournament_teams WHERE tournament_id = ? ORDER BY rowid')
      .all(id) as Array<{ id: string; name: string; player_ids: string }>
  ).map((t) => ({ id: t.id, label: t.name, playerIds: JSON.parse(t.player_ids) }));
}
export function betSourceState(groupId: string, eventId: string, type: BetSource, id: string): SourceState {
  if (type === 'draw') {
    const draw = db
      .prepare(
        `SELECT d.teams,d.match_id,d.tournament_id,d.betting_allowed,g.name FROM matchmaking_draws d
      JOIN games g ON g.id = d.game_id WHERE d.id = ? AND d.group_id = ? AND d.event_id = ?`,
      )
      .get(id, groupId, eventId) as
      { teams: string; match_id: string | null; tournament_id: string | null; betting_allowed: number; name: string } | undefined;
    if (!draw) throw new PointsError('Match nicht gefunden.', 404);
    const teams = JSON.parse(draw.teams) as Array<{ players: Array<{ id: string; name: string }> }>;
    const sides: BetOutcome[] = teams.map((t, i) => ({
      id: String(i),
      label: t.players.map((p) => p.name).join(', '),
      playerIds: t.players.map((p) => p.id),
    }));
    const result = draw.match_id
      ? (db.prepare('SELECT result FROM matches WHERE id = ?').get(draw.match_id) as { result: string } | undefined)
      : undefined;
    const data = result
      ? (JSON.parse(result.result) as MatchForScoring)
      : null;
    const placements = data ? computeMatchPlacements(data) : null;
    const winners = placements?.flatMap((placement, index) => placement.place === 1 ? [String(index)] : []) ?? [];
    const mismatch =
      data &&
      JSON.stringify(data.teams.map((t) => [...t.playerIds].sort())) !==
        JSON.stringify(sides.map((t) => [...t.playerIds].sort()));
    return {
      title: draw.name,
      outcomes: [...sides, { id: DRAW_BET_OUTCOME, label: 'Unentschieden', playerIds: [] }],
      started: Boolean(result),
      finished: Boolean(result),
      winner: winners.length > 1 ? DRAW_BET_OUTCOME : winners[0] ?? null,
      invalid: Boolean(!draw.betting_allowed || draw.tournament_id || mismatch),
    };
  }
  const fixture =
    type === 'tournament_match'
      ? (db
          .prepare(
            `SELECT m.* FROM tournament_matches m
    JOIN tournaments t ON t.id = m.tournament_id WHERE m.id = ? AND t.group_id = ? AND t.event_id = ?`,
          )
          .get(id, groupId, eventId) as (Fixture & { tournament_id: string }) | undefined)
      : undefined;
  const tournamentId = type === 'tournament' ? id : fixture?.tournament_id;
  const tournament = tournamentId
    ? (db
        .prepare('SELECT * FROM tournaments WHERE id = ? AND group_id = ? AND event_id = ?')
        .get(tournamentId, groupId, eventId) as TournamentRow | undefined)
    : undefined;
  if (!tournament) throw new PointsError('Turnier nicht gefunden.', 404);
  const teams = tournamentOutcomes(tournament.id);
  const fixtures = db
    .prepare('SELECT * FROM tournament_matches WHERE tournament_id = ?')
    .all(tournament.id) as Fixture[];
  if (type === 'tournament_match') {
    if (!fixture || !fixture.team_a_id || !fixture.team_b_id)
      throw new PointsError('Die Gegner stehen noch nicht fest.');
    const allowsDraw = tournament.format === 'round_robin' ||
      (tournament.format === 'group_knockout' && fixture.stage === 'group');
    const outcomes = [fixture.team_a_id, fixture.team_b_id].map((teamId) => {
      const team = teams.find((t) => t.id === teamId);
      if (!team) throw new PointsError('Ein Turnierteam wurde entfernt.', 404);
      return team;
    });
    if (allowsDraw) outcomes.push({ id: DRAW_BET_OUTCOME, label: 'Unentschieden', playerIds: [] });
    return {
      title: `${tournament.name} · Match`,
      outcomes,
      started: fixture.played_at !== null,
      finished: Boolean(fixture.winner_team_id || fixture.is_draw),
      winner: fixture.is_draw && allowsDraw ? DRAW_BET_OUTCOME : fixture.winner_team_id,
      invalid: Boolean(fixture.is_bye || tournament.ended_early),
    };
  }
  let winner: string | null = null;
  if (tournament.status === 'completed' && !tournament.ended_early) {
    if (tournament.format === 'round_robin') {
      const standings = computeRoundRobinStandings(
          teams.map((t) => t.id),
          fixtures
            .filter((m) => m.winner_team_id || m.is_draw)
            .map((m) => ({ teamAId: m.team_a_id!, teamBId: m.team_b_id!, winnerTeamId: m.winner_team_id })),
        );
      const first = standings[0];
      const tied = first && standings.filter((row) => row.points === first.points && row.wins === first.wins).length > 1;
      winner = first && !tied ? first.teamId : null;
    } else {
      const bracket = fixtures.filter(
        (m) => !m.is_third_place && (tournament.format !== 'group_knockout' || m.stage === 'knockout'),
      );
      const final = Math.max(...bracket.map((m) => m.round));
      winner = bracket.find((m) => m.round === final)?.winner_team_id ?? null;
    }
  }
  return {
    title: `${tournament.name} · Gesamtsieger`,
    outcomes: teams,
    winner,
    started: fixtures.some((m) => !m.is_bye && m.played_at !== null) || Boolean(db.prepare(`SELECT 1
      FROM betting_rounds r JOIN tournament_matches m ON m.id=r.source_id
      WHERE r.source_type='tournament_match' AND m.tournament_id=? AND r.locked_at IS NOT NULL LIMIT 1`).get(tournament.id)),
    finished: tournament.status === 'completed' || Boolean(tournament.ended_early),
    invalid: Boolean(tournament.ended_early),
  };
}
export function getBettingRound(groupId: string, eventId: string, id: string): BettingRound {
  const row = db
    .prepare('SELECT * FROM betting_rounds WHERE id = ? AND group_id = ? AND event_id = ?')
    .get(id, groupId, eventId) as BettingRound | undefined;
  if (!row) throw new PointsError('Tipprunde nicht gefunden.', 404);
  return row;
}
function tipsFor(id: string): TipRow[] {
  return db.prepare('SELECT rowid AS sequence,* FROM betting_tips WHERE round_id = ? ORDER BY created_at,rowid').all(id) as TipRow[];
}
// Re-rolling a draw within this window replaces it before anyone is told, so a
// burst of re-rolls announces only the lineup that is actually kept. The
// browser suites shorten the wait like their other fast timers; production and
// every other run keep the real window.
export const DRAW_NOTICE_DELAY_MS =
  process.env.NODE_ENV === 'test' && process.env.E2E_FAST_TIMERS === '1' ? 1000 : 30_000;
function noticeDue(round: BettingRound, now: number): boolean {
  return !round.notice_sent && round.status === 'open' && !(round.closes_at > 0 && round.closes_at <= now) &&
    !(round.source_type === 'draw' && round.created_at > now - DRAW_NOTICE_DELAY_MS) && pointsAreVisible(round.event_id);
}
function tournamentIdOf(round: BettingRound): string | null {
  if (round.source_type === 'tournament') return round.source_id;
  if (round.source_type !== 'tournament_match') return null;
  return (db.prepare('SELECT tournament_id FROM tournament_matches WHERE id = ?').pluck().get(round.source_id) as string | undefined) ?? null;
}
const TOURNAMENT_NOTICE_PREFIX = 'betting-open:tournament:';
function roundUrl(round: BettingRound): string {
  return `/?eventId=${encodeURIComponent(round.event_id)}#points/round/${encodeURIComponent(round.id)}`;
}
// Announces newly opened markets once. Markets that open together for one
// tournament share a single message instead of one per fixture.
export function notifyBettingRounds(rounds: BettingRound[]): void {
  const now = Date.now();
  const groups = new Map<string, BettingRound[]>();
  for (const round of rounds) {
    if (!noticeDue(round, now)) continue;
    const tournamentId = tournamentIdOf(round);
    const key = tournamentId ? `${round.event_id}:t:${tournamentId}` : `${round.event_id}:r:${round.id}`;
    const group = groups.get(key) ?? [];
    if (!group.some((row) => row.id === round.id)) group.push(round);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const [first] = group;
    const recipients = pointParticipants(first.group_id, first.event_id).map((p) => p.id);
    const scope = { groupId: first.group_id, eventId: first.event_id };
    if (group.length === 1) {
      notifyPlayers(recipients, {
        title: `Neue Wettmöglichkeit: ${first.title}`,
        body: first.closes_at > 0
          ? `Auch Mitspieler können tippen. Tipps bis ${new Date(first.closes_at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })}.`
          : 'Auch Mitspieler können tippen. Vor Spielbeginn die Tipps schließen.',
        url: roundUrl(first),
        type: 'betting-open',
        targetId: first.id,
      }, 'direct', { key: `betting-open:${first.id}`, ...(first.closes_at > 0 ? { expiresAt: first.closes_at } : {}) }, scope);
    } else {
      const tournamentId = tournamentIdOf(first)!;
      const name = (db.prepare('SELECT name FROM tournaments WHERE id = ?').pluck().get(tournamentId) as string | undefined) ?? first.title;
      const anchor = group.find((round) => round.source_type === 'tournament') ?? first;
      const fixtures = group.filter((round) => round.source_type === 'tournament_match').length;
      const what = [fixtures ? `${fixtures} ${fixtures === 1 ? 'Spiel' : 'Spiele'}` : '',
        group.some((round) => round.source_type === 'tournament') ? 'der Turniersieger' : ''].filter(Boolean).join(' und ');
      notifyPlayers(recipients, {
        title: `Neue Wettmöglichkeiten: ${name}`,
        body: `${what}. Auch Mitspieler können tippen.`,
        url: roundUrl(anchor),
        type: 'betting-open',
        targetId: anchor.id,
      }, 'direct', { key: `${TOURNAMENT_NOTICE_PREFIX}${tournamentId}:${anchor.id}` }, scope);
    }
    const mark = db.prepare('UPDATE betting_rounds SET notice_sent = 1 WHERE id = ?');
    for (const round of group) mark.run(round.id);
  }
}
// A closed market withdraws its own message. A tournament's shared message
// stays until none of its markets accepts tips any more; it is checked by the
// tournament named in the topic, because a deleted tournament has already
// lost the fixture rows that would link its markets back to it.
export function resolveBettingNotice(round: BettingRound): void {
  const scope = { groupId: round.group_id, eventId: round.event_id };
  resolvePushTopic(`betting-open:${round.id}`, false, scope);
  if (round.source_type === 'draw') return;
  const stillOpen = db.prepare(`SELECT 1 FROM betting_rounds r WHERE r.status = 'open' AND r.event_id = ? AND (
      (r.source_type = 'tournament' AND r.source_id = ?) OR
      (r.source_type = 'tournament_match' AND r.source_id IN (SELECT id FROM tournament_matches WHERE tournament_id = ?)))`);
  const tournamentIds = new Set(unresolvedPushTopics(TOURNAMENT_NOTICE_PREFIX, scope)
    .map((topic) => topic.slice(TOURNAMENT_NOTICE_PREFIX.length).split(':')[0]));
  for (const tournamentId of tournamentIds)
    if (!stillOpen.get(round.event_id, tournamentId, tournamentId))
      resolvePushTopic(`${TOURNAMENT_NOTICE_PREFIX}${tournamentId}`, true, scope);
}
export function createBettingRound(
  groupId: string,
  eventId: string,
  type: BetSource,
  sourceId: string,
  closesAt: number,
  actorId: string | null,
  publish = true,
): string {
  const id = db.transaction(() => {
    requirePointsVisible(eventId);
    requirePointsOpen(eventId);
    requireActiveBettingEvent(eventId);
    const source = betSourceState(groupId, eventId, type, sourceId);
    if (
      source.started ||
      source.finished ||
      source.invalid ||
      source.outcomes.filter((outcome) => outcome.id !== DRAW_BET_OUTCOME).length < 2 ||
      source.outcomes.some((o) => o?.id !== DRAW_BET_OUTCOME && !o?.playerIds.length)
    ) {
      throw new PointsError('Für diesen Wettbewerb kann keine neue Tipprunde geöffnet werden.');
    }
    if (
      db
        .prepare(`SELECT 1 FROM betting_rounds WHERE event_id = ? AND source_type = ? AND source_id = ?
          AND refund_cause IS NOT 'replaced'`)
        .get(eventId, type, sourceId)
    ) {
      throw new PointsError('Für diesen Wettbewerb besteht bereits eine Tipprunde.');
    }
    const roundId = nanoid();
    db.prepare(
      `INSERT INTO betting_rounds (id,group_id,event_id,source_type,source_id,title,outcomes,status,closes_at,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,'open',?,?,?)`,
    ).run(
      roundId,
      groupId,
      eventId,
      type,
      sourceId,
      source.title,
      JSON.stringify(source.outcomes),
      closesAt,
      actorId,
      Date.now(),
    );
    return roundId;
  }).immediate();
  if (publish) notifyBettingRounds([getBettingRound(groupId, eventId, id)]);
  return id;
}
function requireActiveBettingEvent(eventId: string): void {
  if (!db.prepare("SELECT 1 FROM events WHERE id=? AND status='published' AND ended_at IS NULL").get(eventId))
    throw new PointsError('Neue Wetten sind nur in einer laufenden veröffentlichten LAN möglich.');
}

// Called inside the competition transaction. Only approved draws and playable
// tournament sources create markets; notification delivery follows the commit.
function ensureBettingMarkets(eventId?: string): BettingRound[] {
  const sources = db.prepare(`WITH candidates AS (
    SELECT d.id AS source_id,d.group_id,d.event_id,'draw' AS source_type,d.created_by
      FROM matchmaking_draws d WHERE d.betting_allowed=1 AND d.match_id IS NULL AND d.tournament_id IS NULL
    UNION ALL
    SELECT m.id,t.group_id,t.event_id,'tournament_match',t.created_by FROM tournament_matches m
      JOIN tournaments t ON t.id=m.tournament_id WHERE t.status!='completed' AND t.ended_early=0
        AND m.played_at IS NULL AND m.is_bye=0 AND m.team_a_id IS NOT NULL AND m.team_b_id IS NOT NULL
    UNION ALL
    SELECT t.id,t.group_id,t.event_id,'tournament',t.created_by FROM tournaments t
      WHERE t.status!='completed' AND t.ended_early=0
  ) SELECT c.*,
      -- A replacement keeps the explicit deadline of the round it replaces.
      COALESCE((SELECT p.closes_at FROM betting_rounds p WHERE p.event_id=c.event_id AND p.source_type=c.source_type
        AND p.source_id=c.source_id AND p.refund_cause='replaced' ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1),0) AS closes_at
    FROM candidates c JOIN events e ON e.id=c.event_id AND e.group_id=c.group_id
    JOIN points_settings s ON s.event_id=e.id AND s.closed_at IS NULL AND s.visible=1
    LEFT JOIN betting_rounds r ON r.event_id=c.event_id AND r.source_type=c.source_type AND r.source_id=c.source_id
      AND r.refund_cause IS NOT 'replaced'
    WHERE r.id IS NULL AND e.event_type_key='lan' AND e.status='published' AND e.ended_at IS NULL
      AND (? IS NULL OR e.id=?)`).all(eventId ?? null, eventId ?? null) as
    Array<{ source_id: string; group_id: string; event_id: string; source_type: BetSource; created_by: string | null; closes_at: number }>;
  const created: BettingRound[] = [];
  for (const row of sources) {
    let source: SourceState;
    try {
      source = betSourceState(row.group_id, row.event_id, row.source_type, row.source_id);
    } catch (error) {
      // Invalid legacy sources cannot offer a new market. Existing markets
      // are refunded by the reconciliation loop below.
      if (!(error instanceof PointsError)) throw error;
      continue;
    }
    const sides = source.outcomes.filter((outcome) => outcome.id !== DRAW_BET_OUTCOME);
    if (source.started || source.finished || source.invalid || sides.length < 2 ||
        sides.some((side) => !side.playerIds.length)) continue;
    const id = createBettingRound(row.group_id, row.event_id, row.source_type, row.source_id, row.closes_at, row.created_by, false);
    created.push(getBettingRound(row.group_id, row.event_id, id));
  }
  return created;
}
interface BetTournamentContext {
  id: string;
  name: string;
  gameName: string;
  round?: number;
  slot?: number;
  groupIndex?: number | null;
  thirdPlace?: number;
  // The fixture's name as the bracket shows it ("Halbfinale", "Gruppe 1 · Runde 2").
  phase?: string;
}

const KNOCKOUT_PHASES = ['Finale', 'Halbfinale', 'Viertelfinale'];
function tournamentContext(round: BettingRound): BetTournamentContext | null {
  if (round.source_type === 'draw') return null;
  if (round.source_type === 'tournament') {
    return db.prepare(`SELECT t.id, t.name, g.name AS gameName FROM tournaments t JOIN games g ON g.id = t.game_id
       WHERE t.id = ? AND t.group_id = ? AND t.event_id = ?`)
      .get(round.source_id, round.group_id, round.event_id) as BetTournamentContext | undefined ?? null;
  }
  const row = db.prepare(`SELECT t.id, t.name, g.name AS gameName, m.round, m.slot, m.group_index AS groupIndex,
       m.is_third_place AS thirdPlace, t.format, m.stage,
       (SELECT MAX(x.round) FROM tournament_matches x WHERE x.tournament_id = m.tournament_id
         AND x.is_third_place = 0 AND x.stage IS m.stage) AS finalRound
       FROM tournament_matches m
       JOIN tournaments t ON t.id = m.tournament_id JOIN games g ON g.id = t.game_id
       WHERE m.id = ? AND t.group_id = ? AND t.event_id = ?`).get(round.source_id, round.group_id, round.event_id) as
    (Required<Omit<BetTournamentContext, 'phase'>> & { format: string; stage: string | null; finalRound: number }) | undefined;
  if (!row) return null;
  const { format, stage, finalRound, ...context } = row;
  const phase = context.thirdPlace ? 'Spiel um Platz 3'
    : format === 'round_robin' || stage === 'group'
      ? `${context.groupIndex != null ? `Gruppe ${context.groupIndex + 1} · ` : ''}Runde ${context.round}`
      : KNOCKOUT_PHASES[finalRound - context.round] ?? `Runde ${context.round}`;
  return { ...context, phase };
}

export function roundView(round: BettingRound, playerId: string) {
  const tips = tipsFor(round.id);
  const mine = tips.find((tip) => tip.player_id === playerId);
  const pot = tips.reduce((sum, t) => sum + t.stake, 0);
  // Only identities that may be shown publicly: accounts that opted out of
  // being named (newsticker opt-out) and test accounts outside test events
  // stay anonymous stakes, without name or id (#755).
  const tipperIds = [...new Set(tips.map((t) => t.player_id).filter((id): id is string => Boolean(id)))];
  const tipperNames = new Map(tipperIds.length
    ? (db.prepare(`SELECT p.id, p.name FROM players p JOIN events e ON e.id = ?
        WHERE p.id IN (${tipperIds.map(() => '?').join(',')}) AND p.newsticker_opt_out = 0 AND (p.is_test = 0 OR e.is_test = 1)`)
      .all(round.event_id, ...tipperIds) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])
    : []);
  return {
    id: round.id,
    eventId: round.event_id,
    sourceType: round.source_type,
    sourceId: round.source_id,
    tournament: tournamentContext(round),
    title: round.title,
    status: round.status,
    payoutPolicy: round.payout_policy,
    closesAt: round.closes_at || null,
    settledAt: round.settled_at,
    revision: round.revision,
    result: round.result_key,
    replaced: round.refund_cause === 'replaced',
    rebooksOnCorrection: rebooksOnCorrection(round, tips),
    pot,
    tipCount: tips.length,
    outcomes: (JSON.parse(round.outcomes) as BetOutcome[]).map((outcome) => {
      const stake = tips.filter((t) => t.outcome_id === outcome.id).reduce((sum, t) => sum + t.stake, 0);
      // Tips are public with names from the moment they are placed (product
      // decision on #755). Erased, opted-out and hidden test accounts stay
      // anonymous stakes: neither name nor id is published.
      const tippers = tips
        .filter((t) => t.outcome_id === outcome.id)
        .map((t) => {
          const name = t.player_id ? tipperNames.get(t.player_id) ?? null : null;
          return { playerId: name === null ? null : t.player_id, name, stake: t.stake };
        })
        .sort((x, y) => y.stake - x.stake || (x.name ?? '').localeCompare(y.name ?? '', 'de'));
      const preview = mine?.outcome_id === outcome.id
        ? distributePool(
            tips.map((t) => ({ id: t.id, stake: t.stake, outcomeId: t.outcome_id, createdAt: t.created_at, sequence: t.sequence })),
            outcome.id,
            round.payout_policy,
          ).get(mine.id)
        : undefined;
      return {
        ...outcome,
        stake,
        odds: stake ? (round.payout_policy === 'stake_cap_v1' ? Math.min(2, pot / stake) : pot / stake) : null,
        myPossiblePayout: mine?.outcome_id === outcome.id ? preview : null,
        tippers,
      };
    }),
    mine: mine
      ? {
          id: mine.id,
          outcomeId: mine.outcome_id,
          stake: mine.stake,
          payout: mine.payout,
          net: mine.payout === null ? null : mine.payout - mine.stake,
        }
      : null,
  };
}
// A result correction rebooks settled rounds and result refunds whose tips
// could still pay out under a different winner.
function rebooksOnCorrection(round: BettingRound, tips: TipRow[]): boolean {
  return round.status === 'settled' ||
    (round.status === 'refunded' && round.refund_cause === 'result' && new Set(tips.map((t) => t.outcome_id)).size >= 2);
}
const REBOOKS_ON_CORRECTION_SQL = `(r.status = 'settled' OR (r.status = 'refunded' AND r.refund_cause = 'result'
  AND (SELECT COUNT(DISTINCT t.outcome_id) FROM betting_tips t WHERE t.round_id = r.id) >= 2))`;
function sourceChanged(round: BettingRound, source: SourceState): boolean {
  // Optional draw selection is not a participant. Older markets without it
  // retain their original choices and refund an unselectable draw result.
  const signature = (outcomes: BetOutcome[]) => outcomes.filter((o) => o.id !== DRAW_BET_OUTCOME)
    .map((o) => ({ id: o.id, players: [...o.playerIds].sort() }));
  return JSON.stringify(signature(JSON.parse(round.outcomes))) !== JSON.stringify(signature(source.outcomes));
}
function closeRound(round: BettingRound, now: number, refundInvalidPool = true): void {
  const tips = tipsFor(round.id);
  if (refundInvalidPool && (tips.length < 2 || new Set(tips.map((t) => t.outcome_id)).size < 2)) {
    settleRound(round, null, 'Ungültiger Tipptopf', now);
    db.prepare('UPDATE betting_tips SET counts_daily = 0 WHERE round_id = ?').run(round.id);
  } else
    db.prepare("UPDATE betting_rounds SET status = 'locked', locked_at = ? WHERE id = ? AND status = 'open'").run(
      now,
      round.id,
    );
}
// The winner a settlement would pay, or null when the pool must be refunded.
function payingWinner(tips: TipRow[], winner: string | null): string | null {
  return winner !== null && tips.some((t) => t.outcome_id === winner) && new Set(tips.map((t) => t.outcome_id)).size >= 2
    ? winner
    : null;
}
// Without tips a changed lineup simply updates the offered sides; the round,
// its link and its notification remain valid.
function rewriteUntippedRound(round: BettingRound, source: SourceState): boolean {
  const sides = source.outcomes.filter((outcome) => outcome.id !== DRAW_BET_OUTCOME);
  if (tipsFor(round.id).length || sides.length < 2 || sides.some((side) => !side.playerIds.length)) return false;
  db.prepare('UPDATE betting_rounds SET title = ?, outcomes = ? WHERE id = ?')
    .run(source.title, JSON.stringify(source.outcomes), round.id);
  return true;
}
function settleRound(
  round: BettingRound,
  winner: string | null,
  reason: string,
  now: number,
  actorId: string | null = null,
  refundCause: RefundCause = null,
): void {
  const tips = tipsFor(round.id);
  const valid = payingWinner(tips, winner) !== null;
  const payouts = distributePool(
    tips.map((t) => ({ id: t.id, stake: t.stake, outcomeId: t.outcome_id, createdAt: t.created_at, sequence: t.sequence })),
    valid ? winner : null,
    round.payout_policy,
  );
  for (const tip of tips) {
    const payout = payouts.get(tip.id)!;
    db.prepare('UPDATE betting_tips SET payout = ? WHERE id = ?').run(payout, tip.id);
  }
  db.prepare('UPDATE betting_rounds SET status = ?, result_key = ?, settled_at = ?, refund_cause = ? WHERE id = ?').run(
    valid ? 'settled' : 'refunded',
    valid ? winner : null,
    now,
    valid ? null : refundCause,
    round.id,
  );
  bookBettingMarket(round.group_id, round.event_id, round.id, reason, actorId);
}
// Invoked after competition writes, on reads, and by the deadline sweeper.
// Result corrections are handled by the explicit administrative path only.
export function reconcileBetting(eventId?: string, publish = true): BettingRound[] {
  const changed: BettingRound[] = [];
  db.transaction(() => {
    changed.push(...ensureBettingMarkets(eventId));
    let replaced = false;
    // An open round whose source changed is replaced by a fresh round once
    // the source offers a market again. Closed tips and elapsed deadlines stay closed.
    const refundChanged = (round: BettingRound, reason: string, replaceable: boolean) => {
      const open = round.status === 'open' && !(round.closes_at > 0 && round.closes_at <= Date.now());
      const cause = replaceable && open ? 'replaced' : null;
      settleRound(round, null, reason, Date.now(), null, cause);
      replaced ||= cause !== null;
      changed.push(round);
    };
    const rounds = (eventId
      ? db.prepare("SELECT * FROM betting_rounds WHERE event_id = ? AND status IN ('open','locked')").all(eventId)
      : db.prepare("SELECT * FROM betting_rounds WHERE status IN ('open','locked')").all()) as BettingRound[];
    for (const row of rounds) {
      let round = getBettingRound(row.group_id, row.event_id, row.id);
      if (!['open', 'locked'].includes(round.status)) continue;
      let source: SourceState;
      try {
        source = betSourceState(round.group_id, round.event_id, round.source_type, round.source_id);
      } catch (e) {
        if (!(e instanceof PointsError)) throw e;
        // Also covers a fixture whose opponents were cleared by a corrected
        // earlier round; its next pairing receives a fresh market.
        refundChanged(round, 'Wettbewerb entfernt', true);
        continue;
      }
      if (source.invalid) {
        refundChanged(round, 'Wettbewerb geändert oder abgebrochen', false);
        continue;
      }
      if (sourceChanged(round, source)) {
        if (!rewriteUntippedRound(round, source)) {
          refundChanged(round, 'Wettbewerb geändert oder abgebrochen', true);
          continue;
        }
        changed.push(round);
        round = getBettingRound(round.group_id, round.event_id, round.id);
      }
      if (round.status === 'open' && source.started) {
        // A recorded result closes betting atomically with the source write.
        // Accepted tips remain valid; subsequent tip requests see the lock.
        closeRound(round, Date.now(), false);
        changed.push(round);
        round = getBettingRound(round.group_id, round.event_id, round.id);
      }
      if (round.status === 'open' && round.closes_at > 0 && round.closes_at <= Date.now()) {
        closeRound(round, Date.now());
        changed.push(round);
        round = getBettingRound(round.group_id, round.event_id, round.id);
      }
      if (round.status === 'locked' && source.finished) {
        settleRound(round, source.winner, 'Spielergebnis', Date.now(), null, 'result');
        changed.push(round);
      }
    }
    if (replaced) changed.push(...ensureBettingMarkets(eventId));
  }).immediate();
  if (publish) publishBettingChanges(changed);
  return changed;
}
// "Teams auslosen" again for the same game and roster discards the draw shown
// before it. It stops offering betting for good, also when hidden points have
// not opened its market yet; an open market closes and accepted tips are
// refunded. A draw that differs, already has a result or closed its tips is
// left unchanged.
export function retireRerolledDraw(groupId: string, eventId: string, previousDrawId: string, gameId: string,
  playerIds: string[]): BettingRound[] {
  const previous = db.prepare(`SELECT teams FROM matchmaking_draws WHERE id = ? AND group_id = ? AND event_id = ?
    AND game_id = ? AND match_id IS NULL AND tournament_id IS NULL`).get(previousDrawId, groupId, eventId, gameId) as
    { teams: string } | undefined;
  if (!previous) return [];
  const roster = (JSON.parse(previous.teams) as Array<{ players: Array<{ id: string }> }>)
    .flatMap((team) => team.players.map((player) => player.id)).sort();
  if (JSON.stringify(roster) !== JSON.stringify([...playerIds].sort())) return [];
  if (db.prepare(`SELECT 1 FROM betting_rounds WHERE event_id = ? AND source_type = 'draw' AND source_id = ?
    AND status IN ('locked','settled')`).get(eventId, previousDrawId)) return [];
  db.prepare('UPDATE matchmaking_draws SET betting_allowed = 0 WHERE id = ?').run(previousDrawId);
  const rounds = db.prepare(`SELECT * FROM betting_rounds WHERE event_id = ? AND source_type = 'draw' AND source_id = ?
    AND status = 'open'`).all(eventId, previousDrawId) as BettingRound[];
  for (const round of rounds) settleRound(round, null, 'Neu ausgelost', Date.now());
  return rounds;
}
function notifyBettingWinners(round: BettingRound): void {
  if (round.status !== 'settled') return;
  const game = tournamentContext(round)?.gameName ?? db.prepare(`SELECT g.name FROM matchmaking_draws d
    JOIN games g ON g.id = d.game_id WHERE d.id = ?`).pluck().get(round.source_id) as string | undefined;
  for (const tip of tipsFor(round.id)) {
    const net = (tip.payout ?? 0) - tip.stake;
    if (!tip.player_id || net <= 0) continue;
    const key = `betting-win:${round.id}:${round.revision}:${tip.player_id}`;
    if (db.prepare('SELECT 1 FROM push_log WHERE group_id = ? AND event_id = ? AND topic_key = ?')
      .get(round.group_id, round.event_id, key)) continue;
    notifyPlayers([tip.player_id], { title: `+${net} P. aus ${game ?? round.title}`,
      body: round.revision ? 'Deine Wette wurde nach einer Ergebniskorrektur neu abgerechnet.' : 'Dein Tipp hat gewonnen.',
      url: roundUrl(round), type: 'betting-win', targetId: round.id }, 'direct', { key },
    { groupId: round.group_id, eventId: round.event_id });
  }
}

export function publishBettingChanges(changed: BettingRound[]): void {
  const opened: BettingRound[] = [];
  const scopes = new Map<string, { groupId: string; eventId: string }>();
  for (const round of changed) {
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status === 'settled') notifyBettingWinners(fresh);
    if (fresh.status !== 'open') resolveBettingNotice(fresh);
    else opened.push(fresh);
    scopes.set(`${round.group_id}:${round.event_id}`, { groupId: round.group_id, eventId: round.event_id });
  }
  notifyBettingRounds(opened);
  for (const scope of scopes.values()) broadcast(Events.leaderboardChanged, null, scope);
}

// Competition writes and the resulting settlements/refunds commit together.
// Realtime and notification delivery are deferred until the outer commit.
export function withBettingAccounting<T>(eventId: string | undefined, change: () => T): T {
  const committed = db.transaction(() => {
    // Apply elapsed deadlines and existing results before editing their source,
    // scoped to the authorized event and rolled back if the edit fails.
    const before = reconcileBetting(eventId, false);
    const previous = db.prepare('SELECT * FROM betting_rounds WHERE (? IS NULL OR event_id = ?)')
      .all(eventId ?? null, eventId ?? null) as BettingRound[];
    const result = change();
    const rounds = [...before, ...reconcileBetting(eventId, false)];
    // Explicit corrections can already be settled before reconciliation runs.
    const revisions = new Map((db.prepare('SELECT id, revision FROM betting_rounds WHERE (? IS NULL OR event_id = ?)')
      .all(eventId ?? null, eventId ?? null) as Array<{ id: string; revision: number }>).map((r) => [r.id, r.revision]));
    for (const old of previous) {
      if (revisions.has(old.id) && revisions.get(old.id) !== old.revision) rounds.push(old);
    }
    return { result, rounds };
  }).immediate();
  publishBettingChanges(committed.rounds);
  return committed.result;
}
export function putTip(
  groupId: string,
  eventId: string,
  roundId: string,
  playerId: string,
  outcomeId: string,
  stake: number,
): void {
  reconcileBetting(eventId);
  db.transaction(() => {
    requirePointsVisible(eventId);
    requirePointsOpen(eventId);
    requireActiveBettingEvent(eventId);
    ensurePointAccounts(eventId);
    const round = getBettingRound(groupId, eventId, roundId);
    if (round.status !== 'open' || (round.closes_at > 0 && round.closes_at <= Date.now())) throw new PointsError('Die Tipps sind geschlossen.');
    if (!pointParticipants(groupId, eventId).some((p) => p.id === playerId))
      throw new PointsError('Keine Wertungsteilnahme.', 404);
    if (!(JSON.parse(round.outcomes) as BetOutcome[]).some((o) => o.id === outcomeId))
      throw new PointsError('Ungültiger Sieger-Tipp.', 400);
    if (stake > BETTING_MAX_STAKE) throw new PointsError(`Höchstens ${BETTING_MAX_STAKE} Punkte je Runde.`, 400);
    if (wallet(eventId, playerId).available < 0) throw new PointsError('Dein verfügbares Wettguthaben ist negativ.');
    const previous = tipsFor(round.id).find((t) => t.player_id === playerId);
    if (wallet(eventId, playerId).available + (previous?.stake ?? 0) < stake)
      throw new PointsError('Nicht genügend frei verfügbare Punkte.');
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
    db.prepare(
      `INSERT INTO betting_tips (id,round_id,player_id,outcome_id,stake,day,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(round_id,player_id) DO UPDATE SET outcome_id=excluded.outcome_id, stake=excluded.stake, day=excluded.day, updated_at=excluded.updated_at`,
    ).run(previous?.id ?? nanoid(), round.id, playerId, outcomeId, stake, day, Date.now(), Date.now());
    bookBettingMarket(groupId, eventId, round.id, 'Tippeinsatz reserviert');
  }).immediate();
}
export function removeTip(groupId: string, eventId: string, roundId: string, playerId: string): void {
  reconcileBetting(eventId);
  db.transaction(() => {
    requirePointsOpen(eventId);
    const round = getBettingRound(groupId, eventId, roundId);
    if (round.status !== 'open' || (round.closes_at > 0 && round.closes_at <= Date.now())) throw new PointsError('Die Tipps sind geschlossen.');
    db.prepare('DELETE FROM betting_tips WHERE round_id = ? AND player_id = ?').run(round.id, playerId);
    bookBettingMarket(groupId, eventId, round.id, 'Tipp zurückgenommen');
  }).immediate();
}
export function lockBettingRound(round: BettingRound): void {
  const closedChampions: BettingRound[] = [];
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status !== 'open') throw new PointsError('Diese Runde ist bereits geschlossen.');
    const source = betSourceState(round.group_id, round.event_id, round.source_type, round.source_id);
    if (source.started || source.invalid || sourceChanged(round, source))
      throw new PointsError('Der Wettbewerb hat bereits begonnen oder wurde geändert.');
    if (round.source_type === 'tournament_match') {
      const champions = db.prepare(`SELECT r.* FROM betting_rounds r
        JOIN tournament_matches m ON m.tournament_id=r.source_id
        WHERE m.id=? AND r.source_type='tournament' AND r.event_id=? AND r.status='open'`)
        .all(round.source_id, round.event_id) as BettingRound[];
      for (const champion of champions) {
        closeRound(champion, Date.now(), false);
        closedChampions.push(champion);
      }
    }
    closeRound(fresh, Date.now(), false);
  }).immediate();
  for (const closed of [...closedChampions, round]) resolveBettingNotice(getBettingRound(closed.group_id, closed.event_id, closed.id));
}
export function reopenBettingRound(round: BettingRound, actorId: string): void {
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    requirePointsVisible(round.event_id);
    requireActiveBettingEvent(round.event_id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status !== 'locked') throw new PointsError('Nur geschlossene Tippabgaben können wieder geöffnet werden.');
    if (fresh.revision !== 0 || fresh.settled_at !== null)
      throw new PointsError('Bereits abgerechnete Einsätze bleiben auch nach einer Ergebniskorrektur unveränderlich.');
    if (fresh.closes_at > 0 && fresh.closes_at <= Date.now())
      throw new PointsError('Der festgelegte Tippschluss ist bereits vorbei.');
    const source = betSourceState(fresh.group_id, fresh.event_id, fresh.source_type, fresh.source_id);
    if (source.started || source.finished || source.invalid || sourceChanged(fresh, source))
      throw new PointsError('Der Wettbewerb hat bereits begonnen oder wurde geändert.');
    db.prepare("UPDATE betting_rounds SET status='open',locked_at=NULL WHERE id=? AND status='locked'").run(fresh.id);
    writeAdminAudit({ actorPlayerId: actorId, groupId: fresh.group_id, action: 'betting_round_reopened',
      targetType: 'betting_round', targetId: fresh.id });
  }).immediate();
}
export function refundBettingRound(round: BettingRound, actorId: string, reason: string): void {
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    requirePointsAdmin(round.group_id, actorId);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status !== 'open' && fresh.status !== 'locked')
      throw new PointsError('Diese Runde ist bereits abgerechnet.');
    settleRound(fresh, null, `Admin-Erstattung: ${reason}`, Date.now(), actorId);
    writeAdminAudit({ actorPlayerId: actorId, groupId: fresh.group_id, action: 'betting_round_refunded',
      targetType: 'betting_round', targetId: fresh.id, details: { reason } });
  }).immediate();
}
// Explicitly void an invalid settlement while retaining its original tips,
// credits and reason. Result edits use the atomic rebooking path below.
export function voidBettingRound(round: BettingRound, actorId: string, reason: string, expectedRevision: number): void {
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.revision !== expectedRevision || fresh.status !== 'settled')
      throw new PointsError('Abrechnung inzwischen geändert oder nicht korrigierbar.');
    requirePointsAdmin(fresh.group_id, actorId);
    db.prepare('UPDATE betting_rounds SET revision = revision + 1 WHERE id = ?').run(round.id);
    db.prepare('UPDATE betting_tips SET payout = stake WHERE round_id = ?').run(round.id);
    db.prepare("UPDATE betting_rounds SET status = 'refunded', result_key = NULL, settled_at = ? WHERE id = ?").run(
      Date.now(),
      round.id,
    );
    bookBettingMarket(fresh.group_id, fresh.event_id, fresh.id, `Storno: ${reason}`, actorId);
    writeAdminAudit({ actorPlayerId: actorId, groupId: fresh.group_id, action: 'betting_settlement_voided',
      targetType: 'betting_round', targetId: fresh.id, details: { reason } });
  }).immediate();
}
export function assertCompetitionEditable(groupId: string, eventId: string, type: BetSource, sourceId: string): void {
  const affected = db
    .prepare(
      `SELECT id FROM betting_rounds WHERE group_id = ? AND event_id = ? AND source_type = ? AND source_id = ? AND status = 'settled'`,
    )
    .get(groupId, eventId, type, sourceId);
  if (affected)
    throw new PointsError(
      'Für diese Begegnung wurden bereits Tipps abgerechnet. Ein Admin muss die Abrechnung zuerst mit Begründung stornieren (LAN-Punkte).',
    );
}

export function assertMatchEditable(groupId: string, matchId: string): void {
  for (const draw of db
    .prepare('SELECT id,event_id FROM matchmaking_draws WHERE group_id = ? AND match_id = ?')
    .all(groupId, matchId) as Array<{ id: string; event_id: string }>) {
    assertCompetitionEditable(groupId, draw.event_id, 'draw', draw.id);
  }
  for (const row of db
    .prepare(
      `SELECT t.id FROM tournaments t JOIN tournament_matches m ON m.tournament_id = t.id WHERE t.group_id = ? AND m.match_id = ?`,
    )
    .all(groupId, matchId) as Array<{ id: string }>) {
    assertTournamentEditable(groupId, row.id);
  }
}

// Removing a catalog game cascades through its draws, matches and tournaments.
// Apply the same settlement guards before any of those sources can disappear.
export function assertGameEditable(groupId: string, gameId: string): void {
  for (const match of db
    .prepare('SELECT id FROM matches WHERE group_id = ? AND game_id = ?')
    .all(groupId, gameId) as Array<{ id: string }>) {
    assertMatchEditable(groupId, match.id);
  }
  for (const draw of db
    .prepare('SELECT id,event_id FROM matchmaking_draws WHERE group_id = ? AND game_id = ?')
    .all(groupId, gameId) as Array<{ id: string; event_id: string }>) {
    assertCompetitionEditable(groupId, draw.event_id, 'draw', draw.id);
  }
  for (const tournament of db
    .prepare('SELECT id FROM tournaments WHERE group_id = ? AND game_id = ?')
    .all(groupId, gameId) as Array<{ id: string }>) {
    assertTournamentEditable(groupId, tournament.id);
  }
}

export function assertTournamentEditable(groupId: string, tournamentId: string): void {
  if (correctableTournamentRounds(groupId, tournamentId).some((round) => round.status === 'settled'))
    throw new PointsError(
      'Für dieses Turnier wurden bereits Tipps abgerechnet. Ein Admin muss betroffene Abrechnungen vor der Ergebniskorrektur mit Begründung stornieren (LAN-Punkte).',
    );
}

// Rounds a result correction of this competition rebooks; see rebooksOnCorrection.
// fixtureIds limits fixture markets to the matches a correction can change;
// the champion market always counts because any result can change the winner.
export function correctableTournamentRounds(groupId: string, tournamentId: string, fixtureIds?: string[]): BettingRound[] {
  const rounds = db
    .prepare(
      `SELECT r.* FROM betting_rounds r WHERE r.group_id = ? AND ${REBOOKS_ON_CORRECTION_SQL} AND (
    (r.source_type = 'tournament' AND r.source_id = ?) OR
    (r.source_type = 'tournament_match' AND r.source_id IN (SELECT id FROM tournament_matches WHERE tournament_id = ?)))`,
    )
    .all(groupId, tournamentId, tournamentId) as BettingRound[];
  if (!fixtureIds) return rounds;
  const affected = new Set(fixtureIds);
  return rounds.filter((round) => round.source_type === 'tournament' || affected.has(round.source_id));
}
export function correctableDrawRounds(groupId: string, matchId: string): BettingRound[] {
  return db
    .prepare(
      `SELECT r.* FROM betting_rounds r JOIN matchmaking_draws d ON d.id = r.source_id
    WHERE r.source_type = 'draw' AND r.group_id = ? AND d.match_id = ? AND ${REBOOKS_ON_CORRECTION_SQL}`,
    )
    .all(groupId, matchId) as BettingRound[];
}

interface BettingCorrection {
  reason: string;
  actorId: string;
}
// Validation and rebooking run inside the competition's own write transaction.
// Every affected revision must be supplied, so a stale second phone cannot
// re-apply a financial correction even when the sports editor has no version.
export function validateBettingCorrection(req: Request, rounds: BettingRound[]): BettingCorrection | null {
  if (!rounds.length) return null;
  const correction = req.body?.bettingCorrection;
  if (!correction)
    throw new PointsError(
      'Bereits abgerechnete Tipps: Ein Admin muss die Ergebniskorrektur mit Begründung und aktueller Abrechnungsversion speichern.',
    );
  if (!['admin', 'owner'].includes(req.groupMembership?.role ?? ''))
    throw new PointsError('Nur Admins können abgerechnete Ergebnisse korrigieren.', 403);
  if (typeof correction.reason !== 'string' || !correction.reason.trim() || correction.reason.trim().length > 300)
    throw new PointsError('Begründung für die Ergebniskorrektur erforderlich (höchstens 300 Zeichen).', 400);
  if (!Array.isArray(correction.revisions)) throw new PointsError('Abrechnungsversionen fehlen.', 400);
  for (const round of rounds) {
    requirePointsOpen(round.event_id);
    if (
      !correction.revisions.some(
        (v: { id?: unknown; revision?: unknown } | null) => v?.id === round.id && v.revision === round.revision,
      )
    ) {
      throw new PointsError('Die Abrechnung wurde inzwischen geändert. Bitte neu laden.');
    }
  }
  return { reason: correction.reason.trim(), actorId: req.player!.id };
}
export function rebookCorrectedRounds(rounds: BettingRound[], correction: BettingCorrection | null): void {
  if (!correction) return;
  for (const round of rounds) {
    let source: SourceState | null = null;
    try {
      source = betSourceState(round.group_id, round.event_id, round.source_type, round.source_id);
    } catch (error) {
      if (!(error instanceof PointsError)) throw error;
    }
    const voided = !source || source.invalid || sourceChanged(round, source);
    // Unchanged settlements stay untouched; a result refund stays refunded
    // until the corrected result can actually pay a tipped winner.
    const unchanged = voided
      ? round.status === 'refunded'
      : source!.finished && payingWinner(tipsFor(round.id), source!.winner) === round.result_key;
    if (unchanged) continue;
    requirePointsAdmin(round.group_id, correction.actorId);
    db.prepare(
      `UPDATE betting_rounds SET revision = revision + 1, status = 'locked', result_key = NULL, settled_at = NULL,
        refund_cause = NULL WHERE id = ?`,
    ).run(round.id);
    db.prepare('UPDATE betting_tips SET payout = NULL WHERE round_id = ?').run(round.id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (voided)
      settleRound(fresh, null, `Korrektur: ${correction.reason}`, Date.now(), correction.actorId);
    else if (source!.finished)
      settleRound(fresh, source!.winner, `Korrektur: ${correction.reason}`, Date.now(), correction.actorId, 'result');
    else bookBettingMarket(fresh.group_id, fresh.event_id, fresh.id, `Korrektur: ${correction.reason}`, correction.actorId);
    // If a corrected semifinal reopens the tournament, the unchanged outright
    // pool waits for the new final with its original, immutable stakes.
    writeAdminAudit({
      actorPlayerId: correction.actorId,
      groupId: round.group_id,
      action: 'betting_result_corrected',
      targetType: 'betting_round',
      targetId: round.id,
      details: { reason: correction.reason, fromRevision: round.revision, toRevision: fresh.revision },
    });
  }
}
