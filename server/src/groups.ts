import { db, DEFAULT_GROUP_ID } from './db';
import { config } from './config';
import { writeAdminAudit } from './adminAudit';

export { DEFAULT_GROUP_ID };

export type GroupRole = 'owner' | 'admin' | 'member';
export type GroupMembershipStatus = 'invited' | 'active' | 'removed' | 'left';

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: number;
  archived_at: number | null;
}

export interface GroupMembershipRow {
  group_id: string;
  player_id: string;
  role: GroupRole;
  status: GroupMembershipStatus;
  joined_at: number | null;
  ended_at: number | null;
  outside_tracking_enabled: number;
  invited_by: string | null;
}

export function getGroup(groupId: string): GroupRow | undefined {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as GroupRow | undefined;
}

export function getGroupMembership(groupId: string, playerId: string): GroupMembershipRow | undefined {
  return db.prepare('SELECT * FROM group_memberships WHERE group_id = ? AND player_id = ?').get(groupId, playerId) as
    GroupMembershipRow | undefined;
}

// Fan-out targets for player-lifecycle broadcasts (deactivation, profile
// changes, tracking pause): every non-archived group whose roster this player
// belongs to. Legacy players without membership rows fall back to the default
// group so their board still refreshes.
export function activePlayerGroupIds(playerId: string): string[] {
  const rows = db
    .prepare(
      `SELECT gm.group_id AS id
       FROM group_memberships gm
       JOIN groups g ON g.id = gm.group_id AND g.archived_at IS NULL
       WHERE gm.player_id = ? AND gm.status = 'active'`,
    )
    .all(playerId) as Array<{ id: string }>;
  return rows.length > 0 ? rows.map((row) => row.id) : [DEFAULT_GROUP_ID];
}

export function listGroupsForPlayer(
  playerId: string,
): Array<GroupRow & { role: GroupRole; outsideTrackingEnabled: boolean }> {
  return db
    .prepare(
      `SELECT g.*, gm.role, gm.outside_tracking_enabled AS outsideTrackingEnabled
       FROM groups g
       JOIN group_memberships gm ON gm.group_id = g.id
       WHERE gm.player_id = ? AND gm.status = 'active' AND g.archived_at IS NULL
       ORDER BY g.created_at, g.name COLLATE NOCASE`,
    )
    .all(playerId)
    .map((row) => {
      const typed = row as GroupRow & { role: GroupRole; outsideTrackingEnabled: number };
      return { ...typed, outsideTrackingEnabled: Boolean(typed.outsideTrackingEnabled) };
    });
}

// Every account in the compatibility period belongs to the migrated default
// group. A fresh database has no owner until its first real account is
// bootstrapped; that account becomes owner atomically here.
export function ensureDefaultGroupMembership(playerId: string): GroupMembershipRow {
  return db.transaction(() => {
    const player = db
      .prepare('SELECT id, is_test, deactivated_at, tracking_paused, password_hash FROM players WHERE id = ?')
      .get(playerId) as
      | {
          id: string;
          is_test: number;
          deactivated_at: number | null;
          tracking_paused: number;
          password_hash: string | null;
        }
      | undefined;
    if (!player || player.deactivated_at !== null)
      throw new Error('Active player required for default group membership');

    const hasOwner = Boolean(
      db
        .prepare("SELECT 1 FROM group_memberships WHERE group_id = ? AND status = 'active' AND role = 'owner'")
        .get(DEFAULT_GROUP_ID),
    );
    const existing = getGroupMembership(DEFAULT_GROUP_ID, playerId);
    // Legacy players are backfilled before they claim their personal account.
    // The first successful real claim therefore already has a membership but
    // must still become owner when the migrated group has none.
    if (existing) {
      if (!hasOwner && !player.is_test && player.password_hash) {
        db.prepare(
          `UPDATE group_memberships
           SET role = 'owner', status = 'active', ended_at = NULL, joined_at = COALESCE(joined_at, ?)
           WHERE group_id = ? AND player_id = ?`,
        ).run(Date.now(), DEFAULT_GROUP_ID, playerId);
        syncInstanceAdminForRole(DEFAULT_GROUP_ID, playerId, 'owner', playerId);
        return getGroupMembership(DEFAULT_GROUP_ID, playerId)!;
      }
      return existing;
    }

    const role: GroupRole = !hasOwner && !player.is_test ? 'owner' : 'member';
    const now = Date.now();
    db.prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, ?, 'active', ?, NULL, ?, NULL)`,
    ).run(DEFAULT_GROUP_ID, playerId, role, now, player.tracking_paused ? 0 : 1);
    syncInstanceAdminForRole(DEFAULT_GROUP_ID, playerId, role, playerId);
    if (player.is_test) {
      db.prepare('UPDATE players SET test_owner_group_id = ? WHERE id = ?').run(DEFAULT_GROUP_ID, playerId);
    }
    db.prepare(`INSERT OR IGNORE INTO group_tracking_consents
      (id, group_id, player_id, granted_at, revoked_at, source) VALUES (?, ?, ?, ?, NULL, 'migration')`)
      .run(`default-${playerId}`, DEFAULT_GROUP_ID, playerId, now);
    return getGroupMembership(DEFAULT_GROUP_ID, playerId)!;
  })();
}

export function updateGroupDetails(
  groupId: string,
  fields: { name?: string; description?: string | null },
): GroupRow | undefined {
  const existing = getGroup(groupId);
  if (!existing || existing.archived_at !== null) return undefined;
  db.prepare('UPDATE groups SET name = ?, description = ? WHERE id = ?').run(
    fields.name ?? existing.name,
    fields.description !== undefined ? fields.description : existing.description,
    groupId,
  );
  return getGroup(groupId);
}

export type MembershipMutationResult =
  | { ok: true; membership: GroupMembershipRow }
  | { ok: false; code: 'not_found' | 'forbidden' | 'last_owner' | 'test_role' | 'self_removal' };

function activeOwnerCount(groupId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM group_memberships gm
         JOIN players p ON p.id = gm.player_id
         WHERE gm.group_id = ? AND gm.status = 'active' AND gm.role = 'owner'
           AND p.deactivated_at IS NULL`,
      )
      .get(groupId) as { count: number }
  ).count;
}

// Required mode freezes group role (owner/admin/member) as the instance
// rights model (see docs/plans/reset-single-group.md §9.1). players.is_admin
// — the separate flag still gating account-management routes (invites,
// backup, (de)activation, see auth.ts/players.ts) — is derived from it here
// instead of staying independently settable, so the two can no longer
// silently diverge. Scoped to the one real group on purpose: a hypothetical
// future secondary group must not be able to grant instance-wide rights.
// Legacy mode keeps is_admin a directly togglable flag and is untouched.
function syncInstanceAdminForRole(groupId: string, playerId: string, role: GroupRole, actorPlayerId?: string): void {
  if (config.authMode !== 'required' || groupId !== DEFAULT_GROUP_ID) return;
  const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId) as
    { is_admin: number } | undefined;
  if (!player) return;
  const nextIsAdmin = role === 'member' ? 0 : 1;
  if (nextIsAdmin === player.is_admin) return;
  db.prepare('UPDATE players SET is_admin = ? WHERE id = ?').run(nextIsAdmin, playerId);
  writeAdminAudit({
    actorPlayerId,
    action: nextIsAdmin ? 'admin_granted' : 'admin_revoked',
    targetType: 'player',
    targetId: playerId,
    details: { via: 'group_role', role },
  });
}

export function changeGroupMemberRole(
  groupId: string,
  actorPlayerId: string,
  targetPlayerId: string,
  nextRole: GroupRole,
): MembershipMutationResult {
  return db.transaction(() => {
    const actor = getGroupMembership(groupId, actorPlayerId);
    const target = getGroupMembership(groupId, targetPlayerId);
    if (actor?.status !== 'active' || target?.status !== 'active') return { ok: false, code: 'not_found' } as const;
    if (actor.role === 'member') return { ok: false, code: 'forbidden' } as const;
    if (actor.role !== 'owner' && (target.role === 'owner' || nextRole === 'owner')) {
      return { ok: false, code: 'forbidden' } as const;
    }
    const targetPlayer = db.prepare('SELECT is_test FROM players WHERE id = ?').get(targetPlayerId) as
      { is_test: number } | undefined;
    if (!targetPlayer) return { ok: false, code: 'not_found' } as const;
    if (targetPlayer.is_test && nextRole !== 'member') return { ok: false, code: 'test_role' } as const;
    if (target.role === 'owner' && nextRole !== 'owner' && activeOwnerCount(groupId) <= 1) {
      return { ok: false, code: 'last_owner' } as const;
    }
    db.prepare('UPDATE group_memberships SET role = ? WHERE group_id = ? AND player_id = ? AND status = ?').run(
      nextRole,
      groupId,
      targetPlayerId,
      'active',
    );
    syncInstanceAdminForRole(groupId, targetPlayerId, nextRole, actorPlayerId);
    return { ok: true, membership: getGroupMembership(groupId, targetPlayerId)! } as const;
  })();
}

export function removeGroupMember(
  groupId: string,
  actorPlayerId: string,
  targetPlayerId: string,
): MembershipMutationResult {
  return db.transaction(() => {
    if (actorPlayerId === targetPlayerId) return { ok: false, code: 'self_removal' } as const;
    const actor = getGroupMembership(groupId, actorPlayerId);
    const target = getGroupMembership(groupId, targetPlayerId);
    if (actor?.status !== 'active' || target?.status !== 'active') return { ok: false, code: 'not_found' } as const;
    if (actor.role === 'member' || (target.role === 'owner' && actor.role !== 'owner')) {
      return { ok: false, code: 'forbidden' } as const;
    }
    if (target.role === 'owner' && activeOwnerCount(groupId) <= 1) {
      return { ok: false, code: 'last_owner' } as const;
    }
    db.prepare(
      `UPDATE group_memberships
       SET status = 'removed', ended_at = ?, outside_tracking_enabled = 0
       WHERE group_id = ? AND player_id = ? AND status = 'active'`,
    ).run(Date.now(), groupId, targetPlayerId);
    return { ok: true, membership: getGroupMembership(groupId, targetPlayerId)! } as const;
  })();
}

export function listGroupMembers(
  groupId: string,
): Array<GroupMembershipRow & { name: string; color: string; avatar: string | null; isTest: boolean }> {
  return db
    .prepare(
      `SELECT gm.*, p.name, p.color, p.avatar, p.is_test AS isTest
       FROM group_memberships gm
       JOIN players p ON p.id = gm.player_id
       WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all(groupId)
    .map((row) => {
      const typed = row as GroupMembershipRow & { name: string; color: string; avatar: string | null; isTest: number };
      return { ...typed, isTest: Boolean(typed.isTest) };
    });
}
