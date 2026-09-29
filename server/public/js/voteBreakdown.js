// Shared result pieces of Umfragen and Vote: the "Win" chip, the voter avatar
// stack beside an option, the result bar with its counts and the "Stimmen"
// dialog body (numbered legend plus one person x option table). Both views
// feed their own data shape into the same markup so a poll and a vote round
// with the same answer kind read the same way.

import { avatarHtml, escapeHtml } from './format.js';
import { icon } from './icons.js';
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

const percent = (value, total) => `${Math.round((Math.max(0, value) / Math.max(1, total)) * 1000) / 10}%`;

// Interim or final result as one bar in the middle of an option row, with its
// counts below. `fillHtml` comes from one of the fill helpers below.
export function resultBarHtml(fillHtml, countsHtml) {
  return `
    <span class="event-poll-result">
      <span class="event-poll-bar" aria-hidden="true">${fillHtml}</span>
      <span class="event-poll-counts">${countsHtml}</span>
    </span>`;
}

// A single-colour share (choices, points, ratings); `share` is 0..1.
export function choiceBarFillHtml(share) {
  return share > 0 ? `<span class="event-poll-bar-fill is-choice" style="width:${percent(share, 1)};"></span>` : '';
}

// Passt/Notfalls/Nein as a soft gradient in the brand colors: the colors meet
// at the middle of their segments, so each answer keeps its hue while
// neighbours blend instead of hard edges. The bar's length is the share of
// `total` people who answered at all.
export function feasibilityBarFillHtml({ can, ifNeeded, cannot }, total) {
  const parts = [
    ['var(--accent)', can],
    ['var(--accent-2)', ifNeeded],
    ['var(--accent-3)', cannot],
  ].filter(([, count]) => count > 0);
  const answered = parts.reduce((sum, [, count]) => sum + count, 0);
  if (!answered) return '';
  let offset = 0;
  const stops = parts.map(([color, count]) => {
    const middle = offset + count / 2;
    offset += count;
    return `${color} ${percent(middle, answered)}`;
  });
  const background = stops.length === 1 ? parts[0][0] : `linear-gradient(90deg, ${stops.join(', ')})`;
  return `<span class="event-poll-bar-fill" style="width:${percent(answered, total)};background:${background};"></span>`;
}

// The counts below a feasibility bar; `open` is left out when null.
export function feasibilityLegendHtml({ can, ifNeeded, cannot, open = null }) {
  const item = (key, count, label) => `<span class="event-poll-legend-item"><span class="event-poll-legend-dot is-${key}" aria-hidden="true"></span><span class="event-poll-count-text">${count} ${label}</span></span>`;
  return [
    item('can', can, 'Passt'),
    item('if-needed', ifNeeded, 'Notfalls'),
    item('cannot', cannot, 'Nein'),
    open === null ? '' : item('open', open, 'offen'),
  ].join('');
}

// One Passt/Notfalls/Nein answer in the "Stimmen" table and its key.
const FEASIBILITY_CELL_SYMBOLS = {
  can: { icon: 'check', state: 'can', label: 'Passt' },
  if_needed: { icon: 'minus', state: 'if-needed', label: 'Notfalls' },
  cannot: { icon: 'x', state: 'cannot', label: 'Nein' },
};

export function feasibilityCellHtml(value) {
  const symbol = FEASIBILITY_CELL_SYMBOLS[value];
  if (!symbol) return '<span class="event-poll-vote-cell is-empty" aria-label="Offen">–</span>';
  return `<span class="event-poll-vote-cell is-${symbol.state}" role="img" aria-label="${symbol.label}" title="${symbol.label}">${icon(symbol.icon)}</span>`;
}

export function feasibilityKeyHtml() {
  return `<div class="muted event-poll-vote-key">
      ${Object.values(FEASIBILITY_CELL_SYMBOLS).map((symbol) => `<span><span class="event-poll-vote-cell is-${symbol.state}" aria-hidden="true">${icon(symbol.icon)}</span>${symbol.label}</span>`).join('')}
    </div>`;
}

// A picked option in a choice round.
export const CHOSEN_CELL = `<span class="event-poll-vote-cell is-can" role="img" aria-label="Gewählt" title="Gewählt">${icon('check')}</span>`;
