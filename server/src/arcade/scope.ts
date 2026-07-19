import { Socket } from 'socket.io';
import { config } from '../config';
import { db, DEFAULT_GROUP_ID } from '../db';

export function playerGroupId(playerId: unknown): string | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  if (config.authMode === 'legacy') return DEFAULT_GROUP_ID;
  const row = db.prepare(
    `SELECT group_id AS groupId FROM group_memberships
     WHERE player_id = ? AND status = 'active'
     ORDER BY joined_at LIMIT 1`,
  ).get(playerId) as { groupId: string } | undefined;
  return row?.groupId ?? null;
}

export function socketGroupId(socket: Socket): string | null {
  return typeof socket.data.groupId === 'string' ? socket.data.groupId : null;
}

export function lobbyGroupId(lobby: { host?: { id?: string }; players?: Array<{ id?: string }> }): string | null {
  return playerGroupId(lobby.host?.id ?? lobby.players?.find((player) => player.id)?.id);
}

export function canUseLobby(socket: Socket, lobby: { host?: { id?: string }; players?: Array<{ id?: string }> }): boolean {
  const groupId = lobbyGroupId(lobby);
  return Boolean(groupId && (!socketGroupId(socket) || socketGroupId(socket) === groupId));
}

export function canJoinLobby(socket: Socket, lobby: { host?: { id?: string }; players?: Array<{ id?: string }> }, playerId: unknown): boolean {
  const groupId = lobbyGroupId(lobby);
  const playerGroup = playerGroupId(playerId);
  return Boolean(groupId && playerGroup === groupId && (!socketGroupId(socket) || socketGroupId(socket) === groupId));
}
