import { escapeHtml } from './format.js';
import { icon } from './icons.js';

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

// Touch fallback for moving a drawn player between teams: native drag and
// drop does not fire on phones, so CSS shows this native team picker only on
// touch/phone layouts and desktop keeps pure drag and drop.
export function teamMoveControlHtml({ teamNames, currentIndex, playerName, attributes }) {
  const options = teamNames
    .map((name, index) => `<option value="${index}"${index === currentIndex ? ' selected' : ''}>${escapeHtml(name)}</option>`)
    .join('');
  return `<label class="team-move-control" title="Team wechseln">
    ${icon('shuffle')}
    <select ${attributes} aria-label="Team für ${escapeHtml(playerName)} wechseln">${options}</select>
  </label>`;
}
