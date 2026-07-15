export const EMPTY_TOURNAMENT_TEAM_ERROR = 'Ein Team kann nicht komplett leer werden.';

export function moveTournamentDraftPlayer(teams, playerId, toIndex) {
  const fromIndex = teams.findIndex((team) => team.players.some((player) => player.id === playerId));
  if (fromIndex === -1 || fromIndex === toIndex || !teams[toIndex]) return { moved: false };

  const fromTeam = teams[fromIndex];
  if (fromTeam.players.length <= 1) {
    return { moved: false, error: EMPTY_TOURNAMENT_TEAM_ERROR };
  }

  const playerIndex = fromTeam.players.findIndex((player) => player.id === playerId);
  const [player] = fromTeam.players.splice(playerIndex, 1);
  const toTeam = teams[toIndex];
  toTeam.players.push(player);

  for (const team of [fromTeam, toTeam]) {
    team.playerIds = team.players.map((teamPlayer) => teamPlayer.id);
    team.totalRating = team.players.reduce((sum, teamPlayer) => sum + (teamPlayer.rating ?? 0), 0);
  }

  return { moved: true, fromIndex, toIndex };
}
