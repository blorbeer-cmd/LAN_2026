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

  // A player is considered "offline" if the agent hasn't reported within this
  // many milliseconds. Keeps the board honest when an agent crashes or a PC
  // is shut down without a clean stop message.
  offlineTimeoutMs: intFromEnv('OFFLINE_TIMEOUT_MS', 60_000),

  // Optional PIN that unlocks admin mode (bulk-create test users, grant admin,
  // moderate). Empty = dev/open mode: unlocking always succeeds, so local
  // testing needs no secret. Set it in the live deployment to keep admin
  // actions to whoever knows the PIN. Deliberately separate from the shared
  // ACCESS_TOKEN (that gates the whole UI; this gates the admin-only extras).
  adminPin: process.env.ADMIN_PIN ?? '',
} as const;

// In production (the public-internet deploy) an empty ACCESS_TOKEN/ADMIN_PIN
// silently means "no protection" — fine for a LAN party run by hand, a
// launch-blocking footgun for a 24/7 public host. Pure so index.ts's boot
// check is directly unit-testable without spawning a real process.
export function productionConfigError(
  cfg: Pick<typeof config, 'accessToken' | 'adminPin'> = config
): string | null {
  const missing = [
    !cfg.accessToken && 'ACCESS_TOKEN',
    !cfg.adminPin && 'ADMIN_PIN',
  ].filter((v): v is string => Boolean(v));
  if (missing.length === 0) return null;
  return `NODE_ENV=production erfordert ${missing.join(' und ')}. Server wird nicht gestartet.`;
}
