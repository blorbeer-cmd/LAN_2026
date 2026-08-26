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
  managedEvents: null, // owner/admin only; null means "no management rights"
  activeEvent: null,
  availableEvents: [],
  plannedEvents: [], // compatibility field; generic polls never add event visibility
  endedEvents: [], // this account's own accepted events that have since ended (member Historie)
  historicalEvents: [], // every event this account accepted at some point, ended ones included
  eventInvitations: [],
  declinedEvents: [], // events this account declined; still visible as a teaser, never selectable
  eventTypeOptions: [],
  selectedGameId: null, // remembers the last game picked in Teams/Turniere/Rangliste
  lastMatchmaking: null, // last drawn teams, shared live across all clients
};

export function playerById(id) {
  return state.players.find((p) => p.id === id);
}

// Everyone allowed to be entered as a participant of the active workspace —
// the pool a player picker that draws teams or starts a draft must offer.
// Selecting someone outside this set fails server-side
// (competitionPlayersBelongToGroup) with a confusing 404 on submit, because
// only accepted event participants can be recorded against it. Falls back to
// the full roster when the active event hasn't reported its participant ids
// yet (an older cached payload, or before the first load completes) so a
// picker never renders empty instead of merely unfiltered.
// Used by matchmaking.js's draw/draft pickers; tournament.js's player picker
// for tournament creation is not wired up to this yet (same underlying gap,
// left out of this change's scope — see the PR description).
export function eventPlayers() {
  const participantIds = state.activeEvent?.participantIds;
  if (!participantIds) return state.players;
  const allowed = new Set(participantIds);
  return state.players.filter((p) => allowed.has(p.id));
}

export function gameById(id) {
  return state.games.find((g) => g.id === id);
}

// Event *management* needs every event of the group (state.managedEvents,
// owner/admin only). Data selectors must not offer those: personal analytics
// aggregate only events this account actually accepted at some point
// (resolveAnalyticsEvents on the server), so an event an admin manages but
// never joined would answer their own event filter with a 404.
//
// state.historicalEvents is exactly that accepted set — including the
// permanent base event and, unlike state.availableEvents, the events that
// have already ended. A finished LAN is the main thing anyone opens an event
// filter for, and the workspace list deliberately drops it because it can no
// longer be *worked in*. Same list for every role.
export function accessibleEvents() {
  return state.historicalEvents ?? [];
}

// The workspaces the account can actually switch into right now. Besides
// confirmed participation this includes an explicit "Interesse", so planning
// polls remain reachable before a final commitment. The topbar switcher is
// its only consumer; everything historical belongs above.
export function selectableEventWorkspaces() {
  return state.availableEvents ?? [];
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

// Games a picker must keep reachable even after a demotion: the catalog plus
// every game the group already produced data for. A suggestion may not be
// picked to play (catalogGames() above), but a game moved back to the
// suggestions after it was drawn or played still owns a ranking, an open draw
// and that draw's "Ergebnis eintragen"/"Rematch" actions — dropping it from
// the picker would strand exactly those. Pass extra ids for data the client
// knows about outside state.matches (e.g. the freshly drawn lineup).
export function gamesWithHistory(extraGameIds = []) {
  const kept = new Set(extraGameIds.filter(Boolean));
  for (const match of state.matches) kept.add(match.gameId);
  return state.games.filter((game) => !game.isSuggestion || kept.has(game.id));
}
