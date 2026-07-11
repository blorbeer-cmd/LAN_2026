// Shared "what's currently active" status: an open vote, active tournaments,
// open food orders, waiting arcade lobbies, and (personal) unrated skills
// for currently-live games. Single source of truth for both Home's
// "Aktuell" section (full detail rows, see home.js) and the always-on
// header notification banner (compact chips, see notificationBanner.js) —
// so the same set of "current" things shows up consistently in both places
// instead of two independently-stale caches drifting apart. Returns plain
// data (aktuellItems()), not markup — each caller renders it however fits
// its own space.

import { api } from './api.js';
import { state } from './state.js';
import { formatDateTime } from './format.js';
import { getMyId } from './whoami.js';

let statusCache = null; // { tournaments, foodOrders, arcadeLobbies }
let statusLoading = false;
let missingSkillsCache = null;
let missingSkillsLoadedForId = null;
let missingSkillsLoading = false;

// Fired whenever a (re)load completes, so anything showing this data (Home,
// the header banner) can re-render without needing its own poll loop.
function notifyChanged() {
  window.dispatchEvent(new CustomEvent('lan:aktuell-changed'));
}

async function loadStatus() {
  statusLoading = true;
  try {
    const [tournaments, foodOrders, arcadeLobbies] = await Promise.all([
      api.tournaments.list(),
      api.foodOrders.list(),
      api.arcade.lobbies(),
    ]);
    statusCache = {
      tournaments,
      foodOrders: foodOrders.orders ?? [],
      arcadeLobbies: arcadeLobbies.lobbies ?? [],
    };
  } catch {
    statusCache = { tournaments: [], foodOrders: [], arcadeLobbies: [] };
  } finally {
    statusLoading = false;
    notifyChanged();
  }
}

async function loadMissingSkills(myId) {
  missingSkillsLoading = true;
  try {
    const res = await api.digest.get(myId);
    missingSkillsCache = res.missingSkills;
    missingSkillsLoadedForId = myId;
  } catch {
    missingSkillsCache = null;
    missingSkillsLoadedForId = null;
  } finally {
    missingSkillsLoading = false;
    notifyChanged();
  }
}

// Kicks off whatever's missing/stale for the current identity. Safe to call
// from anywhere (Home's render, the header banner's init) — a no-op while a
// load for the same thing is already in flight.
export function ensureAktuellLoaded() {
  if (statusCache === null && !statusLoading) loadStatus();
  const myId = getMyId();
  if (myId && missingSkillsLoadedForId !== myId && !missingSkillsLoading) loadMissingSkills(myId);
}

// Called on the socket events that actually change this data (see app.js) —
// unlike a plain invalidate, this refetches right away: the header banner
// has to stay live even while nobody's looking at Home to lazily trigger a
// reload on render.
export function invalidateAktuellStatus() {
  statusCache = null;
  loadStatus();
}

export function invalidateMissingSkills() {
  missingSkillsCache = null;
  missingSkillsLoadedForId = null;
  const myId = getMyId();
  if (myId) loadMissingSkills(myId);
}

const FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga',
  group_knockout: 'Gruppen + K.O.',
};

// { iconName, title, sub, navigate }[] — sub is dropped by callers with
// less room (the banner's compact chips); title/sub are raw text, not yet
// HTML-escaped, so every caller escapes at its own render time.
export function aktuellItems() {
  const items = [];

  // Personal nudge first — nobody else would otherwise learn you still owe
  // a rating for a game everyone can already see running.
  for (const g of missingSkillsCache ?? []) {
    items.push({
      iconName: 'star',
      title: `Skill für ${g.name} bewerten`,
      sub: 'Wird gerade gespielt',
      navigate: 'gameCatalog',
    });
  }

  if (state.votes?.open) {
    const voters = state.votes.totalVoters ?? 0;
    items.push({
      iconName: 'vote',
      title: state.votes.title || 'Abstimmung läuft',
      sub: `${voters} Teilnehmer bisher`,
      navigate: 'votes',
    });
  }

  for (const t of (statusCache?.tournaments ?? []).filter((t) => t.status === 'active')) {
    items.push({
      iconName: 'swords',
      title: t.name,
      sub: `${t.gameName} · ${FORMAT_LABELS[t.format] ?? t.format}`,
      navigate: 'tournaments',
    });
  }

  for (const o of (statusCache?.foodOrders ?? []).filter((o) => o.open)) {
    items.push({
      iconName: 'hamburger',
      title: `Sammelbestellung „${o.title}"`,
      sub: o.sendAt ? `Geht raus um ${formatDateTime(o.sendAt)} Uhr` : 'Zeitpunkt noch offen',
      navigate: 'foodOrders',
    });
  }

  for (const l of statusCache?.arcadeLobbies ?? []) {
    items.push({
      iconName: 'joystick',
      title: `${l.title}-Lobby offen`,
      sub: `Von ${l.hostName} · ${l.playerCount} ${l.playerCount === 1 ? 'wartet' : 'warten'}`,
      navigate: 'arcade',
    });
  }

  return items;
}
