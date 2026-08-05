// Single shared in-memory store. app.js is the only place deciding *when* to
// re-render (on tab switch or a relevant realtime event), so this stays a
// plain mutable object rather than a full pub/sub system — one moving part
// less to get wrong.

export const state = {
  players: [],
  games: [],
  skills: [],
  preferences: [],
  live: [],
  votes: null,
  matches: [],
  leaderboard: null,
  playtime: null,
  playtimeAllGames: null,
  events: [],
  selectedGameId: null, // remembers the last game picked in Teams/Turniere/Rangliste
  lastMatchmaking: null, // last drawn teams, shared live across all clients
};

export function playerById(id) {
  return state.players.find((p) => p.id === id);
}

export function gameById(id) {
  return state.games.find((g) => g.id === id);
}

// The accepted games: everything that made it out of the suggestion pool into
// the catalog. Every place that picks a game to actually play — Vote, Turnier,
// Auslosung/Draft, Ergebnis eintragen — offers only these, so a suggestion
// nobody has accepted yet can't be scheduled and those pickers stay short.
// The Spiele view itself is the one place that still shows suggestions (own
// tab, or mixed into "Alle" with a Vorschlag badge), since rating and
// promoting them is exactly its job.
export function catalogGames() {
  return state.games.filter((g) => !g.isSuggestion);
}
