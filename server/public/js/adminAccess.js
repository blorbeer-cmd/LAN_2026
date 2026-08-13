import { playerById } from './state.js';
import { getMyId } from './whoami.js';

export function hasAdminRole(player) {
  return player?.is_admin === 1;
}

export function currentPlayerHasAdminRole() {
  return hasAdminRole(playerById(getMyId()));
}
