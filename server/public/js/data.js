// Central data loading: refetches everything from the REST API into the
// shared state. Simple "reload it all" approach — cheap at LAN-party scale
// (~15 players) and avoids subtle bugs from partial/stale partial updates.

import { api } from './api.js';
import { state } from './state.js';

export async function loadAll() {
  const [players, games, skills, preferences, live, votes, matches, leaderboard, playtime, events] =
    await Promise.all([
      api.players.list(),
      api.games.list(),
      api.skills.list(),
      api.preferences.list(),
      api.live.board(),
      api.votes.get(),
      api.matches.list(),
      api.leaderboard.get(state.selectedGameId || undefined),
      api.stats.playtime(state.selectedGameId || undefined),
      api.events.list(),
    ]);
  Object.assign(state, { players, games, skills, preferences, live, votes, matches, leaderboard, playtime, events });
}
