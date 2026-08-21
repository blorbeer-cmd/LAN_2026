// Invite codes: the only way into the app for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md). purpose keeps 'register' (brand-new
// player), 'claim' (an existing, not-yet-claimed player), 'reset' (forgotten
// password) and 'test_login' (admin-minted test-player session, see
// docs/KONZEPT-TEST-USER.md) as separate code families — a stale claim link
// must never double as a password-reset master key once the account is
// claimed, so claiming voids the other outstanding claim codes for that
// player, and changing a password voids outstanding reset codes the same way.

import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { BASE_EVENT_ID, db } from './db';
import { writeAdminAudit } from './adminAudit';

// 'test_login' mints a one-time link that logs the browser in directly as an
// admin-seeded is_test player (no password) — see docs/KONZEPT-TEST-USER.md
// "Als Testspieler anmelden". Kept short-lived since, unlike claim/reset, it
// grants a session on redemption without any further credential check.
export type InvitePurpose = 'register' | 'claim' | 'reset' | 'test_login';

export const DEFAULT_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const DEFAULT_RESET_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TEST_LOGIN_TTL_MS = 15 * 60 * 1000;
export const MAX_INVITE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Registration links are reusable and remain valid until an admin revokes
// them. The existing expires_at column is kept non-null for compatibility;
// zero is the explicit no-expiry sentinel and is never exposed as a date.
export const NO_INVITE_EXPIRY = 0;

// A registration redemption needs an audit trail, but the invite code itself
// is a credential and must never be copied into admin_log. The fingerprint is
// stable for correlating usages while remaining useless for redeeming the link.
export function inviteFingerprint(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface InviteRow {
  code: string;
  purpose: InvitePurpose;
  player_id: string | null;
  event_id: string | null;
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
  eventId?: string | null;
  createdBy: string;
  expiresInMs?: number;
}

export type RegistrationInviteRevocationReason =
  | 'creator_deactivated'
  | 'creator_deleted'
  | 'creator_demoted';

export function createInvite(options: CreateInviteOptions): InviteRow {
  const code = nanoid(24);
  const now = Date.now();
  const isReusableRegistration = options.purpose === 'register' && options.expiresInMs === undefined;
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
  const expiresAt = isReusableRegistration ? NO_INVITE_EXPIRY : now + Math.min(requestedTtl, MAX_INVITE_TTL_MS);
  const eventId =
    options.eventId ?? (options.purpose === 'register' || options.purpose === 'claim' ? BASE_EVENT_ID : null);

  db.prepare(
    `INSERT INTO invites
       (code, purpose, player_id, event_id, created_by, created_at, expires_at, revoked_at, used_at, used_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(code, options.purpose, options.playerId ?? null, eventId, options.createdBy, now, expiresAt);

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
  if (invite.expires_at !== NO_INVITE_EXPIRY && invite.expires_at <= Date.now()) return undefined;
  return invite;
}

// Atomically consumes a still-valid code. The conditional UPDATE keeps this
// safe even if a handler later becomes asynchronous and two requests race.
export function markInviteUsed(code: string, usedByPlayerId: string, purpose?: InvitePurpose): boolean {
  const now = Date.now();
  const invite = db.prepare('SELECT purpose, expires_at FROM invites WHERE code = ?').get(code) as
    | { purpose: InvitePurpose; expires_at: number }
    | undefined;
  // Registration links deliberately stay open after every redemption, while
  // their expiry still limits how long they can be used. The surrounding
  // account transaction therefore shares this validation seam with the
  // one-time claim/reset/test-session links.
  if (invite?.purpose === 'register') {
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM invites
           WHERE code = ? AND used_at IS NULL AND revoked_at IS NULL
             AND (expires_at = ? OR expires_at > ?)
             ${purpose ? 'AND purpose = ?' : ''}`,
        )
        .get(...(purpose ? [code, NO_INVITE_EXPIRY, Date.now(), purpose] : [code, NO_INVITE_EXPIRY, Date.now()])),
    );
  }
  const result = db
    .prepare(
      `UPDATE invites
       SET used_at = ?, used_by = ?
       WHERE code = ?
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND (expires_at = ? OR expires_at > ?)
         ${purpose ? 'AND purpose = ?' : ''}`
    )
    .run(
      ...(purpose
        ? [now, usedByPlayerId, code, NO_INVITE_EXPIRY, now, purpose]
        : [now, usedByPlayerId, code, NO_INVITE_EXPIRY, now]),
    );
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

// Registration links are created by an account rather than targeting one.
// They therefore need their own lifecycle rule when that creator is
// deactivated, deleted, or demoted; ON DELETE SET NULL must not keep the
// credential open. Each automatic revocation gets the same fingerprinted
// audit record as a manual revocation, so the complete link lifecycle remains
// visible without ever storing the credential itself.
export function revokeRegistrationInvitesCreatedBy(
  playerId: string,
  reason: RegistrationInviteRevocationReason,
  actorPlayerId?: string,
): number {
  return db.transaction(() => {
    const invites = db
      .prepare(
        `SELECT code, event_id AS eventId, created_by AS createdBy, expires_at AS expiresAt
         FROM invites
         WHERE created_by = ? AND purpose = 'register' AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .all(playerId) as Array<{
      code: string;
      eventId: string | null;
      createdBy: string | null;
      expiresAt: number;
    }>;
    const now = Date.now();
    const revoke = db.prepare(
      `UPDATE invites SET revoked_at = ?
       WHERE code = ? AND used_at IS NULL AND revoked_at IS NULL`,
    );
    let revoked = 0;
    for (const invite of invites) {
      if (revoke.run(now, invite.code).changes !== 1) continue;
      const fingerprint = inviteFingerprint(invite.code);
      const usageRows = db
        .prepare("SELECT details FROM admin_log WHERE action = 'invite_used' AND target_type = 'registration'")
        .all() as Array<{ details: string | null }>;
      const usageCount = usageRows.reduce((count, row) => {
        if (!row.details) return count;
        try {
          const details = JSON.parse(row.details) as { inviteFingerprint?: unknown };
          return details.inviteFingerprint === fingerprint ? count + 1 : count;
        } catch {
          return count;
        }
      }, 0);
      writeAdminAudit({
        actorPlayerId,
        action: 'invite_revoked',
        targetType: 'registration',
        details: {
          purpose: 'register',
          eventId: invite.eventId,
          createdBy: invite.createdBy,
          expiresAt: invite.expiresAt === NO_INVITE_EXPIRY ? null : invite.expiresAt,
          inviteFingerprint: fingerprint,
          usageCount,
          reason,
        },
      });
      revoked += 1;
    }
    return revoked;
  })();
}
