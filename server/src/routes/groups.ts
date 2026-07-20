import { Router, type RequestHandler } from 'express';
import { config } from '../config';
import {
  acceptGroupInvite,
  archiveGroup,
  changeGroupMemberRole,
  createGroup,
  createGroupInvite,
  findValidGroupInvite,
  getGroup,
  getGroupMembership,
  leaveGroup,
  listActiveGroupInvites,
  listGroupMembers,
  listGroupsForPlayer,
  removeGroupMember,
  revokeGroupInvite,
  updateGroupDetails,
  type MembershipMutationResult,
} from '../groups';
import { db, DEFAULT_GROUP_ID } from '../db';
import { requireRecentReauthentication, requireUser } from '../sessions';
import { isNonEmptyString } from '../validation';
import { writeAdminAudit } from '../adminAudit';
import { broadcast, broadcastInstanceSignal, disconnectKioskTokenSockets, Events } from '../realtime';
import { requireGroupMembership, requireGroupRole } from '../groupAuthorization';
import { countTestUsers, createTestUsers, deleteTestUsers, MAX_TEST_USERS_PER_CALL } from '../testUsers';
import { getLiveBoard } from '../liveStatus';
import { setGroupTrackingConsent } from '../trackingContexts';
import { issueKioskToken, listKioskTokens, revokeKioskToken } from '../kioskTokens';

export const groupsRouter = Router();

groupsRouter.use(requireUser);

function requireMultiGroups(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
): void {
  if (!config.multiGroupsEnabled) {
    res.status(409).json({
      error: 'Weitere Gruppen werden erst nach Abschluss der Mandantentrennung freigeschaltet.',
      code: 'multi_groups_disabled',
    });
    return;
  }
  next();
}

function serializeGroup(
  group: NonNullable<ReturnType<typeof getGroup>>,
  role?: string,
  outsideTrackingEnabled?: boolean,
) {
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

function sendMembershipMutationError(
  res: Parameters<RequestHandler>[1],
  result: Exclude<MembershipMutationResult, { ok: true }>,
) {
  if (result.code === 'not_found') return res.status(404).json({ error: 'Mitgliedschaft nicht gefunden.' });
  if (result.code === 'last_owner')
    return res.status(409).json({ error: 'Die Gruppe muss mindestens einen Owner behalten.' });
  if (result.code === 'test_role')
    return res.status(409).json({ error: 'Test-Spieler dürfen keine Admin- oder Ownerrolle erhalten.' });
  if (result.code === 'self_removal')
    return res.status(409).json({ error: 'Nutze zum eigenen Austritt die Austrittsfunktion.' });
  return res.status(403).json({ error: 'Diese Rollenänderung ist nicht erlaubt.' });
}

groupsRouter.get('/', (req, res) => {
  res.json(
    listGroupsForPlayer(req.player!.id).map((group) => serializeGroup(group, group.role, group.outsideTrackingEnabled)),
  );
});

groupsRouter.post('/', requireMultiGroups, (req, res) => {
  if (req.player!.is_test) return res.status(403).json({ error: 'Test-Spieler können keine Gruppen anlegen.' });
  const { name, description } = req.body ?? {};
  if (!isNonEmptyString(name, 80)) return res.status(400).json({ error: 'Name muss 1–80 Zeichen lang sein.' });
  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== 'string' || description.trim().length > 500)
  ) {
    return res.status(400).json({ error: 'Beschreibung darf höchstens 500 Zeichen lang sein.' });
  }
  const group = createGroup(
    name.trim(),
    typeof description === 'string' && description.trim() ? description.trim() : null,
    req.player!.id,
  );
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: group.id,
    action: 'group_created',
    targetType: 'group',
    targetId: group.id,
  });
  broadcastInstanceSignal(Events.groupsChanged);
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
    if (result.code === 'already_member')
      return res.status(409).json({ error: 'Du bist bereits Mitglied dieser Gruppe.' });
    return res.status(404).json({ error: 'Gruppeneinladung ist nicht gültig.' });
  }
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: result.group.id,
    action: 'group_invite_accepted',
    targetType: 'group',
    targetId: result.group.id,
  });
  broadcastInstanceSignal(Events.groupsChanged);
  res.json(serializeGroup(result.group, result.membership.role, false));
});

groupsRouter.get('/:groupId', requireGroupMembership, (req, res) => {
  res.json(
    serializeGroup(req.group!, req.groupMembership!.role, Boolean(req.groupMembership!.outside_tracking_enabled)),
  );
});

groupsRouter.get('/:groupId/kiosk-tokens', requireGroupMembership, requireGroupRole('admin'), (req, res) => {
  res.json(listKioskTokens(req.group!.id));
});

groupsRouter.post('/:groupId/kiosk-tokens', requireGroupMembership, requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  const { eventId, label } = req.body ?? {};
  if (eventId !== undefined && eventId !== null && (typeof eventId !== 'string' || !eventId)) {
    return res.status(400).json({ error: 'eventId ist ungültig.' });
  }
  if (typeof label !== 'undefined' && label !== null && (typeof label !== 'string' || label.trim().length > 80)) {
    return res.status(400).json({ error: 'label darf höchstens 80 Zeichen lang sein.' });
  }
  if (eventId && !db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, req.group!.id)) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  const issued = issueKioskToken(req.group!.id, eventId ?? null, req.player!.id, typeof label === 'string' && label.trim() ? label.trim() : null);
  res.status(201).json({ token: issued.token, ...issued.scope });
});

groupsRouter.delete('/:groupId/kiosk-tokens/:tokenId', requireGroupMembership, requireGroupRole('admin'), requireRecentReauthentication, (req, res) => {
  if (!revokeKioskToken(req.group!.id, req.params.tokenId)) return res.status(404).json({ error: 'Kiosk-Token nicht gefunden.' });
  // Delivery re-checks the token anyway; ending the sockets eagerly makes the
  // revocation visible on the shared screen immediately.
  disconnectKioskTokenSockets(req.params.tokenId);
  res.status(204).end();
});

// Personal, explicit consent for tracking in the group's outside-event room.
// The append-only history is the source of truth; the membership bit remains
// as a compatibility projection for older clients.
groupsRouter.post('/:groupId/tracking-consent', requireGroupMembership, (req, res) => {
  const { granted } = req.body ?? {};
  if (typeof granted !== 'boolean') return res.status(400).json({ error: 'granted muss ein Boolean sein.' });
  setGroupTrackingConsent(req.group!.id, req.player!.id, granted);
  db.prepare('UPDATE group_memberships SET outside_tracking_enabled = ? WHERE group_id = ? AND player_id = ?')
    .run(granted ? 1 : 0, req.group!.id, req.player!.id);
  if (!granted) {
    db.prepare('UPDATE play_sessions SET ended_at = ? WHERE player_id = ? AND group_id = ? AND event_id IS NULL AND ended_at IS NULL')
      .run(Date.now(), req.player!.id, req.group!.id);
  }
  broadcastInstanceSignal(Events.groupsChanged);
  res.json({ ok: true, granted });
});

groupsRouter.patch('/:groupId', requireGroupMembership, requireGroupRole('admin'), (req, res) => {
  const { name, description } = req.body ?? {};
  if (name !== undefined && !isNonEmptyString(name, 80)) {
    return res.status(400).json({ error: 'Name muss 1–80 Zeichen lang sein.' });
  }
  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== 'string' || description.trim().length > 500)
  ) {
    return res.status(400).json({ error: 'Beschreibung darf höchstens 500 Zeichen lang sein.' });
  }
  const group = updateGroupDetails(req.group!.id, {
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(description !== undefined
      ? { description: typeof description === 'string' && description.trim() ? description.trim() : null }
      : {}),
  })!;
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: group.id,
    action: 'group_updated',
    targetType: 'group',
    targetId: group.id,
  });
  broadcastInstanceSignal(Events.groupsChanged);
  res.json(serializeGroup(group, req.groupMembership!.role, Boolean(req.groupMembership!.outside_tracking_enabled)));
});

groupsRouter.delete(
  '/:groupId',
  requireMultiGroups,
  requireGroupMembership,
  requireGroupRole('owner'),
  requireRecentReauthentication,
  (req, res) => {
    const archived = archiveGroup(req.group!.id);
    if (!archived.ok) {
      if (archived.code === 'tracking_active') {
        return res.status(409).json({ error: 'Die Gruppe kann während eines laufenden Trackings nicht archiviert werden.' });
      }
      return res.status(404).json({ error: 'Gruppe nicht gefunden.' });
    }
    const group = archived.group;
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: group.id,
      action: 'group_archived',
      targetType: 'group',
      targetId: group.id,
    });
    broadcastInstanceSignal(Events.groupsChanged);
    res.status(204).end();
  },
);

groupsRouter.get('/:groupId/members', requireGroupMembership, (req, res) => {
  res.json(
    listGroupMembers(req.group!.id).map((member) => ({
      playerId: member.player_id,
      name: member.name,
      color: member.color,
      avatar: member.avatar,
      role: member.role,
      isTest: member.isTest,
      joinedAt: member.joined_at,
      outsideTrackingEnabled: Boolean(member.outside_tracking_enabled),
    })),
  );
});

groupsRouter.patch(
  '/:groupId/members/:playerId',
  requireGroupMembership,
  requireGroupRole('admin'),
  requireRecentReauthentication,
  (req, res) => {
    const { role } = req.body ?? {};
    if (!['owner', 'admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'role muss owner, admin oder member sein.' });
    }
    const result = changeGroupMemberRole(req.group!.id, req.player!.id, req.params.playerId, role);
    if (!result.ok) return sendMembershipMutationError(res, result);
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: req.group!.id,
      action: 'group_member_role_changed',
      targetType: 'player',
      targetId: req.params.playerId,
      details: { role },
    });
    broadcastInstanceSignal(Events.groupsChanged);
    res.json({ playerId: result.membership.player_id, role: result.membership.role, status: result.membership.status });
  },
);

groupsRouter.delete(
  '/:groupId/members/:playerId',
  requireGroupMembership,
  requireGroupRole('admin'),
  requireRecentReauthentication,
  (req, res) => {
    if (!config.multiGroupsEnabled && req.group!.id === DEFAULT_GROUP_ID) {
      return res
        .status(409)
        .json({ error: 'Aus der Startgruppe können während des Ein-Gruppen-Rollouts keine Mitglieder entfernt werden.' });
    }
    const result = removeGroupMember(req.group!.id, req.player!.id, req.params.playerId);
    if (!result.ok) return sendMembershipMutationError(res, result);
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: req.group!.id,
      action: 'group_member_removed',
      targetType: 'player',
      targetId: req.params.playerId,
    });
    // groups:changed only makes clients refetch their own group list; it does
    // not drop the removed person from the remaining members' roster/live
    // views. A group-scoped roster + live refresh does (getLiveBoard already
    // excludes the now-inactive membership).
    broadcastInstanceSignal(Events.groupsChanged);
    broadcast(Events.playersChanged, null, { groupId: req.group!.id });
    broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
    res.status(204).end();
  },
);

groupsRouter.post('/:groupId/leave', requireGroupMembership, requireRecentReauthentication, (req, res) => {
  if (!config.multiGroupsEnabled && req.group!.id === DEFAULT_GROUP_ID) {
    return res
      .status(409)
      .json({ error: 'Die Startgruppe kann während des Ein-Gruppen-Rollouts nicht verlassen werden.' });
  }
  const result = leaveGroup(req.group!.id, req.player!.id);
  if (!result.ok) return sendMembershipMutationError(res, result);
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: req.group!.id,
    action: 'group_member_left',
    targetType: 'player',
    targetId: req.player!.id,
  });
  broadcastInstanceSignal(Events.groupsChanged);
  broadcast(Events.playersChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.status(204).end();
});

groupsRouter.get('/:groupId/audit', requireGroupMembership, requireGroupRole('admin'), (req, res) => {
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 100;
  const rows = db
    .prepare(
      `SELECT l.id, l.actor_player_id, p.name AS actor_name, l.action, l.target_type,
              l.target_id, l.details, l.created_at
       FROM admin_log l
       LEFT JOIN players p ON p.id = l.actor_player_id
       WHERE l.group_id = ?
       ORDER BY l.created_at DESC
       LIMIT ?`,
    )
    .all(req.group!.id, limit);
  res.json(rows);
});

groupsRouter.post('/:groupId/test-users', requireGroupMembership, requireGroupRole('admin'), (req, res) => {
  if (req.group!.id !== DEFAULT_GROUP_ID && !config.multiGroupsEnabled) {
    return res
      .status(409)
      .json({ error: 'Weitere Gruppen sind noch nicht produktiv freigeschaltet.', code: 'multi_groups_disabled' });
  }
  const { count } = req.body ?? {};
  if (!Number.isInteger(count) || count < 1 || count > MAX_TEST_USERS_PER_CALL) {
    return res
      .status(400)
      .json({ error: `count muss eine ganze Zahl zwischen 1 und ${MAX_TEST_USERS_PER_CALL} sein.` });
  }
  const created = createTestUsers(count, req.group!.id);
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    groupId: req.group!.id,
    action: 'test_users_created',
    targetType: 'test_user_batch',
    details: { count: created.length },
  });
  broadcast(Events.playersChanged, null, { groupId: req.group!.id });
  broadcast(Events.skillsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.status(201).json({ created, totalTestUsers: countTestUsers(req.group!.id) });
});

groupsRouter.delete(
  '/:groupId/test-users',
  requireGroupMembership,
  requireGroupRole('admin'),
  requireRecentReauthentication,
  (req, res) => {
    const deleted = deleteTestUsers(req.group!.id);
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: req.group!.id,
      action: 'test_users_deleted',
      targetType: 'test_user_batch',
      details: { count: deleted },
    });
    if (deleted > 0) {
      broadcast(Events.playersChanged, null, { groupId: req.group!.id });
      broadcast(Events.skillsChanged, null, { groupId: req.group!.id });
      broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
    }
    res.json({ deleted });
  },
);

groupsRouter.get(
  '/:groupId/invites',
  requireMultiGroups,
  requireGroupMembership,
  requireGroupRole('admin'),
  (req, res) => {
    res.json(
      listActiveGroupInvites(req.group!.id).map((invite) => ({
        code: invite.code,
        targetPlayerId: invite.target_player_id,
        targetPlayerName: invite.targetPlayerName,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
      })),
    );
  },
);

groupsRouter.post(
  '/:groupId/invites',
  requireMultiGroups,
  requireGroupMembership,
  requireGroupRole('admin'),
  requireRecentReauthentication,
  (req, res) => {
    const { targetPlayerId, expiresInMs } = req.body ?? {};
    if (targetPlayerId !== undefined && typeof targetPlayerId !== 'string') {
      return res.status(400).json({ error: 'targetPlayerId muss ein String sein.' });
    }
    if (
      expiresInMs !== undefined &&
      (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs <= 0)
    ) {
      return res.status(400).json({ error: 'expiresInMs muss eine positive Zahl sein.' });
    }
    if (targetPlayerId) {
      const target = db.prepare('SELECT id, is_test, deactivated_at FROM players WHERE id = ?').get(targetPlayerId) as
        { id: string; is_test: number; deactivated_at: number | null } | undefined;
      if (!target || target.deactivated_at !== null) return res.status(404).json({ error: 'Konto nicht gefunden.' });
      if (target.is_test)
        return res.status(409).json({ error: 'Test-Spieler werden innerhalb ihrer Gruppe angelegt.' });
      if (getGroupMembership(req.group!.id, target.id)?.status === 'active') {
        return res.status(409).json({ error: 'Dieses Konto ist bereits Mitglied.' });
      }
    }
    const invite = createGroupInvite({
      groupId: req.group!.id,
      createdBy: req.player!.id,
      ...(targetPlayerId ? { targetPlayerId } : {}),
      expiresInMs,
    });
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: req.group!.id,
      action: 'group_invite_created',
      targetType: 'group',
      targetId: req.group!.id,
      details: { targetPlayerId: targetPlayerId ?? null, expiresAt: invite.expires_at },
    });
    res.status(201).json({ code: invite.code, groupId: invite.group_id, expiresAt: invite.expires_at });
  },
);

groupsRouter.delete(
  '/:groupId/invites/:code',
  requireMultiGroups,
  requireGroupMembership,
  requireGroupRole('admin'),
  requireRecentReauthentication,
  (req, res) => {
    if (!revokeGroupInvite(req.params.code, req.group!.id)) {
      return res.status(404).json({ error: 'Gruppeneinladung nicht gefunden oder bereits verbraucht.' });
    }
    writeAdminAudit({
      actorPlayerId: req.player!.id,
      groupId: req.group!.id,
      action: 'group_invite_revoked',
      targetType: 'group',
      targetId: req.group!.id,
    });
    res.status(204).end();
  },
);
