// App bootstrap: token gate, tab switching, and wiring realtime events into
// the shared state. Kept as one small orchestrator so each view module stays
// focused on its own rendering logic.

import { api, getToken, setToken } from './api.js';
import { connectSocket } from './socket.js';
import { state } from './state.js';
import { loadAll } from './data.js';
import { showToast } from './toast.js';
import { getMyId } from './whoami.js';
import { renderLive } from './views/live.js';
import { renderPlayers } from './views/players.js';
import { renderGames } from './views/games.js';
import { renderMatchmaking, invalidateMatchmakingHistory } from './views/matchmaking.js';
import { renderVotes, invalidateVoteHistory } from './views/votes.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { renderAnalytics } from './views/analytics.js';
import { renderProfile } from './views/profile.js';
import { renderTournaments, invalidateTournaments } from './views/tournament.js';

const VIEWS = {
  live: renderLive,
  players: renderPlayers,
  matchmaking: renderMatchmaking,
  votes: renderVotes,
  leaderboard: renderLeaderboard,
  settings: renderGames,
  analytics: renderAnalytics,
  profile: renderProfile,
  tournaments: renderTournaments,
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
    'leaderboard:changed',
    'events:changed',
  ];
  fullReloadEvents.forEach((event) => socket.on(event, () => ctx.refresh()));

  // These events carry the fresh payload directly, so we can update state
  // and re-render without an extra round trip — important since live-status
  // updates can arrive frequently (every agent report + periodic sweep).
  socket.on('live:changed', (payload) => {
    state.live = payload;
    if (currentView === 'live') renderCurrent();
  });
  socket.on('votes:changed', (payload) => {
    const isNewRound = payload.open && payload.round !== lastVoteRound;
    if (!payload.open) invalidateVoteHistory(); // round just closed/cancelled
    lastVoteRound = payload.round;

    state.votes = payload;
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
  socket.on('tournaments:changed', () => {
    invalidateTournaments();
    if (currentView === 'tournaments') renderCurrent();
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
