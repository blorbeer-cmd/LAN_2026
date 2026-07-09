// App bootstrap: token gate, tab switching, and wiring realtime events into
// the shared state. Kept as one small orchestrator so each view module stays
// focused on its own rendering logic.

import { api, getToken, setToken } from './api.js';
import { connectSocket } from './socket.js';
import { state } from './state.js';
import { loadAll } from './data.js';
import { showToast } from './toast.js';
import { getMyId } from './whoami.js';
import { renderLive, invalidatePings, invalidateDigest } from './views/live.js';
import { renderPlayers } from './views/players.js';
import { renderGames } from './views/games.js';
import { renderMatchmaking, invalidateMatchmakingHistory, setDraftState } from './views/matchmaking.js';
import { renderBroadcast, invalidateBroadcasts } from './views/broadcast.js';
import { renderInfoBoard, invalidateInfoBoard } from './views/infoBoard.js';
import { renderFoodOrders, invalidateFoodOrders } from './views/foodOrders.js';
import { renderGameCatalog, invalidateGameCatalog } from './views/gameCatalog.js';
import { renderVotes, invalidateVoteHistory } from './views/votes.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { renderAnalytics } from './views/analytics.js';
import { renderGameStats } from './views/gameStats.js';
import { renderProfile } from './views/profile.js';
import { renderTournaments, invalidateTournaments, focusTournament } from './views/tournament.js';
import { renderHallOfFame } from './views/hallOfFame.js';
import { renderSeating } from './views/seating.js';
import { renderMyStats } from './views/myStats.js';
import { renderMore } from './views/more.js';

const VIEWS = {
  live: renderLive,
  players: renderPlayers,
  matchmaking: renderMatchmaking,
  votes: renderVotes,
  leaderboard: renderLeaderboard,
  settings: renderGames,
  analytics: renderAnalytics,
  gameStats: renderGameStats,
  profile: renderProfile,
  tournaments: renderTournaments,
  hallOfFame: renderHallOfFame,
  seating: renderSeating,
  myStats: renderMyStats,
  more: renderMore,
  broadcast: renderBroadcast,
  infoBoard: renderInfoBoard,
  foodOrders: renderFoodOrders,
  gameCatalog: renderGameCatalog,
};

let currentView = 'live';
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

function switchView(view) {
  currentView = view;
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
}

function wireSocket() {
  const socket = connectSocket();
  const dot = document.getElementById('conn-dot');
  socket.on('connect', () => dot.classList.add('connected'));
  socket.on('disconnect', () => dot.classList.remove('connected'));

  // These events carry no payload (or aren't worth special-casing) — just
  // reload everything. Infrequent (admin-type actions), so this is cheap.
  const fullReloadEvents = [
    'players:changed',
    'games:changed',
    'skills:changed',
    'preferences:changed',
    'leaderboard:changed',
    'events:changed',
  ];
  fullReloadEvents.forEach((event) =>
    socket.on(event, () => {
      invalidateDigest();
      ctx.refresh();
    })
  );

  // These events carry the fresh payload directly, so we can update state
  // and re-render without an extra round trip — important since live-status
  // updates can arrive frequently (every agent report + periodic sweep).
  socket.on('live:changed', (payload) => {
    state.live = payload;
    invalidateDigest(); // a newly-running game may now need a skill rating
    if (currentView === 'live') renderCurrent();
  });
  socket.on('votes:changed', (payload) => {
    const isNewRound = payload.open && payload.round !== lastVoteRound;
    if (!payload.open) invalidateVoteHistory(); // round just closed/cancelled
    lastVoteRound = payload.round;

    state.votes = payload;
    invalidateDigest();
    if (currentView === 'votes') renderCurrent();

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
  socket.on('matchmaking:generated', (payload) => {
    state.lastMatchmaking = payload;
    invalidateMatchmakingHistory();
    if (currentView === 'matchmaking') renderCurrent();
  });
  socket.on('tournaments:changed', (payload) => {
    invalidateTournaments();
    invalidateDigest();
    if (currentView === 'tournaments') renderCurrent();

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
  socket.on('pings:changed', (payload) => {
    invalidatePings();
    if (currentView === 'live') renderCurrent();

    // Everyone except the pinger gets a nudge, same exclusion-based targeting
    // the server already used for the toast message.
    const myId = getMyId();
    if (payload?.notify && myId && myId !== payload.notify.excludePlayerId && currentView !== 'live') {
      showToast(payload.notify.message, {
        duration: 4500,
        onClick: () => switchView('live'),
      });
    }
  });

  // Captain draft: the payload carries the full fresh state, so the Teams
  // view can re-render without a round trip. A newly started draft nudges
  // everyone who isn't already watching.
  socket.on('draft:changed', (payload) => {
    setDraftState(payload);
    if (currentView === 'matchmaking') renderCurrent();
    if (payload?.started && getMyId() && currentView !== 'matchmaking') {
      showToast('👑 Captain-Draft gestartet – tippen zum Zusehen', {
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

  socket.on('info:changed', () => {
    invalidateInfoBoard();
    if (currentView === 'infoBoard') renderCurrent();
  });

  socket.on('foodOrders:changed', (payload) => {
    invalidateFoodOrders();
    if (currentView === 'foodOrders') renderCurrent();
    const myId = getMyId();
    if (payload?.notify && myId && myId !== payload.notify.excludePlayerId && currentView !== 'foodOrders') {
      showToast(payload.notify.message, {
        duration: 5000,
        onClick: () => switchView('foodOrders'),
      });
    }
  });

  socket.on('gameCatalog:changed', () => {
    invalidateGameCatalog();
    if (currentView === 'gameCatalog') renderCurrent();
  });
}

async function main() {
  await ensureAccess();
  document.getElementById('app').hidden = false;
  wireNav();
  wireSocket();
  await loadAll();
  lastVoteRound = state.votes ? state.votes.round : null;
  // Nobody has set up "who am I" on this device yet (fresh invite link, new
  // phone, …) — send them straight into self-onboarding instead of the Live
  // board, so setting up name/avatar/skills/agent-key is the first thing
  // they see, not something they have to go looking for.
  switchView(getMyId() ? 'live' : 'profile');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  showToast(`Fehler beim Start: ${err.message}`, { error: true });
});
