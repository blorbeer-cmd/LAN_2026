import { escapeHtml } from './format.js';
import { icon } from './icons.js';

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
