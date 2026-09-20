// Central runtime configuration. Nothing secret is hard-coded here; values come
// from environment variables so the same build runs locally and in the cloud.

import path from 'path';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function retentionDays(name: string, fallback: number): number {
  return Math.max(1, intFromEnv(name, fallback));
}

const configuredDbFile =
  process.env.DB_FILE === ':memory:'
    ? ':memory:'
    : process.env.DB_FILE
      ? path.resolve(process.env.DB_FILE)
      : path.join(__dirname, '..', 'data', 'lan.db');

const configuredDeletionLedgerFile = process.env.PRIVACY_DELETION_LEDGER_FILE
  ? path.resolve(process.env.PRIVACY_DELETION_LEDGER_FILE)
  : configuredDbFile === ':memory:'
    ? ''
    : path.join(path.dirname(configuredDbFile), 'deletion-receipts.jsonl');

export const config = {
  // Port the HTTP/WebSocket server listens on.
  port: intFromEnv('PORT', 3000),

  // Absolute path to the SQLite database file. Kept outside the repo tree by
  // default (server/data/) and gitignored. The special value ":memory:" opens
  // an in-memory database (used by the test suite for isolation).
  dbFile: configuredDbFile,

  // Persistent SQLite snapshots live beside the database by default, which
  // keeps them on the same mounted /app/data volume in production. Retention
  // bounds disk usage while preserving several independent restore points.
  backupDir: process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : configuredDbFile === ':memory:'
      ? ''
      : path.join(path.dirname(configuredDbFile), 'backups'),
  backupRetention: Math.max(1, intFromEnv('BACKUP_RETENTION', 20)),

  // Append-only, hash-only erasure ledger. Production startup requires an
  // explicit path so operators deliberately place it on storage independent
  // from the SQLite database and its backups.
  deletionLedgerFile: configuredDeletionLedgerFile,
  deletionLedgerFileExplicit: Boolean(process.env.PRIVACY_DELETION_LEDGER_FILE),

  // Public URL used inside downloaded agent configurations. This is preferred
  // over request-derived URL data when the app sits behind a reverse proxy.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, ''),

  // A player is considered "offline" if the agent hasn't reported within this
  // many milliseconds. Keeps the board honest when an agent crashes or a PC
  // is shut down without a clean stop message.
  offlineTimeoutMs: intFromEnv('OFFLINE_TIMEOUT_MS', 60_000),

  // Version currently shipped through the agent download. Diagnostics flag
  // clients on another version before a LAN starts.
  expectedAgentVersion: (process.env.EXPECTED_AGENT_VERSION ?? '1.0.0').trim(),

  // Dedicated shared-kiosk credential. It is read-only except for the narrow
  // same-device Jam recovery route documented in routes/index.ts.
  kioskToken: process.env.KIOSK_TOKEN ?? '',

  // Shared password for the automatically created per-event kiosk accounts.
  // Existing installations can keep using KIOSK_TOKEN as the password; a
  // separate value is optional when the direct legacy token should differ.
  kioskPassword: process.env.KIOSK_PASSWORD || process.env.KIOSK_TOKEN || '',

  // Session cookies are Secure by default (required for SameSite cookies to
  // survive real browsers, and this server is reachable from the cloud).
  // Set COOKIE_SECURE=0 for a plain-HTTP LAN-only deployment.
  cookieSecure: process.env.COOKIE_SECURE !== '0',

  // One-time bootstrap secret: lets the very first admin claim/register an
  // account without needing an existing admin session to issue them an
  // invite first (see accounts.ts). Empty = bootstrap via recovery code is
  // disabled entirely.
  adminRecoveryCode: process.env.ADMIN_RECOVERY_CODE ?? '',

  // Technical retention proposals, not statutory periods. Destructive
  // cleanup is opt-in so an operator can inspect /api/privacy/retention-preview
  // before enabling it. Every run is capped and safe to repeat.
  privacyRetention: {
    enabled: boolFromEnv('PRIVACY_RETENTION_ENABLED'),
    batchSize: Math.min(5_000, Math.max(1, intFromEnv('PRIVACY_RETENTION_BATCH_SIZE', 500))),
    agentDiagnosticsDays: retentionDays('PRIVACY_RETENTION_AGENT_DIAGNOSTICS_DAYS', 7),
    resolvedPushDays: retentionDays('PRIVACY_RETENTION_RESOLVED_PUSH_DAYS', 90),
    endedBroadcastDays: retentionDays('PRIVACY_RETENTION_ENDED_BROADCAST_DAYS', 180),
    resolvedFeedbackDays: retentionDays('PRIVACY_RETENTION_RESOLVED_FEEDBACK_DAYS', 365),
    auditDays: retentionDays('PRIVACY_RETENTION_AUDIT_DAYS', 365),
    endedPlaySessionsDays: retentionDays('PRIVACY_RETENTION_PLAY_SESSIONS_DAYS', 730),
  },
} as const;

// Production needs the recovery secret that bootstraps and recovers the
// first/last admin. Pure so index.ts can test this without starting.
export function productionConfigError(
  cfg: Pick<typeof config, 'adminRecoveryCode'> = config
): string | null {
  if (!cfg.adminRecoveryCode) {
    return 'NODE_ENV=production erfordert ADMIN_RECOVERY_CODE. Server wird nicht gestartet.';
  }
  return null;
}

// An unconfigured deletion ledger still works — it lands next to the SQLite
// file and therefore survives a database restore, which is the documented
// reconcile path. It does not survive losing the whole data volume, so this
// warns instead of refusing to boot: an existing installation must keep
// starting after an update, and the operator decision belongs in
// docs/privacy-and-retention.md, not in a failed deploy.
export function productionConfigWarning(
  cfg: Pick<typeof config, 'deletionLedgerFileExplicit'> = config
): string | null {
  if (!cfg.deletionLedgerFileExplicit) {
    return 'PRIVACY_DELETION_LEDGER_FILE ist nicht gesetzt. Die Löschbelege liegen neben der SQLite-Datei und überleben deren Verlust nicht. Siehe docs/privacy-and-retention.md.';
  }
  return null;
}

// Every installation needs at least one route through the login gate. A
// configured bootstrap admin is created before this check runs; afterwards
// either a claimed account or the recovery code must exist.
export function startupAccessConfigError(
  hasClaimedAdminAccount: boolean,
  cfg: Pick<typeof config, 'adminRecoveryCode'> = config,
): string | null {
  if (hasClaimedAdminAccount || cfg.adminRecoveryCode) return null;
  return 'Kein beanspruchtes Admin-Konto und kein ADMIN_RECOVERY_CODE konfiguriert. Server wird nicht gestartet.';
}
