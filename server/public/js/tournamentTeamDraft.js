import { escapeHtml } from './format.js';
import { icon } from './icons.js';

export const REMOVE_FROM_TEAMS_VALUE = 'remove';

// Touch fallback for moving a drawn player between teams: native drag and
// drop does not fire on phones, so CSS shows this native team picker only on
// touch/phone layouts and desktop keeps pure drag and drop. `removable` adds
// the touch equivalent of dragging the player out of the lineup.
export function teamMoveControlHtml({ teamNames, currentIndex, playerName, attributes, removable = false }) {
  const options = teamNames
    .map((name, index) => `<option value="${index}"${index === currentIndex ? ' selected' : ''}>${escapeHtml(name)}</option>`)
    .join('');
  const removeOption = removable ? `<option value="${REMOVE_FROM_TEAMS_VALUE}">Aus dem Match entfernen</option>` : '';
  const movable = teamNames.length > 1;
  const title = movable ? `Team wechseln${removable ? ' oder entfernen' : ''}` : 'Aus dem Match entfernen';
  const label = movable
    ? `Team für ${escapeHtml(playerName)} wechseln${removable ? ' oder entfernen' : ''}`
    : `${escapeHtml(playerName)} aus dem Match entfernen`;
  return `<label class="team-move-control" title="${title}">
    ${icon('shuffle')}
    <select ${attributes} aria-label="${label}">${options}${removeOption}</select>
  </label>`;
}
