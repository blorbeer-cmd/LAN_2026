// Central runtime configuration. Nothing secret is hard-coded here; values come
// from environment variables so the same build runs locally and in the cloud.

import path from 'path';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  // Port the HTTP/WebSocket server listens on.
  port: intFromEnv('PORT', 3000),

  // Absolute path to the SQLite database file. Kept outside the repo tree by
  // default (server/data/) and gitignored. The special value ":memory:" opens
  // an in-memory database (used by the test suite for isolation).
  dbFile:
    process.env.DB_FILE === ':memory:'
      ? ':memory:'
      : process.env.DB_FILE
        ? path.resolve(process.env.DB_FILE)
        : path.join(__dirname, '..', 'data', 'lan.db'),

  // Public URL used inside downloaded agent configurations. This is preferred
  // over request-derived URL data when the app sits behind a reverse proxy.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, ''),

  // A player is considered "offline" if the agent hasn't reported within this
  // many milliseconds. Keeps the board honest when an agent crashes or a PC
  // is shut down without a clean stop message.
  offlineTimeoutMs: intFromEnv('OFFLINE_TIMEOUT_MS', 60_000),

  // Dedicated read-only credential for the shared kiosk.
  kioskToken: process.env.KIOSK_TOKEN ?? '',

  // Session cookies are Secure by default (required for SameSite cookies to
  // survive real browsers, and this server is reachable from the cloud).
  // Set COOKIE_SECURE=0 for a plain-HTTP LAN-only deployment.
  cookieSecure: process.env.COOKIE_SECURE !== '0',

  // One-time bootstrap secret: lets the very first admin claim/register an
  // account without needing an existing admin session to issue them an
  // invite first (see accounts.ts). Empty = bootstrap via recovery code is
  // disabled entirely.
  adminRecoveryCode: process.env.ADMIN_RECOVERY_CODE ?? '',
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
