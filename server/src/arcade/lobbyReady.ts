// Shared "ready" state for arcade lobbies (quiz, tetris, scribble, blobby).
// Guests flag themselves ready so the host can see who is set to go before
// starting. Pure functions so the rules are unit-testable; each game's socket
// module owns the wiring (its own `<game>:lobby:ready` event + broadcast).

export interface ReadyLobby {
  host: { id: string };
  players: Array<{ id: string }>;
  ready: Set<string>;
}

// Set or clear a lobby member's ready flag. Returns false for malformed
// input or non-members (nothing changed, nothing to broadcast).
export function setLobbyReady(lobby: ReadyLobby, playerId: unknown, ready: unknown): boolean {
  if (typeof playerId !== 'string' || typeof ready !== 'boolean') return false;
  if (!lobby.players.some((p) => p.id === playerId)) return false;
  if (ready) lobby.ready.add(playerId);
  else lobby.ready.delete(playerId);
  return true;
}

// The host opened the lobby and decides when to start, so they always count
// as ready; guests only after flagging themselves.
export function isLobbyReady(lobby: ReadyLobby, playerId: string): boolean {
  return playerId === lobby.host.id || lobby.ready.has(playerId);
}
