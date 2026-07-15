import { Router, type RequestHandler } from 'express';
import { config } from '../config';
import {
  acceptGroupInvite,
  createGroup,
  createGroupInvite,
  findValidGroupInvite,
  getGroup,
  getGroupMembership,
  listActiveGroupInvites,
  listGroupMembers,
  listGroupsForPlayer,
  revokeGroupInvite,
} from '../groups';
import { db } from '../db';
import { requireRecentReauthentication, requireUser } from '../sessions';
import { isNonEmptyString } from '../validation';
import { writeAdminAudit } from '../adminAudit';
import { broadcast, Events } from '../realtime';

export const groupsRouter = Router();

groupsRouter.use(requireUser);

function requireMultiGroups(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]): void {
  if (!config.multiGroupsEnabled) {
    res.status(409).json({
      error: 'Weitere Gruppen werden erst nach Abschluss der Mandantentrennung freigeschaltet.',
      code: 'multi_groups_disabled',
    });
    return;
  }
  next();
}

function serializeGroup(group: NonNullable<ReturnType<typeof getGroup>>, role?: string, outsideTrackingEnabled?: boolean) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.created_at,
    archivedAt: group.archived_at,
    ...(role ? { role } : {}),
    ...(outsideTrackingEnabled !== undefined ? { outsideTrackingEnabled } : {}),
  };
}

function getActiveGroupAccess(groupId: string, playerId: string, roles: string[]) {
  const group = getGroup(groupId);
  const membership = getGroupMembership(groupId, playerId);
  if (!group || group.archived_at !== null || membership?.status !== 'active') {
    return { status: 'not_found' as const };
  }
  if (!roles.includes(membership.role)) {
    return { status: 'forbidden' as const };
  }
  return { status: 'ok' as const, group, membership };
}

groupsRouter.get('/', (req, res) => {
  res.json(
    listGroupsForPlayer(req.player!.id).map((group) =>
      serializeGroup(group, group.role, group.outsideTrackingEnabled)
    )
  );
});

groupsRouter.post('/', requireMultiGroups, (req, res) => {
  if (req.player!.is_test) return res.status(403).json({ error: 'Test-Spieler können keine Gruppen anlegen.' });
  const { name, description } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) return res.status(400).json({ error: 'Name muss 1–80 Zeichen lang sein.' });
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.trim().length > 500)) {
    return res.status(400).json({ error: 'Beschreibung darf höchstens 500 Zeichen lang sein.' });
  }
  const group = createGroup(name.trim(), typeof description === 'string' && description.trim() ? description.trim() : null, req.player!.id);
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'group_created',
    targetType: 'group',
    targetId: group.id,
  });
  broadcast(Events.groupsChanged, null);
  res.status(201).json(serializeGroup(group, 'owner', false));
});

groupsRouter.get('/invites/:code', requireMultiGroups, (req, res) => {
  const invite = findValidGroupInvite(req.params.code);
  if (!invite) return res.status(404).json({ error: 'Gruppeneinladung ist nicht gültig.' });
  if (invite.target_player_id && invite.target_player_id !== req.player!.id) {
    return res.status(404).json({ error: 'Gruppeneinladung ist nicht gültig.' });
  }
  const group = getGroup(invite.group_id)!;
  const inviter = invite.created_by
    ? (db.prepare('SELECT name FROM players WHERE id = ?').get(invite.created_by) as { name: string } | undefined)
    : undefined;
  res.json({
    group: serializeGroup(group),
    invitedByName: inviter?.name ?? null,
    expiresAt: invite.expires_at,
    alreadyMember: getGroupMembership(group.id, req.player!.id)?.status === 'active',
  });
});

groupsRouter.post('/invites/:code/accept', requireMultiGroups, (req, res) => {
  const result = acceptGroupInvite(req.params.code, req.player!.id);
  if (!result.ok) {
    if (result.code === 'already_member') return res.status(409).json({ error: 'Du bist bereits Mitglied dieser Gruppe.' });
    return res.status(404).json({ error: 'Gruppeneinladung ist nicht gültig.' });
  }
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'group_invite_accepted',
    targetType: 'group',
    targetId: result.group.id,
  });
  broadcast(Events.groupsChanged, null);
  res.json(serializeGroup(result.group, result.membership.role, false));
});

groupsRouter.get('/:groupId/members', (req, res) => {
  const access = getActiveGroupAccess(req.params.groupId, req.player!.id, ['owner', 'admin', 'member']);
  if (access.status !== 'ok') return res.status(404).json({ error: 'Gruppe nicht gefunden.' });
  res.json(
    listGroupMembers(access.group.id).map((member) => ({
      playerId: member.player_id,
      name: member.name,
      color: member.color,
      avatar: member.avatar,
      role: member.role,
      isTest: member.isTest,
      joinedAt: member.joined_at,
      outsideTrackingEnabled: Boolean(member.outside_tracking_enabled),
    }))
  );
});

groupsRouter.get('/:groupId/invites', requireMultiGroups, (req, res) => {
  const access = getActiveGroupAccess(req.params.groupId, req.player!.id, ['owner', 'admin']);
  if (access.status === 'not_found') return res.status(404).json({ error: 'Gruppe nicht gefunden.' });
  if (access.status === 'forbidden') return res.status(403).json({ error: 'Dafür ist eine Gruppen-Adminrolle erforderlich.' });
  res.json(
    listActiveGroupInvites(access.group.id).map((invite) => ({
      code: invite.code,
      targetPlayerId: invite.target_player_id,
      targetPlayerName: invite.targetPlayerName,
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
    }))
  );
});

groupsRouter.post('/:groupId/invites', requireMultiGroups, requireRecentReauthentication, (req, res) => {
  const access = getActiveGroupAccess(req.params.groupId, req.player!.id, ['owner', 'admin']);
  if (access.status === 'not_found') return res.status(404).json({ error: 'Gruppe nicht gefunden.' });
  if (access.status === 'forbidden') return res.status(403).json({ error: 'Dafür ist eine Gruppen-Adminrolle erforderlich.' });
  const { targetPlayerId, expiresInMs } = req.body ?? {};
  if (targetPlayerId !== undefined && typeof targetPlayerId !== 'string') {
    return res.status(400).json({ error: 'targetPlayerId muss ein String sein.' });
  }
  if (expiresInMs !== undefined && (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs <= 0)) {
    return res.status(400).json({ error: 'expiresInMs muss eine positive Zahl sein.' });
  }
  if (targetPlayerId) {
    const target = db
      .prepare('SELECT id, is_test, deactivated_at FROM players WHERE id = ?')
      .get(targetPlayerId) as { id: string; is_test: number; deactivated_at: number | null } | undefined;
    if (!target || target.deactivated_at !== null) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    if (target.is_test) return res.status(409).json({ error: 'Test-Spieler werden innerhalb ihrer Gruppe angelegt.' });
    if (getGroupMembership(access.group.id, target.id)?.status === 'active') {
      return res.status(409).json({ error: 'Dieses Konto ist bereits Mitglied.' });
    }
  }
  const invite = createGroupInvite({
    groupId: access.group.id,
    createdBy: req.player!.id,
    ...(targetPlayerId ? { targetPlayerId } : {}),
    expiresInMs,
  });
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'group_invite_created',
    targetType: 'group',
    targetId: access.group.id,
    details: { targetPlayerId: targetPlayerId ?? null, expiresAt: invite.expires_at },
  });
  res.status(201).json({ code: invite.code, groupId: invite.group_id, expiresAt: invite.expires_at });
});

groupsRouter.delete('/:groupId/invites/:code', requireMultiGroups, requireRecentReauthentication, (req, res) => {
  const access = getActiveGroupAccess(req.params.groupId, req.player!.id, ['owner', 'admin']);
  if (access.status === 'not_found') return res.status(404).json({ error: 'Gruppe nicht gefunden.' });
  if (access.status === 'forbidden') return res.status(403).json({ error: 'Dafür ist eine Gruppen-Adminrolle erforderlich.' });
  if (!revokeGroupInvite(req.params.code, access.group.id)) {
    return res.status(404).json({ error: 'Gruppeneinladung nicht gefunden oder bereits verbraucht.' });
  }
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'group_invite_revoked',
    targetType: 'group',
    targetId: access.group.id,
  });
  res.status(204).end();
});
