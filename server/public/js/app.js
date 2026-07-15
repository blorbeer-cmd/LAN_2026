// App bootstrap: token gate, tab switching, and wiring realtime events into
// the shared state. Kept as one small orchestrator so each view module stays
// focused on its own rendering logic.

import { api, getToken, setToken } from './api.js';
import { connectSocket } from './socket.js';
import { state } from './state.js';
import { loadAll } from './data.js';
import { showToast } from './toast.js';
import { getMyId } from './whoami.js';
import { isAdmin, setAdmin } from './admin.js';
import { filterTestUsers } from './testFilter.js';
import { renderHome, invalidateHomeSeating } from './views/home.js';
import { initNotificationBanner, refreshNotificationBanner } from './notificationBanner.js';
import { invalidateMissingSkills, invalidateAktuellStatus } from './aktuellStatus.js';
import { renderPlayers } from './views/players.js';
import { renderSettings } from './views/games.js';
import { renderMatchmaking, invalidateMatchmakingHistory, setDraftState } from './views/matchmaking.js';
import { renderBroadcast, invalidateBroadcasts } from './views/broadcast.js';
import { renderInfoBoard, invalidateInfoBoard } from './views/infoBoard.js';
import { renderFoodOrders, invalidateFoodOrders } from './views/foodOrders.js';
import { renderArcade, renderQuizRoom } from './views/arcade.js';
import { renderArcadeWatch } from './views/arcadeWatch.js';
import { renderTetris } from './views/tetris.js';
import { renderScribbleRoom } from './views/arcadeScribble.js';
import { renderBlobby } from './views/blobby.js';
import { renderPong } from './views/pong.js';
import { renderSnake } from './views/snake.js';
import { renderGameCatalog, invalidateSkillSuggestions } from './views/gameCatalog.js';
import { renderArrivals, invalidateArrivals } from './views/arrivals.js';
import { renderVotes, invalidateVoteHistory } from './views/votes.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { renderAnalytics } from './views/analytics.js';
import { renderProfile } from './views/profile.js';
import { renderTournaments, invalidateTournaments, focusTournament } from './views/tournament.js';
import { renderHallOfFame } from './views/hallOfFame.js';
import { renderSeating, invalidateSeating } from './views/seating.js';
import { renderMyStats } from './views/myStats.js';
import { renderMore } from './views/more.js';
import { renderAdmin } from './views/admin.js';
import { installIconReplacement } from './icons.js';

installIconReplacement();

const VIEWS = {
  home: renderHome,
  players: renderPlayers,
  matchmaking: renderMatchmaking,
  votes: renderVotes,
  leaderboard: renderLeaderboard,
  settings: renderSettings,
  analytics: renderAnalytics,
  profile: renderProfile,
  tournaments: renderTournaments,
  hallOfFame: renderHallOfFame,
  seating: renderSeating,
  myStats: renderMyStats,
  more: renderMore,
  broadcast: renderBroadcast,
  infoBoard: renderInfoBoard,
  foodOrders: renderFoodOrders,
  arcade: renderArcade,
  arcadeWatch: renderArcadeWatch,
  quizRoom: renderQuizRoom,
  tetris: renderTetris,
  scribbleRoom: renderScribbleRoom,
  blobby: renderBlobby,
  pong: renderPong,
  snake: renderSnake,
  gameCatalog: renderGameCatalog,
  arrivals: renderArrivals,
  admin: renderAdmin,
};

let currentView = 'home';
const viewContainer = document.getElementById('view-container');

// Tracks the last vote round we've seen, so the socket handler can tell a
// genuinely new round (round number just changed while open) apart from a
// vote being cast or the round being closed — only the former deserves a
// "hey, go vote" nudge.
let lastVoteRound = null;

const ctx = {
  // Reload everything from the API, then re-render the active view. Use
  // after mutations whose effects aren't already carried by a socket event.
  refresh: async () => {
    await loadAll();
    renderCurrent();
  },
  // Re-render the active view from whatever is already in `state`, with no
  // network round trip. Use when a view already updated `state` itself
  // (e.g. a freshly drawn matchmaking result).
  rerender: () => renderCurrent(),
};

function renderCurrent() {
  const renderFn = VIEWS[currentView];
  if (renderFn) renderFn(viewContainer, ctx);
}

// Every deliberate tab switch pushes a browser history entry (see main()'s
// initial replaceState + the popstate listener below) — without this, the
// device's back button has no in-app navigation to undo and just leaves the
// tool entirely instead of jumping to whatever view was open before.
// `fromHistory` is set only when popstate itself calls this, so we render
// the view popstate already navigated the browser to instead of pushing
// another (identical) entry on top of it, which would trap back/forward in
// a loop between the same two states.
// `replace` swaps the current history entry for the target view instead of
// pushing a new one — for redirects away from an entry that must not stay
// reachable via the back button (e.g. a watch view whose match has ended;
// re-pushing would trap back/forward between the stale entry and its
// redirect target).
function switchView(view, { fromHistory = false, replace = false } = {}) {
  const changed = view !== currentView;
  currentView = view;
  // Realtime game modules use this marker to ignore updates while another
  // view is active. Without it, a running game can rebuild the current DOM
  // during navigation and make a tap appear to be lost.
  viewContainer.dataset.view = view;
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  // Restart the view-enter animation (see .view-enter in style.css). Only on
  // deliberate navigation — realtime-triggered re-renders of the same view
  // must never flash, so renderCurrent() alone doesn't do this.
  viewContainer.classList.remove('view-enter');
  void viewContainer.offsetWidth; // force reflow so removing+adding re-triggers
  viewContainer.classList.add('view-enter');
  // A little indicator on the profile icon points new/unset devices at
  // self-onboarding (name, avatar, skills, agent key) instead of leaving
  // them to stumble onto it.
  document.getElementById('profile-btn').classList.toggle('needs-setup', !getMyId());
  renderCurrent();
  viewContainer.scrollTop = 0;
  if (replace) {
    history.replaceState({ view }, '');
  } else if (!fromHistory && changed) {
    history.pushState({ view }, '');
  }
}

// Persistent "you are in admin mode" indicator: the banner under the topbar
// plus a body class as a styling hook. Admin mode also changes which players
// are visible (test users, see testFilter.js), so every toggle refetches.
function updateAdminIndicator() {
  document.getElementById('admin-banner').hidden = !isAdmin();
  document.body.classList.toggle('admin-mode', isAdmin());
}

function wireAdminMode() {
  updateAdminIndicator();
  document.getElementById('admin-banner-leave').addEventListener('click', () => {
    setAdmin(false);
    showToast('Admin-Modus verlassen.');
  });
  window.addEventListener('respawn:admin-changed', () => {
    updateAdminIndicator();
    ctx.refresh();
  });
}

async function tokenWorks(candidate) {
  try {
    const res = await fetch('/api/health', { headers: { 'x-access-token': candidate } });
    return res.ok;
  } catch {
    return false;
  }
}

// Gates the whole app behind the shared access token, if one is configured
// server-side (NFR-16). Resolves once a working token is stored.
//
// Invite links carry the token in the URL (?token=...): opening one logs in
// automatically without anyone having to type or paste anything, which is
// the whole point of sending a link instead of a password.
async function ensureAccess() {
  const meta = await api.meta();
  if (!meta.accessProtection) return;

  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl && (await tokenWorks(fromUrl))) {
    setToken(fromUrl);
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    return;
  }

  const existing = getToken();
  if (existing && (await tokenWorks(existing))) return;

  const loginScreen = document.getElementById('login-screen');
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-token');
  const errorEl = document.getElementById('login-error');

  loginScreen.hidden = false;

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const candidate = input.value.trim();
      if (!candidate) return;
      if (await tokenWorks(candidate)) {
        setToken(candidate);
        loginScreen.hidden = true;
        resolve();
      } else {
        errorEl.hidden = false;
        errorEl.textContent = 'Token ungültig – bitte erneut versuchen.';
      }
    });
  });
}

function wireNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('settings-btn').addEventListener('click', () => switchView('settings'));
  document.getElementById('profile-btn').addEventListener('click', () => switchView('profile'));

  // Views can request navigation to a non-bottom-nav view (settings,
  // analytics) by rendering a button with data-navigate="<view>", without
  // needing to import app.js themselves (would risk circular imports).
  viewContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-navigate]');
    if (btn) switchView(btn.dataset.navigate);
  });

  // Programmatic hooks for view modules that must drive navigation/redraws
  // from outside a click (e.g. the Tetris module jumping to the board view
  // when a realtime match starts, or refreshing its inline lobby on a socket
  // update). Kept as plain CustomEvents so modules stay decoupled from app.js.
  // detail is either the view name or { view, replace } (see switchView).
  window.addEventListener('respawn:navigate', (e) => {
    const detail = typeof e.detail === 'string' ? { view: e.detail } : e.detail ?? {};
    if (VIEWS[detail.view]) switchView(detail.view, { replace: detail.replace === true });
  });
  window.addEventListener('respawn:rerender', () => renderCurrent());

  // Back/forward: jump to whichever view is recorded on the popped entry
  // instead of re-pushing it (see switchView's fromHistory param). No
  // recorded state (extremely old entry, or a browser that fired this
  // without one) falls back to today's usual landing view.
  window.addEventListener('popstate', (e) => {
    const view = e.state?.view || (getMyId() ? 'home' : 'profile');
    switchView(view, { fromHistory: true });
  });

  // Tapping a push notification while the app is already open: the service
  // worker focuses this window and posts the target view (see sw.js) instead
  // of reloading the whole SPA just to change tabs.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate' && VIEWS[e.data.view]) switchView(e.data.view);
    });
  }
}

function wireSocket() {
  const socket = connectSocket();

  // These events carry no payload (or aren't worth special-casing) — just
  // reload everything. Infrequent (admin-type actions), so this is cheap.
  const fullReloadEvents = [
    'players:changed',
    'games:changed',
    'skills:changed',
    'leaderboard:changed',
    'events:changed',
  ];
  fullReloadEvents.forEach((event) =>
    socket.on(event, () => {
      invalidateMissingSkills();
      // Cheap enough to invalidate on every one of these (not just
      // leaderboard:changed, the only one that actually changes match
      // history) — the next time the Spiele view opens it just refetches.
      invalidateSkillSuggestions();
      // players:changed covers a renamed gamer/real name or new avatar —
      // both the Home board and the Sitzplan editor embed a snapshot of
      // player data alongside the layout, so they need the same treatment
      // or they'd keep showing the old name for the rest of the session on
      // any device that already has it cached.
      invalidateHomeSeating();
      invalidateSeating();
      ctx.refresh();
    })
  );

  // These events carry the fresh payload directly, so we can update state
  // and re-render without an extra round trip — important since live-status
  // updates can arrive frequently (every agent report + periodic sweep).
  socket.on('live:changed', (payload) => {
    // Socket payloads bypass apiFetch, so the test-user filter must run here.
    state.live = filterTestUsers(payload);
    invalidateMissingSkills(); // a newly-running game may now need a skill rating
    if (currentView === 'home') renderCurrent();
  });
  socket.on('votes:changed', (payload) => {
    const isNewRound = payload.open && payload.round !== lastVoteRound;
    if (!payload.open) invalidateVoteHistory(); // round just closed/cancelled
    lastVoteRound = payload.round;

    state.votes = payload;
    // Home shows an "Abstimmung läuft" status card driven by state.votes.
    if (currentView === 'votes' || currentView === 'home') renderCurrent();

    // Anyone with an identity gets nudged that a new vote opened, even if
    // they're not currently looking at the Votes tab — otherwise the only
    // way to notice is to happen to switch there. Skip it if they're already
    // on Votes: the view itself just updated in place, a toast on top would
    // just be noise.
    if (isNewRound && getMyId() && currentView !== 'votes') {
      showToast('🗳️ Neue Abstimmung gestartet – tippen zum Mitmachen', {
        duration: 4500,
        onClick: () => switchView('votes'),
      });
    }
  });
  // Carries the changed row directly (see routes/preferences.ts) so it can be
  // patched into state.preferences without a round trip. Preferences drive
  // the voting view's sort order/display (see votes.js) and the Spiele
  // view's "Bock" numbers (see gameCatalog.js), but aren't part of the votes
  // payload, so that one tally is refetched too — cheap compared to a full
  // reload, and makes a slider change on one device show up everywhere else
  // immediately instead of only after some other event happens to reload.
  socket.on('preferences:changed', async (payload) => {
    if (payload) {
      const { playerId, gameId, rating } = payload;
      const existing = state.preferences.find((p) => p.player_id === playerId && p.game_id === gameId);
      if (rating === null) {
        state.preferences = state.preferences.filter((p) => !(p.player_id === playerId && p.game_id === gameId));
      } else if (existing) {
        existing.rating = rating;
      } else {
        state.preferences.push({ player_id: playerId, game_id: gameId, rating });
      }
    }
    try {
      state.votes = await api.votes.get();
    } catch {
      // transient failure - keep the last known votes state, not worth surfacing
    }
    if (currentView === 'votes' || currentView === 'gameCatalog') renderCurrent();
  });
  socket.on('matchmaking:generated', (payload) => {
    state.lastMatchmaking = payload;
    invalidateMatchmakingHistory();
    if (currentView === 'matchmaking') renderCurrent();
  });
  // A draw's teams were fine-tuned (player moved) or a result was just
  // entered for it (Team-Historie -> Ergebnis-Historie) — refetch so
  // everyone's history view stays in sync.
  socket.on('matchmaking:draws-changed', (payload) => {
    invalidateMatchmakingHistory();
    // A result was just recorded for this draw elsewhere — the "gerade
    // ausgelost" panel (if still showing that same draw) disappears too,
    // not just Team-Historie.
    if (payload?.matchId && state.lastMatchmaking?.id === payload.id) {
      state.lastMatchmaking = null;
    }
    if (currentView === 'matchmaking') renderCurrent();
  });
  socket.on('tournaments:changed', (payload) => {
    invalidateTournaments();
    invalidateAktuellStatus();
    if (currentView === 'tournaments' || currentView === 'home') renderCurrent();

    // Same pattern as the vote nudge: only the players actually named in
    // this notification see it, and not if they're already looking at the
    // Turniere tab (it just updated in place).
    const myId = getMyId();
    if (payload?.notify && myId && payload.notify.playerIds.includes(myId) && currentView !== 'tournaments') {
      showToast(payload.notify.message, {
        duration: 5000,
        onClick: () => {
          focusTournament(payload.tournamentId);
          switchView('tournaments');
        },
      });
    }
  });
  // Every notifyPlayers() call on the server also lands here — refresh the
  // header notification center so new entries appear without a reload.
  socket.on('push:sent', () => {
    refreshNotificationBanner();
  });
  // A short-lived push topic was closed, completed or reached its deadline.
  // Refresh the center so its server-backed state remains current.
  socket.on('push:changed', refreshNotificationBanner);
  // Dismissals are personal: only refresh devices currently acting as the
  // player who marked this entry as seen.
  socket.on('push:seen', (payload) => {
    if (payload?.playerId === getMyId()) refreshNotificationBanner();
  });

  // Arcade lobbies opening/closing update the Home "Aktuell" card. The
  // Arcade views consume these payloads themselves; Home just refetches the
  // cross-game summary (GET /api/arcade/lobbies) instead of tracking four
  // different payload shapes.
  ['arcade:lobbies', 'tetris:lobbies', 'scribble:lobbies', 'pong:lobbies', 'blobby:lobbies', 'snake:lobbies'].forEach((event) =>
    socket.on(event, () => {
      invalidateAktuellStatus();
      if (currentView === 'home') renderCurrent();
    })
  );

  // Captain draft: the payload carries the full fresh state, so the Teams
  // view can re-render without a round trip. A newly started draft nudges
  // everyone who isn't already watching; a finished draft's teams land in
  // Team-Historie (see draft.ts), so just point people there instead of
  // pinning the result to the top of the page.
  socket.on('draft:changed', (payload) => {
    setDraftState(payload);
    invalidateMatchmakingHistory();
    if (currentView === 'matchmaking') renderCurrent();
    if (payload?.started && getMyId() && currentView !== 'matchmaking') {
      showToast('👑 Captain-Draft gestartet – tippen zum Zusehen', {
        duration: 5000,
        onClick: () => switchView('matchmaking'),
      });
    }
    if (payload?.completed) {
      showToast('👑 Draft abgeschlossen – Teams stehen in der Team-Historie', {
        duration: 5000,
        onClick: () => switchView('matchmaking'),
      });
    }
  });

  // Durchsagen land as a toast on every device — except the sender's, who
  // already got a "gesendet" confirmation from the form itself.
  socket.on('broadcast:new', (payload) => {
    invalidateBroadcasts();
    if (currentView === 'broadcast') renderCurrent();
    if (payload && payload.playerId !== getMyId()) {
      showToast(`📢 ${payload.playerName}: ${payload.message}`, { duration: 8000 });
    }
  });
  socket.on('broadcasts:changed', () => {
    invalidateBroadcasts();
    if (currentView === 'broadcast') renderCurrent();
  });

  socket.on('info:changed', () => {
    invalidateInfoBoard();
    if (currentView === 'infoBoard') renderCurrent();
  });

  socket.on('foodOrders:changed', (payload) => {
    invalidateFoodOrders();
    invalidateAktuellStatus();
    if (currentView === 'foodOrders' || currentView === 'home') renderCurrent();
    const myId = getMyId();
    if (payload?.notify && myId && myId !== payload.notify.excludePlayerId && currentView !== 'foodOrders') {
      showToast(payload.notify.message, {
        duration: 5000,
        onClick: () => switchView('foodOrders'),
      });
    }
  });

  socket.on('arrivals:changed', () => {
    invalidateArrivals();
    if (currentView === 'arrivals') renderCurrent();
  });
}

async function main() {
  await ensureAccess();
  document.getElementById('app').hidden = false;
  wireNav();
  wireAdminMode();
  wireSocket();
  initNotificationBanner();
  await loadAll();
  lastVoteRound = state.votes ? state.votes.round : null;
  // Nobody has set up "who am I" on this device yet (fresh invite link, new
  // phone, …) — send them straight into self-onboarding instead of the Home
  // view, so setting up name/avatar/skills/agent-key is the first thing
  // they see, not something they have to go looking for.
  // A push notification's deep link (e.g. /#votes, opened by sw.js when no
  // app window existed yet) overrides that default so the tap actually lands
  // where the notification promised.
  const hashView = location.hash.slice(1);
  const initialView = VIEWS[hashView] ? hashView : getMyId() ? 'home' : 'profile';
  // Establishes the base history entry the very first popstate can land on
  // (replace, not push — this page load shouldn't cost an extra back-step)
  // before any tab switch starts pushing entries on top of it.
  history.replaceState({ view: initialView }, '');
  switchView(initialView, { fromHistory: true });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  showToast(`Fehler beim Start: ${err.message}`, { error: true });
});
