// Shared "what's currently active" status: open votes, active tournaments,
// open food orders and waiting arcade lobbies. Single source of truth for
// Home's "Aktuell" section (see home.js). Returns plain data via
// aktuellItems(), not markup. Personal obligations — paying an order,
// answering an invitation, rating the skill of a game being played — live in
// "Meine To-Dos" (myTodos.js); this module still loads the unrated-skill
// digest and hands it over through missingSkillNudges().

import { api } from './api.js';
import { state } from './state.js';
import { formatDateTime } from './format.js';
import { getMyId } from './whoami.js';
import { domainIcon } from './domainIcons.js';
import { pendingVoteRounds } from './myTodos.js';

let statusCache = null; // { tournaments, foodOrders, arcadeLobbies }
let statusLoading = false;
let statusRequest = null;
let statusGeneration = 0;
let missingSkillsCache = null;
let missingSkillsLoadedForId = null;
let missingSkillsLoading = false;

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

// An open order is something happening right now. Paying for it afterwards
// is a personal To-Do in "Meine To-Dos", not a second "Aktuell" entry.
export function foodOrderAktuellItem(order) {
  if (!order.open) return null;
  return {
    id: `food-order:${order.id}`,
    iconName: domainIcon('foodOrders'),
    title: `Sammelbestellung „${order.title}"`,
    sub: order.sendAt ? `Versand ${formatDateTime(order.sendAt)} Uhr` : 'Zeitpunkt noch offen',
    navigate: 'foodOrders',
    target: { type: 'order', id: order.id },
  };
}

// Once the active event's period is over, a still-open Vote or tournament is
// no longer "running" — it is left behind, and whoever can end it finds it in
// "Meine To-Dos". The permanent base workspace has no end and never hides them.
export function activeEventPeriodOver(event, now = Date.now()) {
  if (!event) return false;
  if (event.isEnded || event.status === 'ended') return true;
  return event.endsAt != null && event.endsAt <= now;
}

// Fired whenever a (re)load completes, so Home can re-render without its own
// poll loop.
function notifyChanged() {
  window.dispatchEvent(new CustomEvent('respawn:aktuell-changed'));
}

function statusScopeKey() {
  return state.activeEvent?.id ?? 'base';
}

function loadStatus() {
  if (statusRequest) return statusRequest;

  const requestGeneration = statusGeneration;
  const requestScope = statusScopeKey();
  const isCurrent = () => requestGeneration === statusGeneration && requestScope === statusScopeKey();
  statusLoading = true;
  const run = (async () => {
    try {
      const [tournaments, foodOrders, arcadeLobbies] = await Promise.allSettled([
        api.tournaments.list(),
        api.foodOrders.list(),
        api.arcade.lobbies(),
      ]);
      if (isCurrent()) {
        statusCache = {
          tournaments: tournaments.status === 'fulfilled' ? tournaments.value : [],
          foodOrders: foodOrders.status === 'fulfilled' ? foodOrders.value.orders ?? [] : [],
          arcadeLobbies: arcadeLobbies.status === 'fulfilled' ? arcadeLobbies.value.lobbies ?? [] : [],
        };
      }
    } catch {
      if (isCurrent()) statusCache = { tournaments: [], foodOrders: [], arcadeLobbies: [] };
    } finally {
      if (statusRequest === run) {
        statusRequest = null;
        statusLoading = false;
        if (isCurrent()) {
          notifyChanged();
        } else if (statusCache === null) {
          // The active event changed while this request was in flight. Start
          // exactly one fresh request for the new scope after releasing the
          // single-flight slot; stale data and stale failures stay discarded.
          void loadStatus();
        }
      }
    }
  })();
  statusRequest = run;
  return run;
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
  statusGeneration += 1;
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

// Unrated skills of games being played right now, as "Meine To-Dos" rows
// input: { game, id } where the id names the live occurrence.
export function missingSkillNudges(livePlayers = state.live) {
  const nudges = [];
  for (const game of missingSkillsCache ?? []) {
    const id = missingSkillAktuellId(game.id, livePlayers);
    // The digest is group-wide while state.live belongs to the active event.
    // Only nudge when that event has a concrete live occurrence whose start
    // distinguishes a later play session as its own entry.
    if (id) nudges.push({ game, id });
  }
  return nudges;
}

// { id, iconName, title, sub, navigate }[] — title/sub are raw text, not yet
// HTML-escaped, so the caller escapes them while rendering. The id names the
// live occurrence, not just its category, so a resolved vote/lobby drops out
// while the next genuinely new occurrence appears as its own entry.
export function aktuellItems(now = Date.now()) {
  const items = [];
  const periodOver = activeEventPeriodOver(state.activeEvent, now);
  const unvoted = new Set(pendingVoteRounds());

  if (!periodOver) {
    for (const vote of (state.votes?.openRounds ?? (state.votes?.open ? [state.votes] : []))) {
      const voters = vote.totalVoters ?? 0;
      items.push({
        id: `vote:${vote.round}`,
        iconName: domainIcon('votes'),
        title: vote.title || 'Abstimmung läuft',
        sub: [unvoted.has(vote.round) ? 'Du hast noch nicht abgestimmt' : '', `${voters} Teilnehmer bisher`]
          .filter(Boolean)
          .join(' · '),
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
        target: { type: 'tournament', id: t.id },
      });
    }
  }

  for (const o of statusCache?.foodOrders ?? []) {
    const item = foodOrderAktuellItem(o);
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

  return items;
}
