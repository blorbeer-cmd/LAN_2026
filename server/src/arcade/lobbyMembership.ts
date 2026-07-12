export interface LobbyMembership {
  gameType: string;
  lobbyId: string;
}

const memberships = new Map<string, LobbyMembership>();

export function claimLobbyMembership(playerId: string, gameType: string, lobbyId: string): boolean {
  const current = memberships.get(playerId);
  if (current) return current.gameType === gameType && current.lobbyId === lobbyId;
  memberships.set(playerId, { gameType, lobbyId });
  return true;
}

export function releaseLobbyMembership(playerId: string, gameType: string, lobbyId: string): void {
  const current = memberships.get(playerId);
  if (current?.gameType === gameType && current.lobbyId === lobbyId) memberships.delete(playerId);
}

export function releaseLobbyMemberships(playerIds: Iterable<string>, gameType: string, lobbyId: string): void {
  for (const playerId of playerIds) releaseLobbyMembership(playerId, gameType, lobbyId);
}

export function clearLobbyMemberships(): void {
  memberships.clear();
}
