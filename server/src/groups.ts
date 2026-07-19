import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID, seedArcadeContentForGroup } from './db';
import { DEFAULT_INVITE_TTL_MS, MAX_INVITE_TTL_MS } from './invites';

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

export interface GroupInviteRow {
  code: string;
  group_id: string;
  target_player_id: string | null;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  used_at: number | null;
  used_by: string | null;
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
    if (player.is_test) {
      db.prepare('UPDATE players SET test_owner_group_id = ? WHERE id = ?').run(DEFAULT_GROUP_ID, playerId);
    }
    db.prepare(`INSERT OR IGNORE INTO group_tracking_consents
      (id, group_id, player_id, granted_at, revoked_at, source) VALUES (?, ?, ?, ?, NULL, 'migration')`)
      .run(`default-${playerId}`, DEFAULT_GROUP_ID, playerId, now);
    return getGroupMembership(DEFAULT_GROUP_ID, playerId)!;
  })();
}

export function createGroup(name: string, description: string | null, creatorPlayerId: string): GroupRow {
  return db.transaction(() => {
    const id = nanoid();
    const now = Date.now();
    db.prepare(
      `INSERT INTO groups (id, name, description, created_by, created_at, archived_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(id, name, description, creatorPlayerId, now);
    db.prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, 'owner', 'active', ?, NULL, 0, NULL)`,
    ).run(id, creatorPlayerId, now);
    seedArcadeContentForGroup(id);
    return getGroup(id)!;
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

export function leaveGroup(groupId: string, playerId: string): MembershipMutationResult {
  return db.transaction(() => {
    const membership = getGroupMembership(groupId, playerId);
    if (membership?.status !== 'active') return { ok: false, code: 'not_found' } as const;
    if (membership.role === 'owner' && activeOwnerCount(groupId) <= 1) {
      return { ok: false, code: 'last_owner' } as const;
    }
    db.prepare(
      `UPDATE group_memberships
       SET status = 'left', ended_at = ?, outside_tracking_enabled = 0
       WHERE group_id = ? AND player_id = ? AND status = 'active'`,
    ).run(Date.now(), groupId, playerId);
    return { ok: true, membership: getGroupMembership(groupId, playerId)! } as const;
  })();
}

export type ArchiveGroupResult =
  | { ok: true; group: GroupRow }
  | { ok: false; code: 'not_found' | 'tracking_active' };

export function archiveGroup(groupId: string): ArchiveGroupResult {
  return db.transaction(() => {
    const group = getGroup(groupId);
    if (!group || group.archived_at !== null) return { ok: false, code: 'not_found' } as const;
    const tracking = db
      .prepare('SELECT 1 FROM events WHERE group_id = ? AND tracking_enabled = 1 LIMIT 1')
      .get(groupId);
    if (tracking) return { ok: false, code: 'tracking_active' } as const;
    db.prepare('UPDATE groups SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(Date.now(), groupId);
    return { ok: true, group: getGroup(groupId)! } as const;
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

export function createGroupInvite(options: {
  groupId: string;
  createdBy: string;
  targetPlayerId?: string;
  expiresInMs?: number;
}): GroupInviteRow {
  const requestedTtl = options.expiresInMs ?? DEFAULT_INVITE_TTL_MS;
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) throw new Error('Invalid invite expiry');
  const code = nanoid(24);
  const now = Date.now();
  const expiresAt = now + Math.min(requestedTtl, MAX_INVITE_TTL_MS);
  db.prepare(
    `INSERT INTO group_invites
       (code, group_id, target_player_id, created_by, created_at, expires_at, revoked_at, used_at, used_by)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(code, options.groupId, options.targetPlayerId ?? null, options.createdBy, now, expiresAt);
  return db.prepare('SELECT * FROM group_invites WHERE code = ?').get(code) as GroupInviteRow;
}

export function findValidGroupInvite(code: string): GroupInviteRow | undefined {
  const row = db
    .prepare(
      `SELECT gi.*
       FROM group_invites gi
       JOIN groups g ON g.id = gi.group_id
       WHERE gi.code = ? AND gi.used_at IS NULL AND gi.revoked_at IS NULL
         AND gi.expires_at > ? AND g.archived_at IS NULL`,
    )
    .get(code, Date.now()) as GroupInviteRow | undefined;
  return row;
}

export type AcceptGroupInviteResult =
  | { ok: true; group: GroupRow; membership: GroupMembershipRow }
  | { ok: false; code: 'invalid' | 'target_mismatch' | 'already_member' };

export function acceptGroupInvite(code: string, playerId: string): AcceptGroupInviteResult {
  return db.transaction(() => {
    const invite = findValidGroupInvite(code);
    if (!invite) return { ok: false, code: 'invalid' } as const;
    if (invite.target_player_id && invite.target_player_id !== playerId) {
      return { ok: false, code: 'target_mismatch' } as const;
    }
    const existing = getGroupMembership(invite.group_id, playerId);
    if (existing?.status === 'active') return { ok: false, code: 'already_member' } as const;

    const consumed = db
      .prepare(
        `UPDATE group_invites
         SET used_at = ?, used_by = ?
         WHERE code = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(Date.now(), playerId, code, Date.now());
    if (consumed.changes !== 1) return { ok: false, code: 'invalid' } as const;

    const now = Date.now();
    db.prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, 'member', 'active', ?, NULL, 0, ?)
       ON CONFLICT(group_id, player_id) DO UPDATE SET
         role = 'member', status = 'active', joined_at = excluded.joined_at,
         ended_at = NULL, outside_tracking_enabled = 0, invited_by = excluded.invited_by`,
    ).run(invite.group_id, playerId, now, invite.created_by);
    return {
      ok: true,
      group: getGroup(invite.group_id)!,
      membership: getGroupMembership(invite.group_id, playerId)!,
    } as const;
  })();
}

export function listActiveGroupInvites(groupId: string): Array<GroupInviteRow & { targetPlayerName: string | null }> {
  return db
    .prepare(
      `SELECT gi.*, p.name AS targetPlayerName
       FROM group_invites gi
       LEFT JOIN players p ON p.id = gi.target_player_id
       WHERE gi.group_id = ? AND gi.used_at IS NULL AND gi.revoked_at IS NULL AND gi.expires_at > ?
       ORDER BY gi.created_at DESC`,
    )
    .all(groupId, Date.now()) as Array<GroupInviteRow & { targetPlayerName: string | null }>;
}

export function revokeGroupInvite(code: string, groupId: string): boolean {
  return (
    db
      .prepare(
        `UPDATE group_invites SET revoked_at = ?
         WHERE code = ? AND group_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .run(Date.now(), code, groupId).changes === 1
  );
}
