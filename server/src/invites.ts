// Invite codes: the only way into the app for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md). purpose keeps 'register' (brand-new
// player), 'claim' (an existing, not-yet-claimed player), 'reset' (forgotten
// password) and 'test_login' (admin-minted test-player session, see
// docs/KONZEPT-TEST-USER.md) as separate code families — a stale claim link
// must never double as a password-reset master key once the account is
// claimed, so claiming voids the other outstanding claim codes for that
// player, and changing a password voids outstanding reset codes the same way.

import { nanoid } from 'nanoid';
import { db } from './db';

// 'test_login' mints a one-time link that logs the browser in directly as an
// admin-seeded is_test player (no password) — see docs/KONZEPT-TEST-USER.md
// "Als Testspieler anmelden". Kept short-lived since, unlike claim/reset, it
// grants a session on redemption without any further credential check.
export type InvitePurpose = 'register' | 'claim' | 'reset' | 'test_login';

export const DEFAULT_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const DEFAULT_RESET_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TEST_LOGIN_TTL_MS = 15 * 60 * 1000;
export const MAX_INVITE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface InviteRow {
  code: string;
  purpose: InvitePurpose;
  player_id: string | null;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  used_at: number | null;
  used_by: string | null;
}

export interface CreateInviteOptions {
  purpose: InvitePurpose;
  playerId?: string | null;
  createdBy: string;
  expiresInMs?: number;
}

export function createInvite(options: CreateInviteOptions): InviteRow {
  const code = nanoid(24);
  const now = Date.now();
  const defaultTtl =
    options.purpose === 'reset'
      ? DEFAULT_RESET_TTL_MS
      : options.purpose === 'test_login'
        ? DEFAULT_TEST_LOGIN_TTL_MS
        : DEFAULT_INVITE_TTL_MS;
  const requestedTtl = options.expiresInMs ?? defaultTtl;
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
    throw new RangeError('Invite expiry must be a positive, finite duration.');
  }
  const expiresAt = now + Math.min(requestedTtl, MAX_INVITE_TTL_MS);

  db.prepare(
    'INSERT INTO invites (code, purpose, player_id, created_by, created_at, expires_at, revoked_at, used_at, used_by) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)'
  ).run(code, options.purpose, options.playerId ?? null, options.createdBy, now, expiresAt);

  return db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow;
}

// Looks up a code and validates it against the expected purpose without
// consuming it — callers still need to check whatever purpose-specific
// preconditions apply (e.g. claim requires an unclaimed player) before
// calling markInviteUsed.
export function findValidInvite(code: string, purpose: InvitePurpose): InviteRow | undefined {
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow | undefined;
  if (!invite || invite.purpose !== purpose) return undefined;
  if (invite.used_at || invite.revoked_at) return undefined;
  if (invite.expires_at <= Date.now()) return undefined;
  return invite;
}

// Atomically consumes a still-valid code. The conditional UPDATE keeps this
// safe even if a handler later becomes asynchronous and two requests race.
export function markInviteUsed(code: string, usedByPlayerId: string, purpose?: InvitePurpose): boolean {
  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE invites
       SET used_at = ?, used_by = ?
       WHERE code = ?
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > ?
         ${purpose ? 'AND purpose = ?' : ''}`
    )
    .run(...(purpose ? [now, usedByPlayerId, code, now, purpose] : [now, usedByPlayerId, code, now]));
  return result.changes === 1;
}

export function revokeInvite(code: string): boolean {
  const result = db.prepare('UPDATE invites SET revoked_at = ? WHERE code = ? AND used_at IS NULL AND revoked_at IS NULL').run(
    Date.now(),
    code
  );
  return result.changes > 0;
}

// Called after a successful claim/reset so an old, still-valid link of the
// same purpose can never be replayed against the account afterwards.
export function voidOutstandingInvites(playerId: string, purpose: InvitePurpose): void {
  db.prepare(
    'UPDATE invites SET revoked_at = ? WHERE player_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL'
  ).run(Date.now(), playerId, purpose);
}
