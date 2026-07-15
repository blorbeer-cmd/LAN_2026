// In-memory login rate limiter (see docs/KONZEPT-USER-MANAGEMENT.md 5.3):
// after enough wrong passwords for one account, lock that account out for a
// while instead of letting it be brute-forced. Deliberately per-account
// only, not per-IP — a LAN party's guests can share one outbound IP (behind
// the cloud proxy), and a per-IP lock would risk locking out the whole party
// over one person's typo streak. State resets on a process restart, which is
// fine here: it only needs to survive a single sitting.

const FAILURE_THRESHOLD = 10;
const BASE_LOCKOUT_MS = 60_000;
const MAX_LOCKOUT_MS = 60 * 60_000;
const ENTRY_RETENTION_MS = 24 * 60 * 60_000;
const MAX_TRACKED_ACCOUNTS = 10_000;
const GLOBAL_AUTH_WINDOW_MS = 60_000;
const GLOBAL_AUTH_REQUESTS_PER_WINDOW = 300;

interface Entry {
  failCount: number;
  lockedUntil: number;
  lastFailureAt: number;
}

const entries = new Map<string, Entry>();
const globalAuthRequests: number[] = [];

function keyFor(name: string): string {
  return name.trim().toLowerCase();
}

export function isLoginLocked(name: string): boolean {
  const entry = entries.get(keyFor(name));
  return entry !== undefined && entry.lockedUntil > Date.now();
}

export function loginRetryAfterMs(name: string): number {
  const entry = entries.get(keyFor(name));
  if (!entry) return 0;
  return Math.max(0, entry.lockedUntil - Date.now());
}

export function recordLoginFailure(name: string): void {
  const now = Date.now();
  for (const [entryKey, entryValue] of entries) {
    if (entryValue.lastFailureAt <= now - ENTRY_RETENTION_MS) entries.delete(entryKey);
  }
  const key = keyFor(name);
  if (!entries.has(key) && entries.size >= MAX_TRACKED_ACCOUNTS) {
    let evictionKey: string | undefined;
    let oldestFailure = Number.POSITIVE_INFINITY;
    for (const [candidateKey, candidate] of entries) {
      if (candidate.lockedUntil > now || candidate.lastFailureAt >= oldestFailure) continue;
      evictionKey = candidateKey;
      oldestFailure = candidate.lastFailureAt;
    }
    if (evictionKey) entries.delete(evictionKey);
    else return;
  }
  const entry = entries.get(key) ?? { failCount: 0, lockedUntil: 0, lastFailureAt: now };
  entry.failCount += 1;
  entry.lastFailureAt = now;
  if (entry.failCount >= FAILURE_THRESHOLD) {
    const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** (entry.failCount - FAILURE_THRESHOLD), MAX_LOCKOUT_MS);
    entry.lockedUntil = now + lockoutMs;
  }
  entries.set(key, entry);
}

export function recordLoginSuccess(name: string): void {
  entries.delete(keyFor(name));
}

// Generous server-wide protection against password spraying across many
// account names. It is intentionally not IP-based because all guests may
// share one cloud-proxy address. The bounded one-minute queue cannot grow
// without limit.
export function consumeGlobalAuthRequest(now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
  while (globalAuthRequests.length > 0 && globalAuthRequests[0] <= now - GLOBAL_AUTH_WINDOW_MS) {
    globalAuthRequests.shift();
  }
  if (globalAuthRequests.length >= GLOBAL_AUTH_REQUESTS_PER_WINDOW) {
    return { allowed: false, retryAfterMs: Math.max(1, globalAuthRequests[0] + GLOBAL_AUTH_WINDOW_MS - now) };
  }
  globalAuthRequests.push(now);
  return { allowed: true, retryAfterMs: 0 };
}
