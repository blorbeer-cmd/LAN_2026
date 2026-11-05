import { nanoid } from 'nanoid';
import { db } from './db';
import { PointsError, requirePointsOpen, isPointsEvent } from './points';
import { requirePointsAdmin } from './pointsAccess';
import { todoSourceKey } from './todoPoints';

export type PointsReportTarget = 'journal' | 'match' | 'tip' | 'betting_round' | 'todo';
interface ReportSource { title: string; subjects: string[] }
interface ReportRow {
  id: string; group_id: string; event_id: string; reporter_id: string | null;
  target_type: PointsReportTarget; target_id: string; title: string; reason: string;
  status: 'open' | 'corrected' | 'dismissed'; created_at: number;
  resolved_at: number | null; resolved_by: string | null; resolution: string;
}

function optionalText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > 300)
    throw new PointsError('Bitte höchstens 300 Zeichen eingeben.', 400);
  return value.trim();
}
function unavailable(): never { throw new PointsError('Meldbare Punktevergabe nicht gefunden.', 404); }
// Source actions are shortcuts to an existing points assignment, not a
// general complaint about a player, event, task or competition.
function bookedPlayers(eventId: string, sourceKey: string, playerId: string | null = null): string[] {
  return (db.prepare(`SELECT DISTINCT s.player_id FROM points_sources s JOIN points_journal j ON j.source_id=s.id
    WHERE s.event_id=? AND s.source_key=? AND (? IS NULL OR s.player_id=?)`)
    .all(eventId, sourceKey, playerId, playerId) as Array<{ player_id: string }>).map((row) => row.player_id);
}
function assignment(title: string, players: string[], actorId?: string): ReportSource {
  if (actorId && !players.length) unavailable();
  return { title, subjects: players };
}
function admins(groupId: string): string[] {
  return (db.prepare(`SELECT gm.player_id FROM group_memberships gm JOIN players p ON p.id=gm.player_id
    WHERE gm.group_id=? AND gm.status='active' AND gm.role IN ('owner','admin') AND p.deactivated_at IS NULL`)
    .all(groupId) as Array<{ player_id: string }>).map((row) => row.player_id);
}
function source(groupId: string, eventId: string, type: PointsReportTarget, id: string,
  actorId?: string): ReportSource {
  if (type === 'journal') {
    const row = db.prepare(`SELECT j.title,s.player_id FROM points_journal j JOIN points_sources s ON s.id=j.source_id
      JOIN events e ON e.id=s.event_id WHERE j.id=? AND s.event_id=? AND e.group_id=?`)
      .get(id, eventId, groupId) as { title: string; player_id: string } | undefined;
    if (!row || (actorId && row.player_id !== actorId && !admins(groupId).includes(actorId))) unavailable();
    return { title: `Punktebuchung: ${row.title}`, subjects: [row.player_id] };
  }
  if (type === 'match') {
    const row = db.prepare(`SELECT g.name FROM matches m JOIN games g ON g.id=m.game_id
      WHERE m.id=? AND m.event_id=? AND m.group_id=?`).get(id, eventId, groupId) as
      { name: string } | undefined;
    if (!row) unavailable();
    return assignment(`Punkte zum Spielergebnis: ${row.name}`, bookedPlayers(eventId, `match:${id}`), actorId);
  }
  if (type === 'todo') {
    const task = db.prepare(`SELECT id,title,batch_id FROM checklist_tasks
      WHERE id=? AND event_id=? AND group_id=? AND type='todo'`).get(id, eventId, groupId) as
      { id: string; title: string; batch_id: string | null } | undefined;
    if (!task) unavailable();
    return assignment(`Orga-Punkte zum To-do: ${task.title}`, bookedPlayers(eventId, todoSourceKey(task)), actorId);
  }
  if (type === 'tip') {
    const tip = db.prepare(`SELECT r.id AS round_id,r.title,r.status,t.player_id FROM betting_tips t JOIN betting_rounds r ON r.id=t.round_id
      WHERE t.id=? AND r.event_id=? AND r.group_id=?`).get(id, eventId, groupId) as
      { round_id: string; title: string; status: string; player_id: string | null } | undefined;
    if (!tip || (actorId && tip.player_id !== actorId && !admins(groupId).includes(actorId))) unavailable();
    if (actorId) {
      if (!['settled','refunded'].includes(tip.status) || !tip.player_id) unavailable();
    }
    return assignment(`Wettabrechnung: ${tip.title}`, tip.player_id ? bookedPlayers(eventId, `bet:${tip.round_id}`, tip.player_id) : [], actorId);
  }
  const round = db.prepare(`SELECT title,status FROM betting_rounds WHERE id=? AND event_id=? AND group_id=?`)
    .get(id, eventId, groupId) as { title: string; status: string } | undefined;
  if (!round) unavailable();
  if (actorId) {
    if (!['settled','refunded'].includes(round.status)) unavailable();
  }
  return assignment(`Wettabrechnung: ${round.title}`, bookedPlayers(eventId, `bet:${id}`), actorId);
}

// Keep the original subjects even after a source changes or disappears. Add
// current subjects at read time so changing a source cannot unlock its report.
function subjects(report: ReportRow): Set<string> {
  const stored = db.prepare('SELECT player_id FROM points_report_subjects WHERE report_id=?').all(report.id) as Array<{ player_id: string }>;
  let current: string[] = [];
  try { current = source(report.group_id, report.event_id, report.target_type, report.target_id).subjects; }
  catch (error) { if (!(error instanceof PointsError) || error.status !== 404) throw error; }
  return new Set([...stored.map((row) => row.player_id), ...current]);
}
export function pointsReportRecipients(report: ReportRow): string[] {
  const creator = db.prepare('SELECT created_by FROM events WHERE id=? AND group_id=?').get(report.event_id, report.group_id) as
    { created_by: string | null } | undefined;
  const excluded = subjects(report);
  const reviewers = admins(report.group_id);
  const candidates = new Set([...reviewers, ...(creator?.created_by ? [creator.created_by] : [])]);
  return [...candidates].filter((id) => (!excluded.has(id) || (reviewers.length === 1 && reviewers[0] === id)) && Boolean(db.prepare(`SELECT 1 FROM group_memberships gm
    JOIN players p ON p.id=gm.player_id WHERE gm.group_id=? AND gm.player_id=? AND gm.status='active' AND p.deactivated_at IS NULL`)
    .get(report.group_id, id)));
}
function view(report: ReportRow) {
  return { id: report.id, targetType: report.target_type, targetId: report.target_id, title: report.title,
    reason: report.reason, status: report.status, createdAt: report.created_at,
    resolvedAt: report.resolved_at, resolution: report.resolution };
}
export function canReportPointsAssignment(groupId: string, eventId: string, actorId: string, type: string, id: string): boolean {
  if (!['journal','match','tip','betting_round','todo'].includes(type) || !isPointsEvent(eventId)) return false;
  try { requirePointsOpen(eventId); source(groupId, eventId, type as PointsReportTarget, id, actorId); return true; }
  catch (error) { if (error instanceof PointsError) return false; throw error; }
}
export function readPointsReports(groupId: string, eventId: string, actorId: string) {
  const reports = db.prepare('SELECT * FROM points_reports WHERE group_id=? AND event_id=? ORDER BY created_at DESC,rowid DESC')
    .all(groupId, eventId) as ReportRow[];
  const canResolve = admins(groupId).includes(actorId);
  return {
    own: reports.filter((report) => report.reporter_id === actorId).map(view),
    inbox: reports.filter((report) => pointsReportRecipients(report).includes(actorId)).map((report) => {
      const anonymous = subjects(report).has(actorId);
      // Free text and exact submission times can identify the sender just as
      // directly as a name. Self-review exposes only the disputed assignment.
      return { ...view(report), canResolve, anonymous,
        reason: anonymous ? '' : report.reason, createdAt: anonymous ? null : report.created_at,
        resolvedAt: anonymous ? null : report.resolved_at, resolution: anonymous ? '' : report.resolution,
        reporter: !anonymous && report.reporter_id ? db.prepare('SELECT id,name FROM players WHERE id=?').get(report.reporter_id) ?? null : null };
    }),
  };
}
export function createPointsReport(groupId: string, eventId: string, actorId: string, input: Record<string, unknown>) {
  const type = input.targetType;
  if (!['journal','match','tip','betting_round','todo'].includes(type as string) || typeof input.targetId !== 'string' || !input.targetId)
    throw new PointsError('Bitte eine konkrete Punktevergabe wählen.', 400);
  const reason = optionalText(input.reason);
  return db.transaction(() => {
    if (!isPointsEvent(eventId)) throw new PointsError('Meldungen sind nur für reguläre LAN-Wertungen möglich.', 409);
    requirePointsOpen(eventId);
    const target = source(groupId, eventId, type as PointsReportTarget, input.targetId as string, actorId);
    if (db.prepare(`SELECT 1 FROM points_reports WHERE event_id=? AND reporter_id=? AND target_type=? AND target_id=? AND status='open'`)
      .get(eventId, actorId, type, input.targetId)) throw new PointsError('Du hast diese Punktevergabe bereits gemeldet.');
    const id = nanoid();
    db.prepare(`INSERT INTO points_reports(id,group_id,event_id,reporter_id,target_type,target_id,title,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, groupId, eventId, actorId, type, input.targetId, target.title, reason, Date.now());
    for (const subject of new Set(target.subjects)) {
      // Historical sources can retain references to erased accounts.
      if (db.prepare('SELECT 1 FROM players WHERE id=?').get(subject))
        db.prepare('INSERT INTO points_report_subjects(report_id,player_id) VALUES(?,?)').run(id, subject);
    }
    const report = db.prepare('SELECT * FROM points_reports WHERE id=?').get(id) as ReportRow;
    return { report: view(report), recipients: [...new Set([actorId, ...pointsReportRecipients(report)])] };
  }).immediate();
}
export function resolvePointsReport(groupId: string, eventId: string, actorId: string, id: string, input: Record<string, unknown>) {
  if (input.status !== 'corrected' && input.status !== 'dismissed') throw new PointsError('Ungültiger Meldungsstatus.', 400);
  const resolution = optionalText(input.resolution);
  return db.transaction(() => {
    requirePointsOpen(eventId);
    requirePointsAdmin(groupId, actorId);
    const report = db.prepare('SELECT * FROM points_reports WHERE id=? AND group_id=? AND event_id=?').get(id, groupId, eventId) as ReportRow | undefined;
    if (!report || !pointsReportRecipients(report).includes(actorId)) throw new PointsError('Meldung nicht gefunden.', 404);
    const updated = db.prepare(`UPDATE points_reports SET status=?,resolved_at=?,resolved_by=?,resolution=? WHERE id=? AND status='open'`)
      .run(input.status, Date.now(), actorId, resolution, id);
    if (!updated.changes) throw new PointsError('Diese Meldung wurde bereits abgeschlossen.');
    return { recipients: [...new Set([...(report.reporter_id ? [report.reporter_id] : []), ...pointsReportRecipients(report)])] };
  }).immediate();
}
