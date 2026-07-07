// Shared "who am I" identity: the tool has no per-person login (just the
// shared access token), so each phone remembers locally which player it
// belongs to. Used by both the voting and live-status views.

const MY_ID_KEY = 'lan2026_my_player_id';

export function getMyId() {
  return localStorage.getItem(MY_ID_KEY) || '';
}

export function setMyId(id) {
  localStorage.setItem(MY_ID_KEY, id);
}
