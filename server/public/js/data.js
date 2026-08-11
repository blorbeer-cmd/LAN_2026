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

export async function loadAll() {
  const generation = beginDataLoad();
  const playtimeAllGamesPromise = api.stats.playtime();
  const playtimePromise = state.selectedGameId
    ? api.stats.playtime(state.selectedGameId)
    : playtimeAllGamesPromise;
  const [players, games, skills, preferences, live, votes, matches, leaderboard, playtime, playtimeAllGames, events] =
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
  Object.assign(
    state,
    filterTestUsers({ players, games, skills, preferences, live, votes, matches, leaderboard, playtime, playtimeAllGames, events })
  );
  return true;
}
