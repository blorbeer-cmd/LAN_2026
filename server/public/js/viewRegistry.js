import { renderHome } from './views/home.js';
import { renderPlayers } from './views/players.js';
import { renderSettings } from './views/games.js';
import { renderMatchmaking } from './views/matchmaking.js';
import { renderBroadcast } from './views/broadcast.js';
import { renderInfoBoard } from './views/infoBoard.js';
import { renderFoodOrders } from './views/foodOrders.js';
import { renderChecklist } from './views/checklist.js';
import { renderGameCatalog } from './views/gameCatalog.js';
import { renderArrivals } from './views/arrivals.js';
import { renderVotes } from './views/votes.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { renderAnalytics } from './views/analytics.js';
import { renderEvents } from './views/events.js';
import { renderProfile } from './views/profile.js';
import { renderTournaments } from './views/tournament.js';
import { renderHallOfFame } from './views/hallOfFame.js';
import { renderSeating } from './views/seating.js';
import { renderMyStats } from './views/myStats.js';
import { renderMore } from './views/more.js';
import { renderAdmin } from './views/admin.js';
import { renderMusic } from './views/music.js';
import { createViewRegistry } from './viewManifest.js';

export const VIEW_REGISTRY = createViewRegistry({
  home: renderHome,
  players: renderPlayers,
  matchmaking: renderMatchmaking,
  votes: renderVotes,
  leaderboard: renderLeaderboard,
  settings: renderSettings,
  analytics: renderAnalytics,
  events: renderEvents,
  profile: renderProfile,
  tournaments: renderTournaments,
  hallOfFame: renderHallOfFame,
  seating: renderSeating,
  myStats: renderMyStats,
  more: renderMore,
  broadcast: renderBroadcast,
  infoBoard: renderInfoBoard,
  foodOrders: renderFoodOrders,
  checklist: renderChecklist,
  gameCatalog: renderGameCatalog,
  arrivals: renderArrivals,
  admin: renderAdmin,
  music: renderMusic,
});

export const isKnownView = (view) => Object.hasOwn(VIEW_REGISTRY, view);
