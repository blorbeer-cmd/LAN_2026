import { nanoid } from 'nanoid';
import { db } from './db';
import { PointsError, requirePointsOpen, isPointsEvent } from './points';
import { requirePointsAdmin } from './pointsAccess';

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
function unavailable(): never { throw new PointsError('Meldbarer Eintrag nicht gefunden.', 404); }
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
    const actors = db.prepare(`SELECT actor_player_id FROM admin_log WHERE group_id=? AND target_type='points_journal' AND target_id=?`)
      .all(groupId, id) as Array<{ actor_player_id: string | null }>;
    return { title: row.title, subjects: [row.player_id, ...actors.flatMap((a) => a.actor_player_id ? [a.actor_player_id] : [])] };
  }
  if (type === 'match') {
    const row = db.prepare(`SELECT m.result,m.created_by,g.name FROM matches m JOIN games g ON g.id=m.game_id
      WHERE m.id=? AND m.event_id=? AND m.group_id=?`).get(id, eventId, groupId) as
      { result: string; created_by: string | null; name: string } | undefined;
    if (!row) unavailable();
    const result = JSON.parse(row.result) as { teams?: Array<{ playerIds?: string[] }> };
    return { title: `Spielergebnis: ${row.name}`, subjects: [...(row.created_by ? [row.created_by] : []),
      ...(result.teams ?? []).flatMap((team) => team.playerIds ?? [])] };
  }
  if (type === 'todo') {
    const task = db.prepare(`SELECT title,created_by,assignee_id,batch_id FROM checklist_tasks
      WHERE id=? AND event_id=? AND group_id=? AND type='todo'`).get(id, eventId, groupId) as
      { title: string; created_by: string; assignee_id: string | null; batch_id: string | null } | undefined;
    if (!task) unavailable();
    const related = task.batch_id ? db.prepare(`SELECT created_by,assignee_id FROM checklist_tasks
      WHERE group_id=? AND event_id=? AND batch_id=?`).all(groupId, eventId, task.batch_id) as
      Array<{ created_by: string; assignee_id: string | null }> : [task];
    return { title: `To-do: ${task.title}`, subjects: related.flatMap((row) => [row.created_by, ...(row.assignee_id ? [row.assignee_id] : [])]) };
  }
  if (type === 'tip') {
    const tip = db.prepare(`SELECT r.title,t.player_id FROM betting_tips t JOIN betting_rounds r ON r.id=t.round_id
      WHERE t.id=? AND r.event_id=? AND r.group_id=?`).get(id, eventId, groupId) as
      { title: string; player_id: string | null } | undefined;
    if (!tip || (actorId && tip.player_id !== actorId && !admins(groupId).includes(actorId))) unavailable();
    return { title: `Tipp: ${tip.title}`, subjects: tip.player_id ? [tip.player_id] : [] };
  }
  const round = db.prepare(`SELECT title,created_by,outcomes FROM betting_rounds WHERE id=? AND event_id=? AND group_id=?`)
    .get(id, eventId, groupId) as { title: string; created_by: string | null; outcomes: string } | undefined;
  if (!round) unavailable();
  const tips = db.prepare('SELECT player_id FROM betting_tips WHERE round_id=? AND player_id IS NOT NULL').all(id) as Array<{ player_id: string }>;
  const outcomes = JSON.parse(round.outcomes) as Array<{ playerIds: string[] }>;
  return { title: `Wettmarkt: ${round.title}`, subjects: [...(round.created_by ? [round.created_by] : []),
    ...tips.map((tip) => tip.player_id), ...outcomes.flatMap((outcome) => outcome.playerIds)] };
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
  const candidates = new Set([...admins(report.group_id), ...(creator?.created_by ? [creator.created_by] : [])]);
  return [...candidates].filter((id) => !excluded.has(id) && Boolean(db.prepare(`SELECT 1 FROM group_memberships gm
    JOIN players p ON p.id=gm.player_id WHERE gm.group_id=? AND gm.player_id=? AND gm.status='active' AND p.deactivated_at IS NULL`)
    .get(report.group_id, id)));
}
function view(report: ReportRow) {
  return { id: report.id, targetType: report.target_type, targetId: report.target_id, title: report.title,
    reason: report.reason, status: report.status, createdAt: report.created_at,
    resolvedAt: report.resolved_at, resolution: report.resolution };
}
export function readPointsReports(groupId: string, eventId: string, actorId: string) {
  const reports = db.prepare('SELECT * FROM points_reports WHERE group_id=? AND event_id=? ORDER BY created_at DESC,rowid DESC')
    .all(groupId, eventId) as ReportRow[];
  const canResolve = admins(groupId).includes(actorId);
  return {
    own: reports.filter((report) => report.reporter_id === actorId).map(view),
    inbox: reports.filter((report) => pointsReportRecipients(report).includes(actorId)).map((report) => ({
      ...view(report), canResolve,
      reporter: report.reporter_id ? db.prepare('SELECT id,name FROM players WHERE id=?').get(report.reporter_id) ?? null : null,
    })),
  };
}
export function createPointsReport(groupId: string, eventId: string, actorId: string, input: Record<string, unknown>) {
  const type = input.targetType;
  if (!['journal','match','tip','betting_round','todo'].includes(type as string) || typeof input.targetId !== 'string' || !input.targetId)
    throw new PointsError('Bitte einen meldbaren Eintrag wählen.', 400);
  const reason = optionalText(input.reason);
  return db.transaction(() => {
    if (!isPointsEvent(eventId)) throw new PointsError('Meldungen sind nur für reguläre LAN-Wertungen möglich.', 409);
    requirePointsOpen(eventId);
    const target = source(groupId, eventId, type as PointsReportTarget, input.targetId as string, actorId);
    if (db.prepare(`SELECT 1 FROM points_reports WHERE event_id=? AND reporter_id=? AND target_type=? AND target_id=? AND status='open'`)
      .get(eventId, actorId, type, input.targetId)) throw new PointsError('Du hast diesen Eintrag bereits gemeldet.');
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
