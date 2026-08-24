import { renderHome } from './views/home.js';
import { renderOrgaEvents, renderOrgaKiosk } from './views/events.js';
import { renderMatchmaking } from './views/matchmaking.js';
import { renderBroadcast } from './views/broadcast.js';
import { renderFoodOrders } from './views/foodOrders.js';
import { renderChecklist, ensureTasksLoaded, openTaskCount } from './views/checklist.js';
import { renderGameCatalog } from './views/gameCatalog.js';
import { renderArrivals } from './views/arrivals.js';
import { renderVotes } from './views/votes.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { renderAnalytics } from './views/analytics.js';
import { renderProfile } from './views/profile.js';
import { renderTournaments } from './views/tournament.js';
import { renderHallOfFame } from './views/hallOfFame.js';
import { renderSeating } from './views/seating.js';
import { renderMyStats } from './views/myStats.js';
import { renderMore } from './views/more.js';
import { renderAdmin } from './views/admin.js';
import { renderAdminFeatureUsage } from './views/adminFeatureUsage.js';
import { renderAdminFeedback } from './views/adminFeedback.js';
import { renderMusic } from './views/music.js';
import { createViewRegistry } from './viewManifest.js';
import { renderSectionShell, sectionKeyForView } from './sectionNav.js';
import { state } from './state.js';

// A route inside a merged area (see sectionNav.js) draws that area's heading
// and tab row first and then hands the remaining surface to its own renderer,
// which stays unchanged apart from no longer owning the page title.
function inSection(view, render) {
  const inOrga = sectionKeyForView(view) === 'orga';
  return (container, ctx) => {
    // Orga's To-Dos tab carries a live count, so every tab of that area needs
    // the underlying data — not just the one that renders the list.
    if (inOrga) ensureTasksLoaded(ctx);
    const content = renderSectionShell(container, view, {
      badges: { checklist: openTaskCount() },
      event: state.activeEvent,
    });
    render(content, ctx);
  };
}

export const VIEW_REGISTRY = createViewRegistry({
  home: renderHome,
  matchmaking: inSection('matchmaking', renderMatchmaking),
  votes: renderVotes,
  leaderboard: inSection('leaderboard', renderLeaderboard),
  analytics: inSection('analytics', renderAnalytics),
  profile: renderProfile,
  tournaments: inSection('tournaments', renderTournaments),
  hallOfFame: inSection('hallOfFame', renderHallOfFame),
  seating: renderSeating,
  myStats: renderMyStats,
  more: renderMore,
  broadcast: renderBroadcast,
  foodOrders: renderFoodOrders,
  checklist: inSection('checklist', (container, ctx) => renderChecklist(container, ctx, 'todos')),
  checklistPacking: inSection('checklistPacking', (container, ctx) => renderChecklist(container, ctx, 'packliste')),
  gameCatalog: renderGameCatalog,
  arrivals: inSection('arrivals', renderArrivals),
  events: inSection('events', renderOrgaEvents),
  // Not an Orga tab — reached only from Admin's "Kioskverwaltung" tool card,
  // like Sitzplan (see renderOrgaKiosk).
  kiosk: renderOrgaKiosk,
  admin: renderAdmin,
  adminFeatureUsage: renderAdminFeatureUsage,
  adminFeedback: renderAdminFeedback,
  music: renderMusic,
});

export const isKnownView = (view) => Object.hasOwn(VIEW_REGISTRY, view);
