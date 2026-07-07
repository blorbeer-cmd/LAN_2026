// Single shared in-memory store. app.js is the only place deciding *when* to
// re-render (on tab switch or a relevant realtime event), so this stays a
// plain mutable object rather than a full pub/sub system — one moving part
// less to get wrong.

export const state = {
  players: [],
  games: [],
  skills: [],
  live: [],
  votes: null,
  matches: [],
  leaderboard: null,
  playtime: null,
  events: [],
  selectedGameId: null, // remembers the last game picked in Teams/Rangliste
  lastMatchmaking: null, // last drawn teams, shared live across all clients
};

export function playerById(id) {
  return state.players.find((p) => p.id === id);
}

export function gameById(id) {
  return state.games.find((g) => g.id === id);
}
