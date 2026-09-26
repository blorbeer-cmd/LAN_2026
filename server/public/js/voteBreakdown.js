// Shared result pieces of Umfragen and Vote: the "Win" chip, the voter avatar
// stack beside an option and the "Stimmen" dialog body (numbered legend plus
// one person x option table). Both views feed their own data shape into the
// same markup so an ended poll and a closed vote round read the same way.

import { avatarHtml, escapeHtml } from './format.js';
import { state } from './state.js';

export const WIN_CHIP = '<span class="tournament-fixture-score is-pick vote-win-chip">Win</span>';

// How many voter avatars an option row shows before the rest becomes a count.
export const VOTER_STACK_LIMIT = 4;

function avatarSource(person) {
  return state.players?.find((entry) => entry.id === person.playerId) ?? person;
}

// "Anna, Ben und 2 weitere" for the stack's accessible name.
export function voterNamesText(people) {
  const names = people.slice(0, VOTER_STACK_LIMIT).map((person) => person.name);
  const rest = people.length - names.length;
  return `${names.join(', ')}${rest > 0 ? ` und ${rest} weitere` : ''}`;
}

// `attributes` is trusted, already escaped markup that wires the button to
// its dialog (for example a data attribute carrying the poll or round id).
export function voterStackHtml({ people, label, attributes }) {
  if (!people.length) return '';
  const shown = people.slice(0, VOTER_STACK_LIMIT);
  const rest = people.length - shown.length;
  return `
    <button type="button" class="btn btn-sm event-poll-voter-stack" ${attributes}
      aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <span class="event-poll-voter-stack-avatars" aria-hidden="true">${shown
        .map((person) => avatarHtml(avatarSource(person), 24))
        .join('')}</span>
      ${rest > 0 ? `<span class="event-poll-voter-stack-more" aria-hidden="true">+${rest}</span>` : ''}
    </button>`;
}

// columns: [{ label, win, summary }] in display order; people: [{ playerId,
// name }] already sorted; cellHtml(person, columnIndex) returns one cell.
// The legend names each number, so the column heads stay equally narrow no
// matter how long an option label is.
export function voteBreakdownHtml({ columns, people, cellHtml, keyHtml = '' }) {
  const number = (index, win) => `<span class="event-poll-vote-number${win ? ' is-win' : ''}">${index + 1}</span>`;
  const legend = `
    <ol class="event-poll-vote-legend">
      ${columns.map((column, index) => `<li class="event-poll-vote-legend-row">
          ${number(index, column.win)}
          <span class="event-poll-vote-legend-label">${escapeHtml(column.label)}</span>
          ${column.win ? WIN_CHIP : ''}
          <span class="muted event-poll-vote-legend-summary">${escapeHtml(column.summary)}</span>
        </li>`).join('')}
    </ol>
    ${keyHtml}`;
  const table = people.length
    ? `<div class="event-poll-vote-table-wrap">
         <table class="event-poll-vote-table" style="--vote-columns:${columns.length};">
           <colgroup><col />${columns.map(() => '<col class="event-poll-vote-col" />').join('')}</colgroup>
           <thead><tr><th scope="col"><span class="visually-hidden">Person</span></th>${columns
             .map((column, index) => `<th scope="col" aria-label="${escapeHtml(column.label)}">${number(index, column.win)}</th>`)
             .join('')}</tr></thead>
           <tbody>${people
             .map((person) => `<tr>
                 <th scope="row"><span class="player-name">${avatarHtml(avatarSource(person), 20)}<span class="event-poll-voter-name">${escapeHtml(person.name)}</span></span></th>
                 ${columns.map((_, index) => `<td>${cellHtml(person, index)}</td>`).join('')}
               </tr>`)
             .join('')}</tbody>
         </table>
       </div>`
    : '';
  return `<div class="stack event-poll-vote-details">${legend}${table}</div>`;
}
