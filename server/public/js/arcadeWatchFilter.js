// Battleship and Challenge Rush keep a finished match watchable for a short
// reveal window so late spectators can still see the final board/scores —
// but the player who was actually in that match already knows it's over, so
// it must not show up as if it were still running on their own Arcade
// overview. Pure and DOM-free so it can be unit tested directly.
export function isOwnFinishedMatch(live, myId) {
  if (live?.phase !== 'ended' || !myId) return false;
  const ids = [
    ...(live.players ?? []).map((player) => player.id ?? player.ref?.id),
    ...(live.scores ?? []).map((score) => score.playerId),
  ];
  return ids.includes(myId);
}
