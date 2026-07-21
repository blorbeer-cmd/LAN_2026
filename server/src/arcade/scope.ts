import { Server, Socket } from 'socket.io';
import { config } from '../config';
import { db, DEFAULT_GROUP_ID } from '../db';
import { resolveGroupEventScope } from '../groupEventScope';
import { isParticipant } from '../events';

export interface ArcadeScope {
  groupId: string;
  eventId: string | null;
}

export interface ScopedArcadeResource extends ArcadeScope {
  host?: { id?: string };
  players?: Array<{ id?: string }>;
}

function activeGroupMember(groupId: string, playerId: unknown): boolean {
  return typeof playerId === 'string' && Boolean(db.prepare(
    `SELECT 1 FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     JOIN players p ON p.id = gm.player_id
     WHERE gm.group_id = ? AND gm.player_id = ? AND gm.status = 'active'
       AND g.archived_at IS NULL AND p.deactivated_at IS NULL`,
  ).get(groupId, playerId));
}

function activeEventAccess(groupId: string, eventId: string, playerId: unknown): boolean {
  if (!activeGroupMember(groupId, playerId)) return false;
  const membership = db.prepare(
    "SELECT role FROM group_memberships WHERE group_id = ? AND player_id = ? AND status = 'active'",
  ).get(groupId, playerId) as { role: string } | undefined;
  if (membership?.role === 'admin' || membership?.role === 'owner') {
    return Boolean(db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId));
  }
  const event = db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId);
  return typeof playerId === 'string' && Boolean(event) && isParticipant(eventId, playerId);
}

export function socketArcadeScope(socket: Socket, playerId?: unknown): ArcadeScope | null {
  if (config.authMode === 'legacy') {
    if (playerId !== undefined) {
      if (typeof playerId !== 'string' || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId)) return null;
      db.prepare(
        `INSERT OR IGNORE INTO group_memberships
           (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
         VALUES (?, ?, 'member', 'active', ?, NULL, 1, NULL)`,
      ).run(DEFAULT_GROUP_ID, playerId, Date.now());
    }
    const scope = resolveGroupEventScope(DEFAULT_GROUP_ID, undefined);
    return { groupId: DEFAULT_GROUP_ID, eventId: scope.ok ? scope.eventId : null };
  }
  if (socket.data.kioskReadOnly) return null;
  const groupId = typeof socket.data.groupId === 'string' && socket.data.groupId ? socket.data.groupId : null;
  const authPlayerId = socket.data.authPlayerId;
  if (!groupId || !activeGroupMember(groupId, authPlayerId)) return null;
  if (playerId !== undefined && playerId !== authPlayerId) return null;
  const eventId = typeof socket.data.eventId === 'string' && socket.data.eventId ? socket.data.eventId : null;
  if (eventId && !activeEventAccess(groupId, eventId, authPlayerId)) return null;
  return { groupId, eventId };
}

export function socketCanUseArcadeScope(socket: Socket, scope: ArcadeScope): boolean {
  const socketScope = socketArcadeScope(socket);
  return Boolean(
    socketScope &&
    socketScope.groupId === scope.groupId &&
    socketScope.eventId === scope.eventId
  );
}

export function canUseLobby(socket: Socket, lobby: ScopedArcadeResource): boolean {
  return socketCanUseArcadeScope(socket, lobby);
}

export function canJoinLobby(socket: Socket, lobby: ScopedArcadeResource, playerId: unknown): boolean {
  return socketArcadeScope(socket, playerId)?.groupId === lobby.groupId && canUseLobby(socket, lobby);
}

export function emitArcadeRoom(
  io: Server,
  room: string,
  event: string,
  payload: unknown,
  scope: ArcadeScope,
  exceptSocketId?: string,
): void {
  const socketIds = io.sockets.adapter.rooms.get(room) ?? new Set<string>();
  for (const socketId of socketIds) {
    if (socketId === exceptSocketId) continue;
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socketCanUseArcadeScope(socket, scope)) socket.emit(event, payload);
  }
}

export function emitArcadeSocket(
  io: Server,
  socketId: string,
  event: string,
  payload: unknown,
  scope: ArcadeScope,
): void {
  const socket = io.sockets.sockets.get(socketId);
  if (socket && socketCanUseArcadeScope(socket, scope)) socket.emit(event, payload);
}
