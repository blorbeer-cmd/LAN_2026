// View-owned cache invalidation lives here instead of in app.js. The manifest
// declares when a view is affected; this module attaches the concrete cache
// operations and executes only handlers that match that declaration.

import { state } from './state.js';
import { invalidateMissingSkills, invalidateAktuellStatus } from './aktuellStatus.js';
import { invalidateHomeSeating } from './views/home.js';
import { invalidateMatchmakingHistory, invalidateMatchmakingDraft } from './views/matchmaking.js';
import { invalidateBroadcasts } from './views/broadcast.js';
import { invalidateInfoBoard } from './views/infoBoard.js';
import { invalidateFoodOrders } from './views/foodOrders.js';
import { invalidateEventPolls } from './views/eventPolls.js';
import { invalidateChecklist } from './views/checklist.js';
import { invalidateSkillSuggestions } from './views/gameCatalog.js';
import { invalidateArrivals } from './views/arrivals.js';
import { invalidateVoteEventScope, invalidateVoteHistory } from './views/votes.js';
import { invalidateTournaments } from './views/tournament.js';
import { invalidateHallOfFame } from './views/hallOfFame.js';
import { invalidateSeating } from './views/seating.js';
import { invalidateAdminMemberships, invalidateAdminReadiness } from './views/admin.js';
import { invalidateAdminFeatureUsage } from './views/adminFeatureUsage.js';
import { invalidateMusic } from './views/music.js';
import { invalidateAnalytics } from './views/analytics.js';
import { invalidateMyStats } from './views/myStats.js';
import { invalidateSeatNeighbors } from './views/profile.js';

const EVENT_SCOPE_CHANGE = 'event-context:changed';
const CONNECTION_RESTORED = 'connection:restored';

export const VIEW_LIFECYCLE_HANDLERS = Object.freeze({
  home: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => {
      invalidateAktuellStatus();
      invalidateHomeSeating({ hard: true });
    },
    [CONNECTION_RESTORED]: () => {
      invalidateMissingSkills();
      invalidateAktuellStatus();
      invalidateHomeSeating();
    },
    'players:changed': () => {
      invalidateMissingSkills();
      invalidateHomeSeating();
    },
    'games:changed': invalidateMissingSkills,
    'skills:changed': invalidateMissingSkills,
    'live:changed': invalidateMissingSkills,
    'tournaments:changed': invalidateAktuellStatus,
    'push:sent': invalidateAktuellStatus,
    'foodOrders:changed': invalidateAktuellStatus,
    'arcade:lobbies-changed': invalidateAktuellStatus,
    'visibility:changed': invalidateHomeSeating,
  }),
  matchmaking: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => {
      invalidateMatchmakingHistory({ hard: true });
      invalidateMatchmakingDraft();
    },
    [CONNECTION_RESTORED]: invalidateMatchmakingHistory,
    'games:changed': invalidateMatchmakingHistory,
    'leaderboard:changed': invalidateMatchmakingHistory,
    'matchmaking:generated': invalidateMatchmakingHistory,
    'matchmaking:draws-changed': invalidateMatchmakingHistory,
    'draft:changed': invalidateMatchmakingHistory,
  }),
  votes: Object.freeze({
    [EVENT_SCOPE_CHANGE]: invalidateVoteEventScope,
    [CONNECTION_RESTORED]: invalidateVoteHistory,
    'votes:closed': invalidateVoteHistory,
  }),
  tournaments: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateTournaments({ hard: true }),
    [CONNECTION_RESTORED]: invalidateTournaments,
    'players:changed': invalidateTournaments,
    'games:changed': invalidateTournaments,
    'leaderboard:changed': invalidateTournaments,
    'tournaments:changed': invalidateTournaments,
  }),
  seating: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateSeating({ hard: true }),
    [CONNECTION_RESTORED]: invalidateSeating,
    'players:changed': invalidateSeating,
    'visibility:changed': invalidateSeating,
  }),
  broadcast: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateBroadcasts({ hard: true }),
    [CONNECTION_RESTORED]: invalidateBroadcasts,
    'players:changed': invalidateBroadcasts,
    'broadcast:new': invalidateBroadcasts,
    'broadcasts:changed': invalidateBroadcasts,
  }),
  foodOrders: Object.freeze({
    [EVENT_SCOPE_CHANGE]: invalidateFoodOrders,
    [CONNECTION_RESTORED]: invalidateFoodOrders,
    'players:changed': invalidateFoodOrders,
    'foodOrders:changed': invalidateFoodOrders,
  }),
  eventPolls: Object.freeze({
    [EVENT_SCOPE_CHANGE]: invalidateEventPolls,
    'events:changed': invalidateEventPolls,
  }),
  checklist: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateChecklist(undefined, { hard: true }),
    [CONNECTION_RESTORED]: invalidateChecklist,
    'players:changed': () => invalidateChecklist({ scope: 'tasks' }),
    'checklist:changed': (payload) => invalidateChecklist(payload),
  }),
  gameCatalog: Object.freeze({
    [CONNECTION_RESTORED]: invalidateSkillSuggestions,
    'players:changed': invalidateSkillSuggestions,
    'games:changed': invalidateSkillSuggestions,
    'skills:changed': invalidateSkillSuggestions,
    'leaderboard:changed': invalidateSkillSuggestions,
  }),
  arrivals: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateArrivals({ hard: true }),
    [CONNECTION_RESTORED]: invalidateArrivals,
    'players:changed': invalidateArrivals,
    'events:changed': invalidateArrivals,
    'arrivals:changed': invalidateArrivals,
  }),
  music: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateMusic({ hard: true }),
    [CONNECTION_RESTORED]: invalidateMusic,
    'music:changed': invalidateMusic,
    'visibility:changed': invalidateMusic,
  }),
  analytics: Object.freeze({ [EVENT_SCOPE_CHANGE]: invalidateAnalytics }),
  myStats: Object.freeze({ [EVENT_SCOPE_CHANGE]: invalidateMyStats }),
  hallOfFame: Object.freeze({
    [EVENT_SCOPE_CHANGE]: () => invalidateHallOfFame({ hard: true }),
    [CONNECTION_RESTORED]: invalidateHallOfFame,
    'games:changed': invalidateHallOfFame,
    'leaderboard:changed': invalidateHallOfFame,
  }),
  admin: Object.freeze({
    [EVENT_SCOPE_CHANGE]: invalidateAdminReadiness,
    [CONNECTION_RESTORED]: () => {
      invalidateAdminMemberships();
      invalidateAdminReadiness();
    },
    'events:changed': invalidateAdminReadiness,
    'groups:changed': invalidateAdminMemberships,
  }),
  adminFeatureUsage: Object.freeze({ [EVENT_SCOPE_CHANGE]: invalidateAdminFeatureUsage }),
  profile: Object.freeze({ [EVENT_SCOPE_CHANGE]: invalidateSeatNeighbors }),
});

export const APP_LIFECYCLE_HANDLERS = Object.freeze({
  [EVENT_SCOPE_CHANGE]: () => {
    invalidateInfoBoard();
    state.lastMatchmaking = null;
  },
  [CONNECTION_RESTORED]: invalidateInfoBoard,
  'info:changed': invalidateInfoBoard,
});

export function invalidateViewCaches(registry, eventName, { excludeViews = [], payload } = {}) {
  const excluded = new Set(excludeViews);
  for (const [view, entry] of Object.entries(registry)) {
    if (excluded.has(view) || !entry.lifecycle.invalidateOn.includes(eventName)) continue;
    entry.lifecycleHandlers[eventName]?.(payload);
  }
  APP_LIFECYCLE_HANDLERS[eventName]?.();
}

export function invalidateEventScopedViews(registry) {
  invalidateViewCaches(registry, EVENT_SCOPE_CHANGE);
}

export function invalidateViewsAfterReconnect(registry) {
  invalidateViewCaches(registry, CONNECTION_RESTORED);
}
