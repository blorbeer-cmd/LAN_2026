// Central data loading: refetches everything from the REST API into the
// shared state. Simple "reload it all" approach — cheap at LAN-party scale
// (~15 players) and avoids subtle bugs from partial/stale partial updates.

import { api } from './api.js';
import { state } from './state.js';
import { filterTestUsers } from './testFilter.js';

let latestLoadGeneration = 0;

export function beginDataLoad() {
  latestLoadGeneration += 1;
  return latestLoadGeneration;
}

export function isCurrentDataLoad(generation) {
  return generation === latestLoadGeneration;
}

export function normalizeEventContext(eventContext = {}) {
  const availableEvents = eventContext.availableEvents ?? [];
  const managedEvents = eventContext.managedEvents ?? [];
  const canManage = Array.isArray(eventContext.managedEvents);
  return {
    events: canManage ? managedEvents : availableEvents,
    // `null` for a member, so a view can tell "no management rights" from
    // "admin without any event" instead of guessing from an empty list.
    managedEvents: canManage ? managedEvents : null,
    activeEvent: eventContext.activeEvent ?? null,
    availableEvents,
    // This account's own accepted events that have since ended. Deliberately
    // absent from `availableEvents` (that list answers "where can I switch
    // to", see routes/events.ts), but the Events tab's own Historie section
    // renders it for a member the same way `managedEvents` already does for
    // owner/admin.
    endedEvents: eventContext.endedEvents ?? [],
    // Personal participation history: the allowlist the analytics endpoints
    // accept, so an event filter can never offer something they answer with
    // a 404. Falls back to the switchable workspaces so an older server
    // payload still yields a usable filter instead of an empty one.
    historicalEvents: eventContext.historicalEvents ?? availableEvents,
    eventInvitations: eventContext.invitations ?? [],
  };
}

export async function loadAll() {
  const generation = beginDataLoad();
  const playtimeAllGamesPromise = api.stats.playtime();
  const playtimePromise = state.selectedGameId
    ? api.stats.playtime(state.selectedGameId)
    : playtimeAllGamesPromise;
  const [players, games, skills, preferences, live, votes, matches, leaderboard, playtime, playtimeAllGames, eventContext] =
    await Promise.all([
      api.players.list(),
      api.games.list(),
      api.skills.list(),
      api.preferences.list(),
      api.live.board(),
      api.votes.get(),
      api.matches.list(),
      api.leaderboard.get(state.selectedGameId || undefined),
      playtimePromise,
      playtimeAllGamesPromise,
      api.events.list(),
    ]);
  if (!isCurrentDataLoad(generation)) return false;
  // apiFetch already filters test users per response, but within this
  // parallel batch a payload that only carries player IDs (leaderboard,
  // playtime, …) may have been processed before the roster taught the
  // filter which IDs are test users — run everything through once more now
  // that the roster has definitely been seen (idempotent otherwise).
  const normalizedEventContext = normalizeEventContext(eventContext);
  Object.assign(state, filterTestUsers({
    players,
    games,
    skills,
    preferences,
    live,
    votes,
    matches,
    leaderboard,
    playtime,
    playtimeAllGames,
    ...normalizedEventContext,
  }));
  return true;
}
