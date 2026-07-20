import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { writeAdminAudit } from './adminAudit';
import { config } from './config';
import { DEFAULT_GROUP_ID } from './db';
import { getGroup, getGroupMembership, type GroupMembershipRow, type GroupRole, type GroupRow } from './groups';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      group?: GroupRow;
      groupMembership?: GroupMembershipRow;
      groupResource?: unknown;
      // Set by the read-only kiosk REST branch: the validated token's scope,
      // so kiosk-facing handlers (e.g. /push/last) can mirror the socket
      // delivery rules instead of resolving a request event like a user would.
      kioskScope?: { groupId: string; eventId: string | null };
    }
  }
}

function requestedGroupId(req: Request): string | undefined {
  if (typeof req.params.groupId === 'string' && req.params.groupId) return req.params.groupId;
  const header = req.headers['x-group-id'];
  if (typeof header === 'string' && header) return header;
  return DEFAULT_GROUP_ID;
}

function auditDeniedGroupAccess(req: Request, requestedId: string, resourceType = 'group'): void {
  const existing = getGroup(requestedId);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    groupId: existing?.id,
    action: 'group_access_denied',
    targetType: resourceType,
    targetId: requestedId,
    details: { status: 404, method: req.method, path: req.path },
  });
}

function resolveMembership(req: Request, res: Response, groupId: string): boolean {
  const group = getGroup(groupId);
  const membership = req.player ? getGroupMembership(groupId, req.player.id) : undefined;
  if (!group || group.archived_at !== null || membership?.status !== 'active') {
    auditDeniedGroupAccess(req, groupId);
    res.status(404).json({ error: 'Gruppe nicht gefunden.' });
    return false;
  }
  req.group = group;
  req.groupMembership = membership;
  return true;
}

export const requireGroupMembership: RequestHandler = (req, res, next): void => {
  if (config.authMode === 'required' && !req.player) {
    res.status(401).json({ error: 'Nicht angemeldet.' });
    return;
  }
  const groupId = requestedGroupId(req);
  if (!groupId || !resolveMembership(req, res, groupId)) return;
  next();
};

// Legacy deployments keep their single implicit group until required auth is
// enabled. This compatibility path disappears with the final required-mode
// rollout, but lets the existing non-auth API suite continue to exercise the
// event domain during the migration.
export const requireConfiguredGroupMembership: RequestHandler = (req, res, next): void => {
  if (config.authMode === 'legacy') {
    const group = getGroup(DEFAULT_GROUP_ID);
    if (!group) {
      res.status(500).json({ error: 'Startgruppe fehlt.' });
      return;
    }
    req.group = group;
    next();
    return;
  }
  requireGroupMembership(req, res, next);
};

function allowedRoles(minimum: GroupRole): GroupRole[] {
  if (minimum === 'owner') return ['owner'];
  if (minimum === 'admin') return ['owner', 'admin'];
  return ['owner', 'admin', 'member'];
}

export function requireGroupRole(minimum: GroupRole): RequestHandler {
  return (req, res, next): void => {
    if (config.authMode === 'legacy') {
      next();
      return;
    }
    if (!req.group || !req.groupMembership) {
      res.status(500).json({ error: 'Gruppenkontext wurde nicht aufgelöst.' });
      return;
    }
    if (!allowedRoles(minimum).includes(req.groupMembership.role)) {
      writeAdminAudit({
        actorPlayerId: req.player?.id,
        groupId: req.group.id,
        action: 'group_role_denied',
        targetType: 'route',
        targetId: `${req.method} ${req.path}`,
        details: { status: 403, requiredRole: minimum, actualRole: req.groupMembership.role },
      });
      res
        .status(403)
        .json({
          error: minimum === 'owner' ? 'Nur für Gruppen-Owner.' : 'Dafür ist eine Gruppen-Adminrolle erforderlich.',
        });
      return;
    }
    next();
  };
}

export interface GroupOwnedResource<T> {
  resource: T;
  groupId: string | null;
}

// Resource routes never trust the selected header as ownership evidence. The
// loader obtains group_id together with the object, then this middleware
// verifies both the active membership and (when supplied) the selected tab
// context before exposing the resource to the handler.
export function resolveGroupResource<T>(options: {
  resourceType: string;
  load: (id: string) => GroupOwnedResource<T> | undefined;
  paramName?: string;
}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.authMode === 'required' && !req.player) {
      res.status(401).json({ error: 'Nicht angemeldet.' });
      return;
    }
    const id = req.params[options.paramName ?? 'id'];
    const resolved = id ? options.load(id) : undefined;
    if (!resolved?.groupId) {
      writeAdminAudit({
        actorPlayerId: req.player?.id,
        action: 'group_resource_access_denied',
        targetType: options.resourceType,
        targetId: id,
        details: { status: 404 },
      });
      res.status(404).json({ error: `${options.resourceType} nicht gefunden.` });
      return;
    }

    if (config.authMode === 'legacy') {
      req.group = getGroup(resolved.groupId);
      req.groupResource = resolved.resource;
      next();
      return;
    }

    const selectedHeader = req.headers['x-group-id'];
    if (typeof selectedHeader === 'string' && selectedHeader !== resolved.groupId) {
      auditDeniedGroupAccess(req, resolved.groupId, options.resourceType);
      res.status(404).json({ error: `${options.resourceType} nicht gefunden.` });
      return;
    }
    if (!resolveMembership(req, res, resolved.groupId)) return;
    req.groupResource = resolved.resource;
    next();
  };
}
