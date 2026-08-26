// Shared-state socket events do not all affect every screen. Keeping this
// policy data-only makes the fan-out explicit and testable instead of hiding
// another unconditional full-view refresh in app.js.

const ALL_DATA_VIEWS = [
  'home',
  'matchmaking',
  'votes',
  'leaderboard',
  'analytics',
  'profile',
  'tournaments',
  'hallOfFame',
  'seating',
  'myStats',
  'broadcast',
  'foodOrders',
  'checklist',
  'checklistPacking',
  'gameCatalog',
  'arrivals',
  'events',
  'admin',
  'adminFeatureUsage',
];

export const CORE_REALTIME_VIEW_DEPENDENCIES = Object.freeze({
  'players:changed': Object.freeze(ALL_DATA_VIEWS),
  'games:changed': Object.freeze([
    'home', 'matchmaking', 'votes', 'leaderboard', 'analytics', 'profile',
    'tournaments', 'hallOfFame', 'myStats', 'gameCatalog', 'admin',
  ]),
  'skills:changed': Object.freeze(['home', 'matchmaking', 'profile', 'tournaments', 'gameCatalog']),
  'leaderboard:changed': Object.freeze(['home', 'matchmaking', 'leaderboard', 'analytics', 'hallOfFame', 'myStats', 'gameCatalog']),
  // 'profile' is included because pending invitations now live in its own
  // "Einladungen" section (see events.js/profile.js) instead of the Events
  // tab, so an invitation arriving while Profile is open must redraw it too.
  // 'arrivals' because its "Alle Zeiten" table lists the event's accepted
  // participants (eventPlayers(), read at render time from
  // state.activeEvent.participantIds). Somebody else accepting or withdrawing
  // changes that set through events:changed alone - without this the table
  // keeps the old roster until an unrelated redraw or a tab switch.
  'events:changed': Object.freeze(['home', 'events', 'profile', 'analytics', 'hallOfFame', 'myStats', 'admin', 'arrivals']),
});

export function realtimeEventAffectsView(eventName, view) {
  return CORE_REALTIME_VIEW_DEPENDENCIES[eventName]?.includes(view) ?? false;
}
