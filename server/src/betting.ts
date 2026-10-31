import { nanoid } from 'nanoid';
import { db } from './db';
import { computeRoundRobinStandings } from './tournament';
import { distributePool } from './bettingMath';
import {
  addPointEntry,
  ensurePointAccounts,
  pointParticipants,
  PointsError,
  requirePointsOpen,
  pointsAreVisible,
  requirePointsVisible,
  wallet,
} from './points';
import { notifyPlayers, resolvePushTopic } from './push';
import { broadcast, Events } from './realtime';
import type { Request } from 'express';
import { writeAdminAudit } from './adminAudit';

export type BetSource = 'draw' | 'tournament_match' | 'tournament';
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
}
interface TipRow {
  id: string;
  player_id: string | null;
  outcome_id: string;
  stake: number;
  payout: number | null;
  day: string;
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
        `SELECT d.teams,d.match_id,d.tournament_id,g.name FROM matchmaking_draws d
      JOIN games g ON g.id = d.game_id WHERE d.id = ? AND d.group_id = ? AND d.event_id = ?`,
      )
      .get(id, groupId, eventId) as
      { teams: string; match_id: string | null; tournament_id: string | null; name: string } | undefined;
    if (!draw) throw new PointsError('Match nicht gefunden.', 404);
    const teams = JSON.parse(draw.teams) as Array<{ players: Array<{ id: string; name: string }> }>;
    const outcomes = teams.map((t, i) => ({
      id: String(i),
      label: t.players.map((p) => p.name).join(', '),
      playerIds: t.players.map((p) => p.id),
    }));
    const result = draw.match_id
      ? (db.prepare('SELECT result FROM matches WHERE id = ?').get(draw.match_id) as { result: string } | undefined)
      : undefined;
    const data = result
      ? (JSON.parse(result.result) as { winnerTeamIndex: number | null; teams: Array<{ playerIds: string[] }> })
      : null;
    const mismatch =
      data &&
      JSON.stringify(data.teams.map((t) => [...t.playerIds].sort())) !==
        JSON.stringify(outcomes.map((t) => [...t.playerIds].sort()));
    return {
      title: draw.name,
      outcomes,
      started: Boolean(result),
      finished: Boolean(result),
      winner: data?.winnerTeamIndex == null ? null : String(data.winnerTeamIndex),
      invalid: Boolean(draw.tournament_id || mismatch),
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
    return {
      title: `${tournament.name} · Match`,
      outcomes: [fixture.team_a_id, fixture.team_b_id].map((teamId) => teams.find((t) => t.id === teamId)!),
      started: fixture.played_at !== null,
      finished: Boolean(fixture.winner_team_id || fixture.is_draw),
      winner: fixture.winner_team_id,
      invalid: Boolean(fixture.is_bye || tournament.ended_early),
    };
  }
  let winner: string | null = null;
  if (tournament.status === 'completed' && !tournament.ended_early) {
    if (tournament.format === 'round_robin') {
      winner =
        computeRoundRobinStandings(
          teams.map((t) => t.id),
          fixtures
            .filter((m) => m.winner_team_id || m.is_draw)
            .map((m) => ({ teamAId: m.team_a_id!, teamBId: m.team_b_id!, winnerTeamId: m.winner_team_id })),
        )[0]?.teamId ?? null;
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
    started: fixtures.some((m) => !m.is_bye && m.played_at !== null),
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
  return db.prepare('SELECT * FROM betting_tips WHERE round_id = ? ORDER BY id').all(id) as TipRow[];
}
export function notifyBettingRound(round: BettingRound): void {
  if (round.notice_sent || round.closes_at <= Date.now() || round.status !== 'open' || !pointsAreVisible(round.event_id)) return;
  const recipients = pointParticipants(round.group_id, round.event_id).map((p) => p.id);
  notifyPlayers(
    recipients,
    {
      title: `Neue Wettmöglichkeit: ${round.title}`,
      body: `Auch Mitspieler können tippen. Tipps bis ${new Date(round.closes_at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })}.`,
      url: `/?eventId=${encodeURIComponent(round.event_id)}#points/round/${encodeURIComponent(round.id)}`,
      type: 'betting-open',
      targetId: round.id,
    },
    'direct',
    { key: `betting-open:${round.id}`, expiresAt: round.closes_at },
    { groupId: round.group_id, eventId: round.event_id },
  );
  db.prepare('UPDATE betting_rounds SET notice_sent = 1 WHERE id = ?').run(round.id);
}
export function createBettingRound(
  groupId: string,
  eventId: string,
  type: BetSource,
  sourceId: string,
  closesAt: number,
  actorId: string,
): string {
  const id = db.transaction(() => {
    requirePointsVisible(eventId);
    const settings = requirePointsOpen(eventId);
    const source = betSourceState(groupId, eventId, type, sourceId);
    if (
      source.started ||
      source.finished ||
      source.invalid ||
      source.outcomes.length < 2 ||
      source.outcomes.some((o) => !o?.playerIds.length)
    ) {
      throw new PointsError('Für diesen Wettbewerb kann keine neue Tipprunde geöffnet werden.');
    }
    if (type !== 'tournament' && source.outcomes.length !== 2)
      throw new PointsError('Match-Tipps benötigen genau zwei Seiten.');
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM betting_rounds WHERE event_id = ?').get(eventId) as {
      count: number;
    };
    if (count >= settings.max_rounds) throw new PointsError('Das Kontingent an Tipprunden ist ausgeschöpft.');
    if (
      db
        .prepare('SELECT 1 FROM betting_rounds WHERE event_id = ? AND source_type = ? AND source_id = ?')
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
  })();
  notifyBettingRound(getBettingRound(groupId, eventId, id));
  return id;
}
export function roundView(round: BettingRound, playerId: string) {
  const tips = tipsFor(round.id);
  const mine = tips.find((tip) => tip.player_id === playerId);
  const reveal = round.status !== 'open';
  const pot = tips.reduce((sum, t) => sum + t.stake, 0);
  return {
    id: round.id,
    eventId: round.event_id,
    sourceType: round.source_type,
    sourceId: round.source_id,
    title: round.title,
    status: round.status,
    closesAt: round.closes_at,
    settledAt: round.settled_at,
    revision: round.revision,
    result: round.result_key,
    pot: reveal ? pot : null,
    tipCount: reveal ? tips.length : null,
    outcomes: (JSON.parse(round.outcomes) as BetOutcome[]).map((outcome) => {
      const stake = tips.filter((t) => t.outcome_id === outcome.id).reduce((sum, t) => sum + t.stake, 0);
      const preview = mine
        ? distributePool(
            tips.map((t) => ({ id: t.id, stake: t.stake, outcomeId: t.outcome_id })),
            outcome.id,
          ).get(mine.id)
        : undefined;
      return {
        ...outcome,
        stake: reveal ? stake : null,
        odds: reveal && stake ? pot / stake : null,
        myPossiblePayout: reveal && mine?.outcome_id === outcome.id ? preview : null,
      };
    }),
    mine: mine
      ? {
          outcomeId: mine.outcome_id,
          stake: mine.stake,
          payout: mine.payout,
          net: mine.payout === null ? null : mine.payout - mine.stake,
        }
      : null,
  };
}
function sourceChanged(round: BettingRound, source: SourceState): boolean {
  const signature = (outcomes: BetOutcome[]) => outcomes.map((o) => ({ id: o.id, players: [...o.playerIds].sort() }));
  return JSON.stringify(signature(JSON.parse(round.outcomes))) !== JSON.stringify(signature(source.outcomes));
}
function closeRound(round: BettingRound, now: number): void {
  const tips = tipsFor(round.id);
  if (tips.length < 2 || new Set(tips.map((t) => t.outcome_id)).size < 2) {
    settleRound(round, null, 'Ungültiger Tipptopf', now);
    db.prepare('UPDATE betting_tips SET counts_daily = 0 WHERE round_id = ?').run(round.id);
  } else
    db.prepare("UPDATE betting_rounds SET status = 'locked', locked_at = ? WHERE id = ? AND status = 'open'").run(
      now,
      round.id,
    );
}
function settleRound(
  round: BettingRound,
  winner: string | null,
  reason: string,
  now: number,
  actorId: string | null = null,
): void {
  const tips = tipsFor(round.id);
  const valid =
    winner !== null && tips.some((t) => t.outcome_id === winner) && new Set(tips.map((t) => t.outcome_id)).size >= 2;
  const payouts = distributePool(
    tips.map((t) => ({ id: t.id, stake: t.stake, outcomeId: t.outcome_id })),
    valid ? winner : null,
  );
  for (const tip of tips) {
    const payout = payouts.get(tip.id)!;
    if (tip.player_id)
      addPointEntry(
        round.event_id,
        tip.player_id,
        payout - tip.stake,
        valid ? 'tip' : 'refund',
        `bet:${round.id}:${round.revision}:${tip.player_id}`,
        round.title,
        actorId,
        {
          roundId: round.id,
          stake: tip.stake,
          payout,
          outcomeId: tip.outcome_id,
          winner,
          reason,
          revision: round.revision,
        },
      );
    db.prepare('UPDATE betting_tips SET payout = ? WHERE id = ?').run(payout, tip.id);
  }
  db.prepare('UPDATE betting_rounds SET status = ?, result_key = ?, settled_at = ? WHERE id = ?').run(
    valid ? 'settled' : 'refunded',
    valid ? winner : null,
    now,
    round.id,
  );
}
// Invoked after competition writes, on reads, and by the deadline sweeper.
// Result corrections are handled by the explicit administrative path only.
export function reconcileBetting(eventId?: string): void {
  const rounds = (
    eventId
      ? db.prepare("SELECT * FROM betting_rounds WHERE event_id = ? AND status IN ('open','locked')").all(eventId)
      : db.prepare("SELECT * FROM betting_rounds WHERE status IN ('open','locked')").all()
  ) as BettingRound[];
  const changed: BettingRound[] = [];
  db.transaction(() => {
    for (const row of rounds) {
      let round = getBettingRound(row.group_id, row.event_id, row.id);
      let source: SourceState;
      try {
        source = betSourceState(round.group_id, round.event_id, round.source_type, round.source_id);
      } catch (e) {
        if (!(e instanceof PointsError)) throw e;
        settleRound(round, null, 'Wettbewerb entfernt', Date.now());
        changed.push(round);
        continue;
      }
      if (source.invalid || sourceChanged(round, source)) {
        settleRound(round, null, 'Wettbewerb geändert oder abgebrochen', Date.now());
        changed.push(round);
        continue;
      }
      if (round.status === 'open' && source.started) {
        // A game result arriving before a deliberate lock/deadline proves
        // no fair pre-game closure. Refund instead of paying late tips.
        settleRound(round, null, 'Spiel vor Tippschluss gestartet', Date.now());
        changed.push(round);
        continue;
      }
      if (round.status === 'open' && round.closes_at <= Date.now()) {
        closeRound(round, Date.now());
        changed.push(round);
        round = getBettingRound(round.group_id, round.event_id, round.id);
      }
      if (round.status === 'locked' && source.finished) {
        settleRound(round, source.winner, 'Spielergebnis', Date.now());
        changed.push(round);
      }
    }
  })();
  for (const round of changed) {
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status !== 'open')
      resolvePushTopic(`betting-open:${round.id}`, false, { groupId: round.group_id, eventId: round.event_id });
    broadcast(Events.leaderboardChanged, null, { groupId: round.group_id, eventId: round.event_id });
  }
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
    const settings = requirePointsOpen(eventId);
    ensurePointAccounts(eventId);
    const round = getBettingRound(groupId, eventId, roundId);
    if (round.status !== 'open' || round.closes_at <= Date.now()) throw new PointsError('Die Tipps sind geschlossen.');
    if (!pointParticipants(groupId, eventId).some((p) => p.id === playerId))
      throw new PointsError('Keine Wertungsteilnahme.', 404);
    if (!(JSON.parse(round.outcomes) as BetOutcome[]).some((o) => o.id === outcomeId))
      throw new PointsError('Ungültiger Sieger-Tipp.', 400);
    if (stake > settings.max_stake) throw new PointsError(`Höchstens ${settings.max_stake} Punkte je Runde.`, 400);
    const previous = tipsFor(round.id).find((t) => t.player_id === playerId);
    if (wallet(eventId, playerId).available + (previous?.stake ?? 0) < stake)
      throw new PointsError('Nicht genügend frei verfügbare Punkte.');
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
    const { spent } = db
      .prepare(
        `SELECT COALESCE(SUM(t.stake),0) AS spent FROM betting_tips t JOIN betting_rounds r ON r.id = t.round_id
      WHERE r.event_id = ? AND t.player_id = ? AND t.day = ? AND t.counts_daily = 1 AND r.id <> ?`,
      )
      .get(eventId, playerId, day, roundId) as { spent: number };
    if (spent + stake > settings.daily_limit) throw new PointsError('Dein Tageskontingent ist ausgeschöpft.');
    db.prepare(
      `INSERT INTO betting_tips (id,round_id,player_id,outcome_id,stake,day,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(round_id,player_id) DO UPDATE SET outcome_id=excluded.outcome_id, stake=excluded.stake, day=excluded.day, updated_at=excluded.updated_at`,
    ).run(previous?.id ?? nanoid(), round.id, playerId, outcomeId, stake, day, Date.now(), Date.now());
  })();
}
export function removeTip(groupId: string, eventId: string, roundId: string, playerId: string): void {
  reconcileBetting(eventId);
  db.transaction(() => {
    requirePointsOpen(eventId);
    const round = getBettingRound(groupId, eventId, roundId);
    if (round.status !== 'open' || round.closes_at <= Date.now()) throw new PointsError('Die Tipps sind geschlossen.');
    db.prepare('DELETE FROM betting_tips WHERE round_id = ? AND player_id = ?').run(round.id, playerId);
  })();
}
export function lockBettingRound(round: BettingRound): void {
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status !== 'open') throw new PointsError('Diese Runde ist bereits geschlossen.');
    const source = betSourceState(round.group_id, round.event_id, round.source_type, round.source_id);
    if (source.started || source.invalid || sourceChanged(round, source))
      throw new PointsError('Der Wettbewerb hat bereits begonnen oder wurde geändert.');
    closeRound(fresh, Date.now());
  })();
}
export function refundBettingRound(round: BettingRound, actorId: string, reason: string): void {
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.status !== 'open' && fresh.status !== 'locked')
      throw new PointsError('Diese Runde ist bereits abgerechnet.');
    settleRound(fresh, null, `Admin-Erstattung: ${reason}`, Date.now(), actorId);
  })();
}
// Explicitly void an invalid settlement while retaining its original tips,
// credits and reason. Result edits use the atomic rebooking path below.
export function voidBettingRound(round: BettingRound, actorId: string, reason: string, expectedRevision: number): void {
  db.transaction(() => {
    requirePointsOpen(round.event_id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (fresh.revision !== expectedRevision || fresh.status !== 'settled')
      throw new PointsError('Abrechnung inzwischen geändert oder nicht korrigierbar.');
    const old = db
      .prepare(
        "SELECT * FROM point_entries WHERE event_id = ? AND json_extract(details,'$.roundId') = ? AND json_extract(details,'$.revision') = ? AND source = 'tip'",
      )
      .all(round.event_id, round.id, round.revision) as Array<{
      id: string;
      player_id: string;
      amount: number;
    }>;
    for (const entry of old)
      addPointEntry(
        round.event_id,
        entry.player_id,
        -entry.amount,
        'reversal',
        `reverse:${entry.id}`,
        `Korrektur: ${round.title}`,
        actorId,
        { reason, roundId: round.id },
        entry.id,
      );
    db.prepare('UPDATE betting_rounds SET revision = revision + 1 WHERE id = ?').run(round.id);
    db.prepare('UPDATE betting_tips SET payout = stake WHERE round_id = ?').run(round.id);
    db.prepare("UPDATE betting_rounds SET status = 'refunded', result_key = NULL, settled_at = ? WHERE id = ?").run(
      Date.now(),
      round.id,
    );
  })();
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
  if (settledTournamentRounds(groupId, tournamentId).length)
    throw new PointsError(
      'Für dieses Turnier wurden bereits Tipps abgerechnet. Ein Admin muss betroffene Abrechnungen vor der Ergebniskorrektur mit Begründung stornieren (LAN-Punkte).',
    );
}

export function settledTournamentRounds(groupId: string, tournamentId: string): BettingRound[] {
  return db
    .prepare(
      `SELECT r.* FROM betting_rounds r WHERE r.group_id = ? AND r.status = 'settled' AND (
    (r.source_type = 'tournament' AND r.source_id = ?) OR
    (r.source_type = 'tournament_match' AND r.source_id IN (SELECT id FROM tournament_matches WHERE tournament_id = ?)))`,
    )
    .all(groupId, tournamentId, tournamentId) as BettingRound[];
}
export function settledDrawRounds(groupId: string, matchId: string): BettingRound[] {
  return db
    .prepare(
      `SELECT r.* FROM betting_rounds r JOIN matchmaking_draws d ON d.id = r.source_id
    WHERE r.source_type = 'draw' AND r.group_id = ? AND d.match_id = ? AND r.status = 'settled'`,
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
    if (
      source &&
      !source.invalid &&
      !sourceChanged(round, source) &&
      source.finished &&
      source.winner === round.result_key
    )
      continue;
    const previous = db
      .prepare(
        "SELECT id,player_id,amount FROM point_entries WHERE event_id = ? AND json_extract(details,'$.roundId') = ? AND json_extract(details,'$.revision') = ? AND source = 'tip'",
      )
      .all(round.event_id, round.id, round.revision) as Array<{
      id: string;
      player_id: string;
      amount: number;
    }>;
    for (const entry of previous)
      addPointEntry(
        round.event_id,
        entry.player_id,
        -entry.amount,
        'reversal',
        `reverse:${entry.id}`,
        `Korrektur: ${round.title}`,
        correction.actorId,
        { reason: correction.reason, roundId: round.id, revision: round.revision },
        entry.id,
      );
    db.prepare(
      "UPDATE betting_rounds SET revision = revision + 1, status = 'locked', result_key = NULL, settled_at = NULL WHERE id = ?",
    ).run(round.id);
    db.prepare('UPDATE betting_tips SET payout = NULL WHERE round_id = ?').run(round.id);
    const fresh = getBettingRound(round.group_id, round.event_id, round.id);
    if (!source || source.invalid || sourceChanged(round, source))
      settleRound(fresh, null, `Korrektur: ${correction.reason}`, Date.now(), correction.actorId);
    else if (source.finished)
      settleRound(fresh, source.winner, `Korrektur: ${correction.reason}`, Date.now(), correction.actorId);
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
