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

  // Optional PIN behind the admin-gated endpoints (grant admin, seed test
  // users). Empty = open mode: the guard lets everyone through. The frontend
  // currently never asks for a PIN — admin mode is a one-tap toggle (see
  // docs/KONZEPT-TEST-USER.md) — so leave this empty until the PIN prompt
  // returns; with a PIN set, admin actions from the UI would just fail.
  adminPin: process.env.ADMIN_PIN ?? '',

  // Whether real per-user login is enforced anywhere yet. 'legacy' (default)
  // keeps today's behavior untouched — the new /api/auth/* endpoints exist
  // and work, but nothing else requires a session. Feature routes start
  // gating on this once identity is wired through them (see
  // docs/KONZEPT-USER-MANAGEMENT.md phase 2+); introduced now so that work
  // doesn't need a second config plumbing pass.
  authMode: (process.env.AUTH_MODE === 'required' ? 'required' : 'legacy') as 'legacy' | 'required',

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

// In production (the public-internet deploy) an empty ACCESS_TOKEN silently
// means "no protection" — fine for a LAN party run by hand, a
// launch-blocking footgun for a 24/7 public host. ADMIN_PIN is deliberately
// NOT required while the admin PIN is retired (see adminPin above). Pure so
// index.ts's boot check is directly unit-testable without spawning a real
// process.
export function productionConfigError(
  cfg: Pick<typeof config, 'accessToken' | 'adminPin'> = config
): string | null {
  if (!cfg.accessToken) {
    return 'NODE_ENV=production erfordert ACCESS_TOKEN. Server wird nicht gestartet.';
  }
  return null;
}
