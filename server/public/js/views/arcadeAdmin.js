import { playerById } from '../state.js';
import { getMyId } from '../whoami.js';

export function currentPlayerMayUseArcadeAi() {
  return playerById(getMyId())?.is_admin === 1;
}
