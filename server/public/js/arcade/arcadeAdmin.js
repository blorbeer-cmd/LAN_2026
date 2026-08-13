import { isAdmin } from '../admin.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';

export function currentPlayerMayUseArcadeAi() {
  return isAdmin() && currentPlayerHasAdminRole();
}
