// RankedList: flat hairline rows with a value in a fixed right column, read
// top to bottom in two columns from --bp-md (contract:
// frontend-contracts/components/ranked-list.md). A ranking passes its rows in
// rank order with `ranked: true` and gets place numbers; any other list is
// sorted here alphabetically, numbers in natural order (2 before 10).

import { escapeHtml } from './format.js';

// Index of the first row in the right column: the left column holds the
// larger half, so an odd count leaves the right column one row shorter.
export function rankedListColumnBreak(count) {
  return Math.ceil(count / 2);
}

// Items carry pre-escaped HTML in `title`, `meta` and `value`; `lead` is an
// optional leading element such as an avatar. `rank` overrides the place
// number for shared places (ties); it defaults to the position.
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

// `sortKey` is the plain text a list without rank is ordered by; it defaults
// to the title with any markup stripped.
export function sortUnrankedItems(items) {
  const keyOf = (item) => item.sortKey ?? String(item.title).replace(/<[^>]*>/g, '');
  return [...items].sort((a, b) => collator.compare(keyOf(a), keyOf(b)));
}

export function rankedListHtml(entries, { ranked = false, label = '' } = {}) {
  const items = ranked ? entries : sortUnrankedItems(entries);
  const columnBreak = rankedListColumnBreak(items.length);
  const rows = items.map((item, index) => {
    const top = index === 0 || index === columnBreak;
    return `
      <div class="ranked-list-row${ranked ? ' is-ranked' : ''}${item.lead ? ' has-lead' : ''}${top ? ' is-column-top' : ''}" role="listitem">
        ${ranked ? `<span class="ranked-list-rank">${item.rank ?? index + 1}</span>` : ''}
        ${item.lead ? `<span class="ranked-list-lead">${item.lead}</span>` : ''}
        <span class="ranked-list-text">
          <span class="ranked-list-title">${item.title}</span>
          ${item.meta ? `<span class="ranked-list-meta">${item.meta}</span>` : ''}
        </span>
        <span class="ranked-list-value">${item.value}</span>
      </div>`;
  });
  return `<div class="ranked-list" role="list"${label ? ` aria-label="${escapeHtml(label)}"` : ''} style="--ranked-list-rows:${columnBreak}">${rows.join('')}</div>`;
}
