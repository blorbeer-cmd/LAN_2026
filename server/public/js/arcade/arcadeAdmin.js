import { isAdmin } from '../admin.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';

export function currentPlayerMayUseArcadeAi() {
  return isAdmin() && currentPlayerHasAdminRole();
}

// Games that are parked for now stay reachable for admins in Admin mode only.
// This is a presentation filter, not a security boundary: the server still
// accepts their lobbies.
export const ADMIN_ONLY_ARCADE_GAMES = new Set(['scribble', 'challenge-rush']);

export function currentPlayerMaySeeArcadeGame(gameId) {
  return !ADMIN_ONLY_ARCADE_GAMES.has(gameId) || currentPlayerMayUseArcadeAi();
}
