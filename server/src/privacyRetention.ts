import { config } from './config';
import { db } from './db';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SWEEP_INTERVAL_MS = DAY_MS;

export interface RetentionPreview {
  enabled: boolean;
  batchSize: number;
  generatedAt: number;
  policies: Array<{
    key: string;
    purpose: string;
    retentionDays: number | null;
    candidateCount: number;
    protection: string;
  }>;
}

function count(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

export function previewPrivacyRetention(now = Date.now()): RetentionPreview {
  const policy = config.privacyRetention;
  const diagnosticsCutoff = now - policy.agentDiagnosticsDays * DAY_MS;
  const pushCutoff = now - policy.resolvedPushDays * DAY_MS;
  const broadcastCutoff = now - policy.endedBroadcastDays * DAY_MS;
  const feedbackCutoff = now - policy.resolvedFeedbackDays * DAY_MS;
  const auditCutoff = now - policy.auditDays * DAY_MS;
  const sessionsCutoff = now - policy.endedPlaySessionsDays * DAY_MS;
  return {
    enabled: policy.enabled,
    batchSize: policy.batchSize,
    generatedAt: now,
    policies: [
      {
        key: 'expired_sessions',
        purpose: 'Abgelaufene Browser-Sitzungen entfernen',
        retentionDays: null,
        candidateCount: count('SELECT COUNT(*) AS count FROM sessions WHERE expires_at <= ?', now),
        protection: 'Nur bereits abgelaufene Sitzungen.',
      },
      {
        key: 'agent_diagnostics',
        purpose: 'Veraltete technische Agent-Erreichbarkeit entfernen',
        retentionDays: policy.agentDiagnosticsDays,
        candidateCount: count('SELECT COUNT(*) AS count FROM agent_diagnostics WHERE last_report_at < ?', diagnosticsCutoff),
        protection: 'Aktuelle Agent-Meldungen bleiben erhalten; Prozessnamen existieren nur mit gültigem Tracking-Kontext.',
      },
      {
        key: 'resolved_push',
        purpose: 'Erledigte oder abgelaufene Benachrichtigungen begrenzen',
        retentionDays: policy.resolvedPushDays,
        candidateCount: count(
          `SELECT COUNT(*) AS count FROM push_log
           WHERE created_at < ? AND (resolved_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?))`,
          pushCutoff,
          now,
        ),
        protection: 'Offene, noch gültige Benachrichtigungen bleiben erhalten.',
      },
      {
        key: 'ended_broadcasts',
        purpose: 'Beendete persönliche Rundrufe begrenzen',
        retentionDays: policy.endedBroadcastDays,
        candidateCount: count(
          'SELECT COUNT(*) AS count FROM broadcasts WHERE ended_at IS NOT NULL AND ended_at < ?',
          broadcastCutoff,
        ),
        protection: 'Aktive Rundrufe bleiben erhalten.',
      },
      {
        key: 'resolved_feedback',
        purpose: 'Erledigtes freiwilliges Feedback begrenzen',
        retentionDays: policy.resolvedFeedbackDays,
        candidateCount: count(
          'SELECT COUNT(*) AS count FROM feedback_entries WHERE resolved_at IS NOT NULL AND resolved_at < ?',
          feedbackCutoff,
        ),
        protection: 'Noch offenes Feedback bleibt erhalten.',
      },
      {
        key: 'admin_audit',
        purpose: 'Technische Änderungsnachweise zeitlich begrenzen',
        retentionDays: policy.auditDays,
        candidateCount: count(
          "SELECT COUNT(*) AS count FROM admin_log WHERE created_at < ? AND target_type != 'deleted_account'",
          auditCutoff,
        ),
        protection: 'Hashbasierte Löschbelege für die Wiederherstellung sind ausgenommen. Die Frist ist ein technischer Vorschlag.',
      },
      {
        key: 'ended_play_sessions',
        purpose: 'Alte Spielzeit-Rohdaten abgeschlossener Events entfernen',
        retentionDays: policy.endedPlaySessionsDays,
        candidateCount: count(
          `SELECT COUNT(*) AS count
           FROM play_sessions ps JOIN events e ON e.id = ps.event_id
           WHERE ps.ended_at IS NOT NULL AND ps.ended_at < ?
             AND (e.status IN ('ended', 'cancelled') OR e.ended_at IS NOT NULL)`,
          sessionsCutoff,
        ),
        protection: 'Laufende Sitzungen sowie offene und laufende Events sind ausgeschlossen.',
      },
    ],
  };
}

function deleteBatch(table: string, where: string, params: unknown[], limit: number): number {
  const result = db
    .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ?)`)
    .run(...params, limit);
  return result.changes;
}

export function runPrivacyRetention(now = Date.now()): Record<string, number> {
  if (!config.privacyRetention.enabled) return {};
  const policy = config.privacyRetention;
  return db.transaction(() => ({
    expiredSessions: deleteBatch('sessions', 'expires_at <= ?', [now], policy.batchSize),
    agentDiagnostics: deleteBatch(
      'agent_diagnostics',
      'last_report_at < ?',
      [now - policy.agentDiagnosticsDays * DAY_MS],
      policy.batchSize,
    ),
    resolvedPush: deleteBatch(
      'push_log',
      'created_at < ? AND (resolved_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?))',
      [now - policy.resolvedPushDays * DAY_MS, now],
      policy.batchSize,
    ),
    endedBroadcasts: deleteBatch(
      'broadcasts',
      'ended_at IS NOT NULL AND ended_at < ?',
      [now - policy.endedBroadcastDays * DAY_MS],
      policy.batchSize,
    ),
    resolvedFeedback: deleteBatch(
      'feedback_entries',
      'resolved_at IS NOT NULL AND resolved_at < ?',
      [now - policy.resolvedFeedbackDays * DAY_MS],
      policy.batchSize,
    ),
    adminAudit: deleteBatch(
      'admin_log',
      "created_at < ? AND target_type != 'deleted_account'",
      [now - policy.auditDays * DAY_MS],
      policy.batchSize,
    ),
    endedPlaySessions: deleteBatch(
      'play_sessions',
      `ended_at IS NOT NULL AND ended_at < ?
       AND event_id IN (
         SELECT id FROM events WHERE status IN ('ended', 'cancelled') OR ended_at IS NOT NULL
       )`,
      [now - policy.endedPlaySessionsDays * DAY_MS],
      policy.batchSize,
    ),
  }))();
}

export function startPrivacyRetention(): () => void {
  if (!config.privacyRetention.enabled) return () => undefined;
  const run = () => {
    try {
      runPrivacyRetention();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Privacy retention sweep failed:', error);
    }
  };
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
