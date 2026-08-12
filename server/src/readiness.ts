import { config } from './config';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { getBackupStatus } from './backupService';

export type ReadinessState = 'ready' | 'warning' | 'error';

export interface ReadinessCheck {
  id: 'database' | 'event' | 'agents' | 'process-mappings' | 'kiosk' | 'backup';
  label: string;
  status: ReadinessState;
  summary: string;
  details: string[];
}

interface RelevantEvent {
  id: string;
  name: string;
  starts_at: number;
  tracking_enabled: number;
}

interface AgentRow {
  name: string;
  agent_version: string | null;
  last_report_at: number | null;
}

function relevantEvent(groupId: string, now: number): RelevantEvent | undefined {
  return db
    .prepare(
      `SELECT id, name, starts_at, tracking_enabled
       FROM events
       WHERE group_id = ? AND id NOT IN (?, ?) AND ended_at IS NULL AND status != 'cancelled'
       ORDER BY tracking_enabled DESC,
                CASE WHEN starts_at >= ? THEN 0 ELSE 1 END,
                CASE WHEN starts_at >= ? THEN starts_at END ASC,
                starts_at DESC
       LIMIT 1`,
    )
    .get(groupId, OUTSIDE_EVENTS_ID, BASE_EVENT_ID, now, now) as RelevantEvent | undefined;
}

function eventCheck(groupId: string, now: number): ReadinessCheck {
  const event = relevantEvent(groupId, now);
  if (!event) {
    return {
      id: 'event',
      label: 'Event',
      status: 'warning',
      summary: 'Kein bevorstehendes oder laufendes Event vorhanden.',
      details: ['Lege ein Event an und prüfe anschließend die Teilnehmerliste.'],
    };
  }
  const participants = (
    db
      .prepare("SELECT COUNT(*) AS count FROM event_participants ep WHERE ep.event_id = ? AND ep.status = 'accepted'")
      .get(event.id) as { count: number }
  ).count;
  return {
    id: 'event',
    label: 'Event',
    status: participants > 0 ? 'ready' : 'warning',
    summary: `${event.name}: ${event.tracking_enabled ? 'Tracking läuft' : 'Tracking noch nicht gestartet'} · ${participants} bestätigt`,
    details: participants > 0 ? [] : ['Noch keine bestätigte Person in der Teilnehmerliste.'],
  };
}

function agentsCheck(groupId: string, now: number): ReadinessCheck {
  const rows = db
    .prepare(
      `SELECT p.name, d.agent_version, d.last_report_at
       FROM group_memberships gm
       JOIN players p ON p.id = gm.player_id
       LEFT JOIN agent_diagnostics d ON d.player_id = p.id
       WHERE gm.group_id = ? AND gm.status = 'active'
         AND p.deactivated_at IS NULL AND p.is_test = 0
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all(groupId) as AgentRow[];
  const installed = rows.filter((row) => row.last_report_at !== null);
  const online = installed.filter((row) => now - row.last_report_at! <= config.offlineTimeoutMs);
  const missing = rows.filter((row) => row.last_report_at === null).map((row) => row.name);
  const offline = installed.filter((row) => now - row.last_report_at! > config.offlineTimeoutMs);
  const outdated = installed.filter((row) => row.agent_version !== config.expectedAgentVersion);
  const details: string[] = [];
  if (missing.length) details.push(`Ohne Agent-Report: ${missing.join(', ')}`);
  if (offline.length) details.push(`Agent offline: ${offline.map((row) => row.name).join(', ')}`);
  if (outdated.length) {
    details.push(
      `Abweichende Version (erwartet v${config.expectedAgentVersion}): ${outdated
        .map((row) => `${row.name} (${row.agent_version ? `v${row.agent_version}` : 'unbekannt'})`)
        .join(', ')}`,
    );
  }
  if (rows.length === 0) details.push('Noch keine aktiven echten Personen in der Gruppe.');
  return {
    id: 'agents',
    label: 'Agenten',
    status: rows.length > 0 && online.length === rows.length && outdated.length === 0 ? 'ready' : 'warning',
    summary: `${online.length}/${rows.length} online · ${installed.length}/${rows.length} eingerichtet`,
    details,
  };
}

function processMappingsCheck(groupId: string): ReadinessCheck {
  const rows = db
    .prepare(
      `SELECT g.name, COUNT(gpn.id) AS mapping_count
       FROM games g
       LEFT JOIN game_process_names gpn ON gpn.game_id = g.id AND gpn.group_id = g.group_id
       WHERE g.group_id = ? AND g.arcade_key IS NULL AND g.status = 'catalog'
       GROUP BY g.id
       ORDER BY g.name COLLATE NOCASE`,
    )
    .all(groupId) as Array<{ name: string; mapping_count: number }>;
  const missing = rows.filter((row) => row.mapping_count === 0).map((row) => row.name);
  return {
    id: 'process-mappings',
    label: 'Spielerkennung',
    status: missing.length === 0 ? 'ready' : 'warning',
    summary: `${rows.length - missing.length}/${rows.length} Katalogspiele mit Prozess-Zuordnung`,
    details: missing.length ? [`Ohne Zuordnung: ${missing.join(', ')}`] : [],
  };
}

function kioskCheck(groupId: string): ReadinessCheck {
  const persisted = (
    db.prepare('SELECT COUNT(*) AS count FROM kiosk_tokens WHERE group_id = ? AND revoked_at IS NULL').get(groupId) as {
      count: number;
    }
  ).count;
  const environmentToken = groupId === DEFAULT_GROUP_ID && Boolean(config.kioskToken);
  const configured = persisted + (environmentToken ? 1 : 0);
  return {
    id: 'kiosk',
    label: 'Kiosk',
    status: configured > 0 ? 'ready' : 'warning',
    summary: configured > 0 ? `${configured} aktiver Kiosk-Zugang` : 'Kein aktiver Kiosk-Zugang.',
    details: configured > 0 ? [] : ['Erzeuge in den Einstellungen einen Kiosk-Link, bevor der TV aufgebaut wird.'],
  };
}

async function backupCheck(): Promise<ReadinessCheck> {
  let status: Awaited<ReturnType<typeof getBackupStatus>>;
  try {
    status = await getBackupStatus();
  } catch (error) {
    return {
      id: 'backup',
      label: 'Backup',
      status: 'error',
      summary: 'Der Backup-Status konnte nicht gelesen werden.',
      details: [error instanceof Error ? error.message : 'Unbekannter Backup-Fehler'],
    };
  }
  if (!status.available) {
    return {
      id: 'backup',
      label: 'Backup',
      status: 'warning',
      summary: 'Datei-Backups sind für diese Laufzeit nicht verfügbar.',
      details: [],
    };
  }
  if (status.lastFailure && (!status.latest || status.lastFailure.at > status.latest.createdAt)) {
    return {
      id: 'backup',
      label: 'Backup',
      status: 'error',
      summary: 'Beim letzten Backup-Lauf ist ein Betriebsfehler aufgetreten.',
      details: [
        `Fehlerzeitpunkt: ${new Date(status.lastFailure.at).toISOString()}`,
        `Fehler: ${status.lastFailure.message}`,
      ],
    };
  }
  if (!status.latest) {
    return {
      id: 'backup',
      label: 'Backup',
      status: 'warning',
      summary: 'Noch kein persistenter Snapshot vorhanden.',
      details: [`Es werden bis zu ${status.retention} Snapshots aufbewahrt.`],
    };
  }
  return {
    id: 'backup',
    label: 'Backup',
    status: 'ready',
    summary: `Letzter Snapshot: ${status.latest.kind === 'pre-event' ? 'vor Eventstart' : 'manuell'}`,
    details: [
      `Erstellt: ${new Date(status.latest.createdAt).toISOString()}`,
      `Größe: ${status.latest.sizeBytes} Bytes · Aufbewahrung: ${status.retention}`,
    ],
  };
}

export async function getReadiness(groupId: string): Promise<{
  generatedAt: number;
  overall: ReadinessState;
  checks: ReadinessCheck[];
}> {
  const now = Date.now();
  db.prepare('SELECT 1').get();
  const checks: ReadinessCheck[] = [
    { id: 'database', label: 'Server & Datenbank', status: 'ready', summary: 'Server und SQLite antworten.', details: [] },
    eventCheck(groupId, now),
    agentsCheck(groupId, now),
    processMappingsCheck(groupId),
    kioskCheck(groupId),
    await backupCheck(),
  ];
  const overall = checks.some((check) => check.status === 'error')
    ? 'error'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ready';
  return { generatedAt: now, overall, checks };
}
