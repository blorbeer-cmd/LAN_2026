// Central runtime configuration. Nothing secret is hard-coded here; values come
// from environment variables so the same build runs locally and in the cloud.

import path from 'path';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseAuthMode(value: string | undefined): 'legacy' | 'required' {
  if (value === undefined || value === '' || value === 'legacy') return 'legacy';
  if (value === 'required') return 'required';
  throw new Error(`Ungültiger AUTH_MODE "${value}". Erlaubt sind "legacy" und "required".`);
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

  // Shared access token protecting the whole app (light protection because the
  // server is reachable from the cloud). If empty, access protection is OFF.
  accessToken: process.env.ACCESS_TOKEN ?? '',

  // Public URL used inside downloaded agent configurations. This is preferred
  // over request-derived URL data when the app sits behind a reverse proxy.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, ''),

  // A player is considered "offline" if the agent hasn't reported within this
  // many milliseconds. Keeps the board honest when an agent crashes or a PC
  // is shut down without a clean stop message.
  offlineTimeoutMs: intFromEnv('OFFLINE_TIMEOUT_MS', 60_000),

  // 'legacy' (default) preserves the pre-account behavior. 'required' makes
  // session identity and roles authoritative across feature/admin routes.
  authMode: parseAuthMode(process.env.AUTH_MODE),

  // Dedicated read-only credential for the shared kiosk in required mode.
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

// Production must have one complete access model: legacy needs its shared
// token; required auth needs the recovery secret that bootstraps and recovers
// the first/last admin. Pure so index.ts can test this without starting.
export function productionConfigError(
  cfg: Pick<typeof config, 'accessToken' | 'authMode' | 'adminRecoveryCode'> = config
): string | null {
  if (cfg.authMode === 'required') {
    if (!cfg.adminRecoveryCode) {
      return 'AUTH_MODE=required erfordert ADMIN_RECOVERY_CODE. Server wird nicht gestartet.';
    }
  } else if (!cfg.accessToken) {
    return 'NODE_ENV=production erfordert ACCESS_TOKEN. Server wird nicht gestartet.';
  }
  return null;
}
