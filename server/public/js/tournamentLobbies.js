function isOpenAndReady(match) {
  return Boolean(
    !match.isBye &&
      match.teamAId &&
      match.teamBId &&
      match.winnerTeamId === null &&
      !match.isDraw
  );
}

// Returns only pairings that may run now. Brackets naturally expose every
// match whose two feeder teams are known. Liga/group schedules are gated to
// their earliest unfinished round so later fixtures do not appear as active
// lobbies before the current round has finished.
export function selectActiveLobbyMatches(tournament) {
  if (
    tournament.status !== 'active' ||
    (!tournament.lobbyName && !tournament.lobbyPassword)
  ) return [];

  const ready = tournament.matches.filter(isOpenAndReady);
  if (tournament.format === 'single_elimination') return ready;

  if (tournament.format === 'group_knockout') {
    const knockout = ready.filter((match) => match.stage === 'knockout');
    if (knockout.length > 0) return knockout;
    const groupMatches = ready.filter((match) => match.stage === 'group');
    if (groupMatches.length === 0) return [];
    const currentRound = Math.min(...groupMatches.map((match) => match.round));
    return groupMatches.filter((match) => match.round === currentRound);
  }

  if (ready.length === 0) return [];
  const currentRound = Math.min(...ready.map((match) => match.round));
  return ready.filter((match) => match.round === currentRound);
}
