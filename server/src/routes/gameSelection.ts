// Shared rule for every endpoint where a game is picked to actually be
// played: only accepted catalog games qualify. A suggestion is still an open
// proposal — it collects Bock/Skill ratings in the Spiele view, but it must
// not end up on a ballot, in a tournament, in a drawn/drafted lineup or in a
// recorded result. The frontend hides suggestions from those pickers
// (catalogGames() in public/js/state.js); this is the server-side half of
// the same rule, so a stale client or a direct API call cannot slip one in.

export const SUGGESTION_GAME_ERROR = 'Dieses Spiel ist nur ein Vorschlag. Bitte zuerst in den Katalog aufnehmen.';

export function isSuggestionGame(game: { status?: string | null } | undefined | null): boolean {
  return game?.status === 'suggestion';
}
