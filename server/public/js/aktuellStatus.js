// Shared "what's currently active" status: an open vote, active tournaments,
// open food orders, waiting arcade lobbies, and (personal) unrated skills
// for currently-live games. Single source of truth for Home's "Aktuell"
// section (see home.js). Returns plain data via aktuellItems(), not markup.

import { api } from './api.js';
import { state } from './state.js';
import { formatDateTime } from './format.js';
import { getMyId } from './whoami.js';
import { domainIcon } from './domainIcons.js';

let statusCache = null; // { tournaments, foodOrders, arcadeLobbies }
let statusLoading = false;
let missingSkillsCache = null;
let missingSkillsLoadedForId = null;
let missingSkillsLoading = false;

const DISMISSED_STORAGE_PREFIX = 'respawn_home_current_dismissed';
const MAX_DISMISSED_ITEMS = 100;
const MAX_ITEM_ID_LENGTH = 200;
export const FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS = 60 * 60 * 1000;
const memoryDismissals = new Map();

function dismissalScope({ playerId = getMyId(), eventId = state.activeEvent?.id ?? 'base' } = {}) {
  if (!playerId) return null;
  return `${DISMISSED_STORAGE_PREFIX}:${encodeURIComponent(playerId)}:${encodeURIComponent(eventId || 'base')}`;
}

function browserStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function dismissedIds(scope, storage) {
  const ids = new Set(memoryDismissals.get(scope) ?? []);
  try {
    const stored = JSON.parse(storage?.getItem(scope) ?? '[]');
    if (Array.isArray(stored)) {
      for (const id of stored.slice(-MAX_DISMISSED_ITEMS)) {
        if (typeof id === 'string' && id.length > 0 && id.length <= MAX_ITEM_ID_LENGTH) ids.add(id);
      }
    }
  } catch {
    // A blocked or corrupt localStorage must not make Home unusable. The
    // in-memory fallback still keeps the dismissal for this browser session.
  }
  return ids;
}

// "Aktuell" is derived live state rather than a second notification feed.
// Dismissals therefore stay client-side, scoped to the signed-in identity
// and active event, and use lifecycle-specific item ids (vote round, lobby
// id, etc.) so the next genuinely new occurrence becomes visible again.
export function dismissAktuellItem(itemId, options = {}) {
  if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > MAX_ITEM_ID_LENGTH) return false;
  const scope = dismissalScope(options);
  if (!scope) return false;
  const storage = browserStorage(options.storage);
  const ids = dismissedIds(scope, storage);
  ids.delete(itemId);
  ids.add(itemId);
  while (ids.size > MAX_DISMISSED_ITEMS) ids.delete(ids.values().next().value);
  memoryDismissals.set(scope, ids);
  try {
    storage?.setItem(scope, JSON.stringify([...ids]));
  } catch {
    // See dismissedIds(): session-local behavior is the safe fallback.
  }
  return true;
}

export function filterDismissedAktuellItems(items, options = {}) {
  const scope = dismissalScope(options);
  if (!scope) return items;
  const hidden = dismissedIds(scope, browserStorage(options.storage));
  return items.filter((item) => !hidden.has(item.id));
}

export function missingSkillAktuellId(gameId, livePlayers = state.live) {
  if (typeof gameId !== 'string' || !gameId) return null;
  const starts = [];
  for (const player of livePlayers ?? []) {
    for (const game of player.games ?? []) {
      if (game.game_id === gameId && Number.isFinite(game.since)) starts.push(game.since);
    }
  }
  if (starts.length === 0) return null;
  return `skill:${gameId}:${Math.min(...starts)}`;
}

// Food orders already have a stable Home identity. When the current player
// still owes items, enrich that same entry instead of adding a second one for
// the reminder push. A finalized order cannot be paid in the UI anymore, so
// it does not become a payment nudge.
export function foodOrderAktuellItem(order, myId, now = Date.now()) {
  const unpaidOwnItems = myId
    ? (order.items ?? []).filter((item) => item.playerId === myId && !item.paid)
    : [];
  const paymentReminderDue =
    unpaidOwnItems.length > 0 &&
    !order.finalizedAt &&
    Number.isFinite(order.closedAt) &&
    now >= order.closedAt + FOOD_ORDER_PAYMENT_REMINDER_DELAY_MS;
  const paymentDue = paymentReminderDue;
  if (!order.open && !paymentDue) return null;

  return {
    id: `food-order:${order.id}`,
    iconName: domainIcon('foodOrders'),
    title: paymentDue ? `Sammelbestellung „${order.title}" bezahlen` : `Sammelbestellung „${order.title}"`,
    sub: paymentDue
      ? `${unpaidOwnItems.length} ${unpaidOwnItems.length === 1 ? 'Position' : 'Positionen'} noch offen`
      : order.sendAt
        ? `Versand ${formatDateTime(order.sendAt)} Uhr`
        : 'Zeitpunkt noch offen',
    navigate: 'foodOrders',
    target: { type: 'order', id: order.id },
  };
}

// Fired whenever a (re)load completes, so Home can re-render without its own
// poll loop.
function notifyChanged() {
  window.dispatchEvent(new CustomEvent('respawn:aktuell-changed'));
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
// from Home's render — a no-op while a load for the same thing is already in
// flight.
export function ensureAktuellLoaded() {
  if (statusCache === null && !statusLoading) loadStatus();
  const myId = getMyId();
  if (myId && missingSkillsLoadedForId !== myId && !missingSkillsLoading) loadMissingSkills(myId);
}

// Called on socket events that change this data (see app.js). Refetching
// right away keeps an already-open Home view current.
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

// { id, iconName, title, sub, navigate }[] — title/sub are raw text, not yet
// HTML-escaped, so the caller escapes them while rendering. The id names the
// live occurrence, not just its category, so dismissing one vote/lobby never
// suppresses the next one.
export function aktuellItems() {
  const items = [];

  // Personal nudge first — nobody else would otherwise learn you still owe
  // a rating for a game everyone can already see running.
  for (const g of missingSkillsCache ?? []) {
    const id = missingSkillAktuellId(g.id);
    // The digest is group-wide while state.live belongs to the active event.
    // Only show a nudge when that event has a concrete live occurrence whose
    // start can make a later play session visible again after dismissal.
    if (!id) continue;
    items.push({
      id,
      iconName: domainIcon('skill'),
      title: `Skill für ${g.name} bewerten`,
      sub: 'Wird gerade gespielt',
      navigate: 'gameCatalog',
    });
  }

  if (state.votes?.open) {
    const voters = state.votes.totalVoters ?? 0;
    items.push({
      id: `vote:${state.votes.round}`,
      iconName: domainIcon('votes'),
      title: state.votes.title || 'Abstimmung läuft',
      sub: `${voters} Teilnehmer bisher`,
      navigate: 'votes',
    });
  }

  for (const t of (statusCache?.tournaments ?? []).filter((t) => t.status === 'active')) {
    items.push({
      id: `tournament:${t.id}`,
      iconName: domainIcon('tournaments'),
      title: t.name,
      sub: `${t.gameName} · ${FORMAT_LABELS[t.format] ?? t.format}`,
      navigate: 'tournaments',
    });
  }

  const myId = getMyId();
  for (const o of statusCache?.foodOrders ?? []) {
    const item = foodOrderAktuellItem(o, myId);
    if (item) items.push(item);
  }

  for (const l of statusCache?.arcadeLobbies ?? []) {
    items.push({
      id: `arcade-lobby:${l.gameType}:${l.id}`,
      iconName: domainIcon('arcade'),
      title: `${l.title}-Lobby offen`,
      sub: `Von ${l.hostName} · ${l.playerCount} ${l.playerCount === 1 ? 'wartet' : 'warten'}`,
      navigate: 'arcade',
    });
  }

  return filterDismissedAktuellItems(items);
}
