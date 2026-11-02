import { Router } from 'express';
import { db } from '../db';
import { requireGroupRole } from '../groupAuthorization';
import { requireGroupEventAccess, resolveRequestGroupEventScope } from '../groupEventScope';
import {
  ensurePointAccounts,
  pointParticipants,
  pointParticipantCount,
  isPointsEvent,
  pointStandings,
  PointsError,
  pointsSettings,
  requirePointsOpen,
  requirePointsVisible,
  wallet,
  walletEntries,
  BETTING_START_POINTS,
  BETTING_MAX_STAKE,
  bettingParticipation,
  pointsSnapshotRules,
  readPointsSnapshot,
  hydratePointStandings,
} from '../points';
import {
  createBettingRound,
  getBettingRound,
  lockBettingRound,
  notifyBettingRound,
  putTip,
  reconcileBetting,
  publishBettingChanges,
  refundBettingRound,
  removeTip,
  roundView,
  voidBettingRound,
  type BetSource,
  type BettingRound,
} from '../betting';
import { broadcast, Events } from '../realtime';
import { writeAdminAudit } from '../adminAudit';
import { resolvePushTopic } from '../push';
import { correctJournalEntry } from '../pointsAdministration';
import { syncCompetitionPoints } from '../orgaPoints';
import { readPointsBalances, readPointsJournal } from '../pointsJournal';
import { canReportPointsAssignment, createPointsReport, readPointsReports, resolvePointsReport } from '../pointsReports';

export const pointsRouter = Router();
pointsRouter.use((req, res, next) => {
  if (!req.player || !req.group) return res.status(401).json({ error: 'Nicht angemeldet.' });
  let eventId: string | null;
  if (req.query.eventId !== undefined) {
    if (typeof req.query.eventId !== 'string' || !req.query.eventId)
      return res.status(400).json({ error: 'Ungültiges Event.' });
    eventId = req.query.eventId;
  } else {
    const scope = resolveRequestGroupEventScope(req, undefined);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    eventId = scope.eventId;
  }
  if (!requireGroupEventAccess(req, res, eventId)) return;
  res.locals.eventId = eventId;
  next();
});

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new PointsError(`${label}: ganze Zahl zwischen ${min} und ${max} erforderlich.`, 400);
  }
  return value;
}
function text(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new PointsError(`${label} ist erforderlich (höchstens ${max} Zeichen).`, 400);
  return value.trim();
}
pointsRouter.get('/', (req, res) => {
  const eventId = res.locals.eventId as string;
  if (!['owner', 'admin'].includes(req.groupMembership!.role)) requirePointsVisible(eventId);
  // Source mutations and startup synchronize category awards; SQLite triggers
  // fund late participants immediately. Deadlines are handled by the sweep and
  // betting mutations. A client refresh must not recompute or write these data.
  const settings = pointsSettings(eventId) ?? null;
  const entries = walletEntries(eventId, req.player!.id);
  const rounds = (
    db
      .prepare('SELECT * FROM betting_rounds WHERE event_id = ? ORDER BY created_at DESC')
      .all(eventId) as BettingRound[]
  ).map((r) => roundView(r, req.player!.id));
  const standings = pointStandings(eventId);
  res.json({
    eventId,
    categoryBalances: readPointsBalances(req.group!.id, eventId, req.player!.id),
    categoryJournal: readPointsJournal(req.group!.id, eventId, req.player!.id),
    settings,
    wallet: wallet(eventId, req.player!.id),
    bettingParticipation: bettingParticipation(eventId, req.player!.id),
    entries,
    rounds,
    standings,
    participantCount: pointParticipantCount(eventId),
    categoryStanding: standings.find((row) => row.playerId === req.player!.id) ?? null,
    revisions: db.prepare('SELECT revision,created_at AS createdAt FROM points_snapshots WHERE event_id=? ORDER BY revision DESC').all(eventId),
  });
});
pointsRouter.get('/reports', (req, res) => {
  const eventId = res.locals.eventId as string;
  if (!isPointsEvent(eventId)) throw new PointsError('LAN-Wertung nicht gefunden.', 404);
  res.json({ ...readPointsReports(req.group!.id, eventId, req.player!.id),
    canReport: Boolean(pointsSettings(eventId) && pointsSettings(eventId)!.closed_at === null) });
});
pointsRouter.get('/reports/targets/:type/:id', (req, res) => {
  res.json({ canReport: canReportPointsAssignment(req.group!.id, res.locals.eventId, req.player!.id, req.params.type, req.params.id) });
});
pointsRouter.post('/reports', (req, res) => {
  const eventId = res.locals.eventId as string;
  const result = createPointsReport(req.group!.id, eventId, req.player!.id, req.body ?? {});
  // A personal inbox may be open for an inactive event. Send no event or
  // report identifiers; its next read rechecks the selected event's access.
  broadcast(Events.pointsReportsChanged, null, { groupId: req.group!.id, recipientPlayerIds: result.recipients });
  res.status(201).json(result.report);
});
pointsRouter.post('/reports/:id/resolve', (req, res) => {
  const eventId = res.locals.eventId as string;
  const result = resolvePointsReport(req.group!.id, eventId, req.player!.id, req.params.id, req.body ?? {});
  broadcast(Events.pointsReportsChanged, null, { groupId: req.group!.id, recipientPlayerIds: result.recipients });
  res.json({ ok: true });
});
pointsRouter.put('/settings', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  const body = req.body ?? {};
  const initial = BETTING_START_POINTS;
  if (body.initialPoints !== undefined && body.initialPoints !== initial)
    throw new PointsError('Das Wett-Startguthaben beträgt fest 100 Punkte.', 400);
  const maxStake = BETTING_MAX_STAKE;
  if (body.maxStake !== undefined && body.maxStake !== maxStake)
    throw new PointsError('Der maximale Einsatz beträgt fest 20 Punkte pro Wettmarkt.', 400);
  const prizeInfo = body.prizeInfo ?? pointsSettings(eventId)?.prize_info ?? '';
  if (typeof prizeInfo !== 'string' || prizeInfo.trim().length > 300)
    throw new PointsError('Preisinfo: höchstens 300 Zeichen.', 400);
  const event = db
    .prepare("SELECT id FROM events WHERE id = ? AND group_id = ? AND event_type_key = 'lan' AND is_test = 0 AND status = 'published'")
    .get(eventId, req.group!.id);
  if (!event) throw new PointsError('Die Punktewertung ist für veröffentlichte LAN-Events vorgesehen.', 400);
  db.transaction(() => {
    const previous = pointsSettings(eventId);
    if (previous && previous.closed_at !== null) throw new PointsError('Die Punktewertung ist abgeschlossen.');
    if (previous?.configured_at != null && initial !== previous.initial_points)
      throw new PointsError('Der Grundstock kann nach Aktivierung nicht geändert werden.');
    db.prepare(
      `INSERT INTO points_settings (event_id,group_id,initial_points,orga_budget,max_stake,created_at,prize_info)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET orga_budget=excluded.orga_budget,
      initial_points=excluded.initial_points,configured_at=COALESCE(points_settings.configured_at,excluded.created_at),
      max_stake=excluded.max_stake,prize_info=excluded.prize_info`,
    ).run(eventId, req.group!.id, initial, 0, maxStake, Date.now(), prizeInfo.trim());
    ensurePointAccounts(eventId);
  })();
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: req.group!.id,
    action: 'points_configured',
    targetType: 'event',
    targetId: eventId,
    details: {
      initialPoints: initial,
      maxStake,
      dailyLimit: null,
      maxRounds: null,
      prizeInfo: prizeInfo.trim(),
    },
  });
  broadcast(Events.eventsChanged, null, { groupId: req.group!.id, eventId });
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json(pointsSettings(eventId));
});
pointsRouter.get('/snapshots', (req, res) => {
  const eventId = res.locals.eventId as string;
  if (!isPointsEvent(eventId)) throw new PointsError('LAN-Wertung nicht gefunden.', 404);
  if (!['owner', 'admin'].includes(req.groupMembership!.role)) requirePointsVisible(eventId);
  res.json({ revisions: db.prepare('SELECT revision,created_at AS createdAt FROM points_snapshots WHERE event_id=? ORDER BY revision DESC').all(eventId) });
});
pointsRouter.get('/snapshots/:revision', (req, res) => {
  const eventId = res.locals.eventId as string;
  if (!isPointsEvent(eventId)) throw new PointsError('LAN-Wertung nicht gefunden.', 404);
  if (!['owner', 'admin'].includes(req.groupMembership!.role)) requirePointsVisible(eventId);
  if (!/^[1-9]\d*$/.test(req.params.revision) || !Number.isSafeInteger(Number(req.params.revision)))
    throw new PointsError('Ungültige Abschlussversion.', 400);
  const snapshot = readPointsSnapshot(eventId, Number(req.params.revision));
  if (!snapshot) throw new PointsError('Abschlussversion nicht gefunden.', 404);
  res.json({ eventId, ...snapshot, standings: hydratePointStandings(snapshot.standings) });
});
pointsRouter.post('/tasks/:id/reward', requireGroupRole('admin'), (_req, res) => {
  res.status(409).json({ error: 'To-dos bringen fest 3 Orga-Punkte. Einzelne Belohnungen werden nicht mehr festgelegt.' });
});
pointsRouter.get('/admin/entries', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  res.json({ entries: walletEntries(eventId), participants: pointParticipants(req.group!.id, eventId) });
});
pointsRouter.get('/admin/journal', requireGroupRole('admin'), (req, res) => {
  if (syncCompetitionPoints(req.group!.id, res.locals.eventId))
    broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId: res.locals.eventId });
  const entries = db.prepare(`SELECT j.*, s.player_id AS playerId, p.name AS playerName,
      s.account, s.source_key AS sourceKey, a.actor_player_id AS actorId, actor.name AS actorName
    FROM points_journal j JOIN points_sources s ON s.id = j.source_id JOIN players p ON p.id = s.player_id
    JOIN events event ON event.id = s.event_id AND event.group_id = ?
    LEFT JOIN admin_log a ON a.target_id = j.id AND a.target_type = 'points_journal' AND a.action IN ('category_points_corrected','betting_journal_corrected')
    LEFT JOIN players actor ON actor.id = a.actor_player_id
    WHERE s.event_id = ? ORDER BY j.created_at DESC, j.rowid DESC`).all(req.group!.id, res.locals.eventId);
  res.json({ entries });
});
pointsRouter.post('/admin/journal/:id/correct', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  const result = correctJournalEntry({ groupId: req.group!.id, eventId, actorId: req.player!.id, entryId: req.params.id,
    total: req.body?.total, expectedRevision: req.body?.revision, reason: req.body?.reason });
  if (result.changed) broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json(result);
});
pointsRouter.post('/entries/:id/deduct', requireGroupRole('admin'), (_req, res) => {
  res.status(409).json({ error: 'Wettguthaben wird ausschließlich durch Marktkorrektur oder Storno korrigiert.' });
});
pointsRouter.post('/rounds', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  requirePointsVisible(eventId);
  const type = req.body?.sourceType;
  if (!['draw', 'tournament_match', 'tournament'].includes(type)) throw new PointsError('Ungültige Wettart.', 400);
  const closesAt = integer(req.body?.closesAt, 'Tippschluss', Date.now() + 1000, Date.now() + 7 * 86400000);
  const id = createBettingRound(
    req.group!.id,
    eventId,
    type as BetSource,
    text(req.body?.sourceId, 'Wettbewerb', 100),
    closesAt,
    req.player!.id,
  );
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: req.group!.id,
    action: 'betting_round_opened',
    targetType: 'betting_round',
    targetId: id,
    details: { sourceType: type, sourceId: req.body.sourceId, closesAt },
  });
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.status(201).json(roundView(getBettingRound(req.group!.id, eventId, id), req.player!.id));
});
pointsRouter.put('/rounds/:id/tip', (req, res) => {
  const eventId = res.locals.eventId as string;
  putTip(
    req.group!.id,
    eventId,
    req.params.id,
    req.player!.id,
    text(req.body?.outcomeId, 'Sieger', 100),
    integer(req.body?.stake, 'Einsatz', 1, 1000),
  );
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json(roundView(getBettingRound(req.group!.id, eventId, req.params.id), req.player!.id));
});
pointsRouter.delete('/rounds/:id/tip', (req, res) => {
  requirePointsVisible(res.locals.eventId);
  removeTip(req.group!.id, res.locals.eventId, req.params.id, req.player!.id);
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId: res.locals.eventId });
  res.json({ ok: true });
});
pointsRouter.post('/rounds/:id/lock', (req, res) => {
  const eventId = res.locals.eventId as string;
  if (!['owner', 'admin'].includes(req.groupMembership!.role)) requirePointsVisible(eventId);
  const round = getBettingRound(req.group!.id, eventId, req.params.id);
  const participating = (JSON.parse(round.outcomes) as Array<{ playerIds: string[] }>).some((o) =>
    o.playerIds.includes(req.player!.id),
  );
  if (!participating && !['admin', 'owner'].includes(req.groupMembership!.role))
    return res.status(403).json({ error: 'Nur Mitspieler oder Admins können das Spiel starten.' });
  lockBettingRound(round);
  resolvePushTopic(`betting-open:${round.id}`, false, { groupId: req.group!.id, eventId });
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json({ ok: true });
});
pointsRouter.post('/rounds/:id/refund', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  refundBettingRound(
    getBettingRound(req.group!.id, eventId, req.params.id),
    req.player!.id,
    text(req.body?.reason, 'Begründung'),
  );
  resolvePushTopic(`betting-open:${req.params.id}`, false, { groupId: req.group!.id, eventId });
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json({ ok: true });
});
pointsRouter.post('/reopen', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  const reason = text(req.body?.reason, 'Begründung');
  db.transaction(() => {
    const reopened = db.prepare('UPDATE points_settings SET closed_at = NULL WHERE event_id = ? AND closed_at IS NOT NULL').run(eventId);
    if (!reopened.changes) throw new PointsError('Die Punktewertung ist nicht abgeschlossen.');
    ensurePointAccounts(eventId);
    syncCompetitionPoints(req.group!.id, eventId);
    writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: req.group!.id,
    action: 'points_reopened',
    targetType: 'event',
    targetId: eventId,
    details: { reason },
    });
  }).immediate();
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json({ ok: true });
});

pointsRouter.post('/rounds/:id/void', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  const reason = text(req.body?.reason, 'Begründung');
  voidBettingRound(
    getBettingRound(req.group!.id, eventId, req.params.id),
    req.player!.id,
    reason,
    integer(req.body?.revision, 'Abrechnungsversion', 0, 1000000),
  );
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json({ ok: true });
});

pointsRouter.post('/close', requireGroupRole('admin'), (req, res) => {
  const eventId = res.locals.eventId as string;
  if (!isPointsEvent(eventId)) throw new PointsError('Die Punktewertung gilt nur für reguläre veröffentlichte LANs.');
  const changedRounds = db.transaction(() => {
    requirePointsOpen(eventId);
    if (db.prepare("SELECT 1 FROM points_reports WHERE event_id=? AND status='open'").get(eventId))
      throw new PointsError('Bitte zuerst alle offenen Punktefehler-Meldungen abschließen.');
    const changed = reconcileBetting(eventId, false);
    const unresolved = db.prepare("SELECT * FROM betting_rounds WHERE event_id=? AND status IN ('open','locked')").all(eventId) as BettingRound[];
    for (const round of unresolved) {
      refundBettingRound(round, req.player!.id, 'LAN-Endwertung festgeschrieben: kein abgerechnetes Ergebnis');
      changed.push(round);
    }
    syncCompetitionPoints(req.group!.id, eventId);
    ensurePointAccounts(eventId);
    const standings = pointStandings(eventId).map(({ name: _name, color: _color, ...row }) => row);
    const { revision } = db
      .prepare('SELECT COALESCE(MAX(revision),0) + 1 AS revision FROM points_snapshots WHERE event_id = ?')
      .get(eventId) as { revision: number };
    db.prepare('INSERT INTO points_snapshots (event_id,revision,standings,actor_id,created_at) VALUES (?,?,?,?,?)').run(
      eventId,
      revision,
      JSON.stringify({ version: 2, participantCount: pointParticipantCount(eventId), rules: pointsSnapshotRules(), standings }),
      req.player!.id,
      Date.now(),
    );
    db.prepare('UPDATE points_settings SET closed_at = ? WHERE event_id = ?').run(Date.now(), eventId);
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: req.group!.id,
      action: 'points_closed',
      targetType: 'event',
      targetId: eventId,
      details: { revision },
    });
    return changed;
  }).immediate();
  publishBettingChanges(changedRounds);
  broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id, eventId });
  res.json({ ok: true });
});

const reportedBettingFailures = new Set<string>();
// The fast tick reads due events without taking a write lock. The slower
// recovery pass also discovers legacy sources/results without a browser.
export function sweepBetting(now = Date.now(), recoverSources = false): void {
  const events = db.prepare(`SELECT DISTINCT e.id FROM events e JOIN points_settings s ON s.event_id=e.id
    WHERE EXISTS (SELECT 1 FROM betting_rounds r WHERE r.event_id=e.id AND (
      (r.status='open' AND r.closes_at>0 AND r.closes_at<=?) OR
      (?=1 AND r.status IN ('open','locked'))))
      OR (?=1 AND s.closed_at IS NULL AND s.visible=1 AND e.event_type_key='lan' AND e.is_test=0
        AND e.status='published' AND e.ended_at IS NULL)`)
    .all(now, Number(recoverSources), Number(recoverSources)) as Array<{ id: string }>;
  for (const event of events) {
    try {
      reconcileBetting(event.id);
      reportedBettingFailures.delete(event.id);
    } catch (error) {
      if (!reportedBettingFailures.has(event.id)) {
        console.error(`Betting reconciliation failed for event ${event.id}:`, error);
        reportedBettingFailures.add(event.id);
      }
    }
  }
  for (const round of db.prepare("SELECT * FROM betting_rounds WHERE status='open' AND notice_sent=0")
    .all() as BettingRound[]) notifyBettingRound(round);
}

export function startBettingSweep(): () => void {
  let lastRecovery = 0;
  const run = () => {
    try {
      const now = Date.now();
      const recover = now - lastRecovery >= 30_000;
      if (recover) lastRecovery = now;
      sweepBetting(now, recover);
    } catch (error) {
      console.error('Betting sweep failed:', error);
    }
  };
  run();
  const timer = setInterval(run, 1000);
  timer.unref();
  return () => clearInterval(timer);
}

pointsRouter.use(
  (
    error: unknown,
    _req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    if (error instanceof PointsError) return res.status(error.status).json({ error: error.message });
    next(error);
  },
);
