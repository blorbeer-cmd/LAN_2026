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

interface Entry {
  failCount: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

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
  const key = keyFor(name);
  const entry = entries.get(key) ?? { failCount: 0, lockedUntil: 0 };
  entry.failCount += 1;
  if (entry.failCount >= FAILURE_THRESHOLD) {
    const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** (entry.failCount - FAILURE_THRESHOLD), MAX_LOCKOUT_MS);
    entry.lockedUntil = Date.now() + lockoutMs;
  }
  entries.set(key, entry);
}

export function recordLoginSuccess(name: string): void {
  entries.delete(keyFor(name));
}
