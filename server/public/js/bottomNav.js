// The fixed six-slot navigation is derived from the shared view registry so
// route, label, icon and event profile cannot drift apart.

import { viewIsEnabledForEvent } from './eventFeatures.js';
import { bottomNavigationEntries, desktopNavigationEntries, viewDefinition } from './viewManifest.js';

const DESKTOP_GROUPS = Object.freeze([
  Object.freeze({ key: 'start', label: '' }),
  Object.freeze({ key: 'lan', label: 'LAN' }),
  Object.freeze({ key: 'orga', label: 'Orga' }),
  Object.freeze({ key: 'other', label: 'Sonstiges' }),
]);

const FEEDBACK_UTILITY = Object.freeze({ action: 'feedback', label: 'Feedback', iconKey: 'feedback' });

const DESKTOP_PARENT_BY_VIEW = Object.freeze({
  tournaments: 'matchmaking',
  myStats: 'profile',
  leaderboard: 'admin',
  analytics: 'admin',
  hallOfFame: 'admin',
  seating: 'admin',
  kiosk: 'admin',
  adminFeatureUsage: 'admin',
  adminFeedback: 'admin',
});

function desktopEntry(entry, event, { isAdmin }) {
  if (entry.action) return entry;
  const definition = viewDefinition(entry.view);
  if (!definition || !viewIsEnabledForEvent(entry.view, event)) return null;
  if (definition.requiresRole === 'admin' && !isAdmin) return null;
  return Object.freeze({
    view: entry.view,
    label: entry.label ?? definition.label,
    // Keep the semantic view key here. `domainIcon()` owns the concrete
    // Lucide mapping and otherwise falls back to the generic bell icon.
    iconKey: entry.iconKey ?? entry.view,
  });
}

export function bottomNavItemsForEvent(event) {
  return bottomNavigationEntries(event?.eventType === 'general' ? 'general' : 'lan');
}

export function desktopNavItemsForEvent(event, { isAdmin = false } = {}) {
  const eventType = event?.eventType === 'general' ? 'general' : 'lan';
  const context = { isAdmin };
  const declaredEntries = desktopNavigationEntries(eventType);
  const groups = DESKTOP_GROUPS.map((group) => Object.freeze({
    key: group.key,
    label: group.key === 'lan' && event?.eventType === 'general' ? 'Event' : group.label,
    entries: Object.freeze(declaredEntries
      .filter((entry) => entry.group === group.key)
      .map((entry) => desktopEntry(entry, event, context))
      .filter(Boolean)),
  })).filter((group) => group.entries.length > 0);
  const utilities = [FEEDBACK_UTILITY, ...declaredEntries.filter((entry) => entry.group === 'utility')]
    .map((entry) => desktopEntry(entry, event, context))
    .filter(Boolean);
  return Object.freeze({ groups: Object.freeze(groups), utilities: Object.freeze(utilities) });
}

export function desktopNavTargetForView(view) {
  const definition = viewDefinition(view);
  if (definition?.area === 'arcade') return 'arcade';
  if (definition?.section === 'competition') return 'matchmaking';
  if (definition?.section === 'insights') return 'admin';
  return DESKTOP_PARENT_BY_VIEW[view] ?? view;
}
