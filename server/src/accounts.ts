// Password hashing for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md). Uses Node's built-in scrypt rather than
// pulling in bcrypt/argon2. The self-describing hash format allows a later
// cost increase without invalidating existing passwords.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { db } from './db';

const KEY_LENGTH = 64;
// Node's scrypt defaults (N=16384, r=8, p=1), retained for this phase while
// hashing is synchronous. A cost increase must move hashing off the event
// loop first so login traffic cannot stall the LAN server. Parameters are
// stored with each hash so that migration remains possible.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// This private LAN deployment intentionally imposes no minimum password
// length beyond "not empty" — the operator has decided a friend-group
// instance needs no length or composition rule. A single character is
// accepted. The upper bound stays so a pathological input can't turn scrypt
// hashing into a denial-of-service.
export const MIN_PASSWORD_LENGTH = 1;
export const MAX_PASSWORD_LENGTH = 200;

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH;
}

// Format: scrypt$N$r$p$saltHex$hashHex — self-describing so verification
// never depends on module-level constants matching whatever hashed it.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = parseInt(nStr, 10);
  const r = parseInt(rStr, 10);
  const p = parseInt(pStr, 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A fixed, never-matching hash to run verifyPassword against when the
// looked-up account doesn't exist (or has no password yet) — keeps the
// login endpoint's response time the same in both cases, so a timing
// difference can't be used to enumerate valid usernames.
const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'));

export function verifyPasswordConstantTime(password: string, stored: string | null): boolean {
  if (!stored) {
    verifyPassword(password, DUMMY_HASH);
    return false;
  }
  return verifyPassword(password, stored);
}

// Whether any account has both been claimed (has a password) and holds the
// admin flag. Used by the register/claim bootstrap path (see routes/auth.ts)
// to decide whether the recovery code is still allowed to mint the first
// admin, or whether that door should already be closed.
export function hasClaimedAdmin(): boolean {
  const row = db
    .prepare('SELECT 1 FROM players WHERE is_admin = 1 AND password_hash IS NOT NULL AND deactivated_at IS NULL LIMIT 1')
    .get();
  return Boolean(row);
}
