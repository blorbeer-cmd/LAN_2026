// The fixed six-slot navigation is derived from the shared view registry so
// route, label, icon and event profile cannot drift apart.

import { bottomNavigationEntries } from './viewManifest.js';

export function bottomNavItemsForEvent(event) {
  return bottomNavigationEntries(event?.eventType === 'general' ? 'general' : 'lan');
}
