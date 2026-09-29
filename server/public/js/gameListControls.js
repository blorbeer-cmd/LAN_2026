// Search, sorting and filters of a game list: the Spielekatalog toolbar,
// shared by the catalog itself and the game list of a new Vote so both offer
// the same sort choices, genre and open-rating filters. Each caller keeps its
// own filter state object (see createGameListFilters) and re-renders its list
// through onChange.

import { state } from './state.js';
import { icon } from './icons.js';
import { escapeHtml } from './format.js';
import { GAME_GENRES } from './gameGenres.js';

export function createGameListFilters() {
  return {
    sortKey: 'name',
    sortDir: 'asc',
    sortMenuOpen: false,
    // Genre chips use OR semantics: a game matches if it has at least one of
    // the selected genres. Empty means "no filter, show all".
    genreFilter: new Set(),
    // Independent facets ('bock', 'skill'): AND semantics across the two - if
    // both are active, only games missing *both* of the current identity's
    // own ratings stay visible, since each is its own separate condition.
    ratingFilter: new Set(),
    filterMenuOpen: false,
  };
}

export function ratingStats(rows, gameId) {
  const matching = rows.filter((r) => r.game_id === gameId);
  if (matching.length === 0) return { avg: null, count: 0 };
  const avg = matching.reduce((sum, r) => sum + r.rating, 0) / matching.length;
  return { avg, count: matching.length };
}

export function myRating(rows, playerId, gameId) {
  const entry = rows.find((r) => r.player_id === playerId && r.game_id === gameId);
  return entry ? entry.rating : null;
}

function sortValue(game, key, myId) {
  if (key === 'avgBock') return ratingStats(state.preferences, game.id).avg ?? -1;
  if (key === 'avgSkill') return ratingStats(state.skills, game.id).avg ?? -1;
  if (key === 'myBock') return myRating(state.preferences, myId, game.id) ?? -1;
  return game.name;
}

export function sortGames(games, filters, myId) {
  return [...games].sort((a, b) => {
    const av = sortValue(a, filters.sortKey, myId);
    const bv = sortValue(b, filters.sortKey, myId);
    const diff = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'de');
    return filters.sortDir === 'asc' ? diff : -diff;
  });
}

export function filterGames(games, filters, myId) {
  return games
    .filter((g) => filters.genreFilter.size === 0 || (g.genres ?? []).some((genre) => filters.genreFilter.has(genre)))
    .filter((g) => {
      if (!myId || filters.ratingFilter.size === 0) return true;
      if (filters.ratingFilter.has('bock') && myRating(state.preferences, myId, g.id) !== null) return false;
      if (filters.ratingFilter.has('skill') && myRating(state.skills, myId, g.id) !== null) return false;
      return true;
    });
}

export function activeFilterCount(filters) {
  return filters.genreFilter.size + filters.ratingFilter.size;
}

// Each option includes its direction. The toolbar therefore needs only one
// stable control instead of a row of buttons whose second click reverses
// the current direction.
const SORT_OPTIONS = [
  { key: 'name', asc: 'Name · A–Z', desc: 'Name · Z–A' },
  { key: 'myBock', asc: 'Mein Bock · ↑', desc: 'Mein Bock · ↓' },
  { key: 'avgBock', asc: 'Ø Bock · ↑', desc: 'Ø Bock · ↓' },
  { key: 'avgSkill', asc: 'Ø Skill · ↑', desc: 'Ø Skill · ↓' },
];

function sortChoices() {
  return SORT_OPTIONS.flatMap(({ key, asc, desc }) => [
    { value: `${key}:asc`, label: asc },
    { value: `${key}:desc`, label: desc },
  ]);
}

function selectedSortLabel(filters) {
  return sortChoices().find(({ value }) => value === `${filters.sortKey}:${filters.sortDir}`)?.label ?? 'Name · A–Z';
}

function sortOptionsHtml(filters) {
  return sortChoices()
    .map(({ value, label }) => {
      const active = value === `${filters.sortKey}:${filters.sortDir}`;
      if (active) {
        return `<button type="button" class="btn btn-sm game-catalog-sort-option is-active" data-sort-value="${value}" aria-pressed="true">${label}</button>`;
      }
      return `<button type="button" class="btn btn-sm game-catalog-sort-option" data-sort-value="${value}" aria-pressed="false">${label}</button>`;
    })
    .join('');
}

// games: the list the genre choices are derived from. `extraHtml` sits
// between search and sorting (the Vote list's bulk toggle); `className`
// adds a layout modifier.
export function gameListToolbarHtml(filters, { games, myId, searchId, searchLabel = 'Spiele suchen', query = '', extraHtml = '', className = '' }) {
  const { genreFilter, ratingFilter } = filters;
  const usedGenres = GAME_GENRES.filter((g) => games.some((game) => (game.genres ?? []).includes(g)));
  const filterCount = activeFilterCount(filters);
  return `<section class="game-catalog-toolbar${className ? ` ${className}` : ''}" aria-label="Spiele durchsuchen, sortieren und filtern">
          <input type="search" id="${searchId}" value="${escapeHtml(query)}" placeholder="Spiel suchen" aria-label="${escapeHtml(searchLabel)}" autocomplete="off" />
          ${extraHtml}
          <details class="action-menu game-catalog-sort-menu" ${filters.sortMenuOpen ? 'open' : ''}>
            <summary class="btn btn-sm game-catalog-sort-trigger" aria-label="Spiele sortieren">
              ${selectedSortLabel(filters)} ${icon('chevronDown')}
            </summary>
            <div class="action-menu-panel game-catalog-sort-panel" role="group" aria-label="Spiele sortieren">
              ${sortOptionsHtml(filters)}
            </div>
          </details>
          <details class="action-menu game-catalog-filter-menu" ${filters.filterMenuOpen ? 'open' : ''}>
            <summary class="btn btn-sm game-catalog-filter-trigger" aria-label="Filter öffnen${filterCount > 0 ? `, ${filterCount} aktiv` : ''}">
              Filter${filterCount > 0 ? ` (${filterCount})` : ''} ${icon('chevronDown')}
            </summary>
            <div class="action-menu-panel game-catalog-filter-panel">
              ${
                myId
                  ? `<div class="stack game-catalog-filter-section" role="group" aria-label="Nach fehlender eigener Bewertung filtern">
                       <span class="game-catalog-filter-heading">Offene Bewertungen</span>
                       <div class="chip-list">
                         <button type="button" class="chip${ratingFilter.has('bock') ? ' is-active' : ''}" data-rating-filter="bock" aria-pressed="${ratingFilter.has('bock')}">Bock offen</button>
                         <button type="button" class="chip${ratingFilter.has('skill') ? ' is-active' : ''}" data-rating-filter="skill" aria-pressed="${ratingFilter.has('skill')}">Skill offen</button>
                       </div>
                     </div>`
                  : ''
              }
              ${
                usedGenres.length
                  ? `<div class="stack game-catalog-filter-section" role="group" aria-label="Nach Genre filtern">
                       <span class="game-catalog-filter-heading">Genres</span>
                       <div class="chip-list">
                         ${usedGenres
                           .map(
                             (g) =>
                               `<button type="button" class="chip${genreFilter.has(g) ? ' is-active' : ''}" data-genre-filter="${escapeHtml(g)}" aria-pressed="${genreFilter.has(g)}">${escapeHtml(g)}</button>`,
                           )
                           .join('')}
                       </div>
                     </div>`
                  : ''
              }
              ${
                filterCount > 0
                  ? '<button type="button" class="btn btn-sm game-catalog-filter-reset" data-clear-game-filters>Filter zurücksetzen</button>'
                  : ''
              }
            </div>
          </details>
        </section>`;
}

// Mutates `filters` on every choice and calls onChange({ focusSelector }) so
// the caller can re-render its list and give focus back to the pressed
// control. The caller wires the two menus with wireActionMenus().
export function wireGameListToolbar(root, filters, { onChange }) {
  const sortMenu = root.querySelector('.game-catalog-sort-menu');
  sortMenu?.addEventListener('toggle', () => {
    filters.sortMenuOpen = sortMenu.open;
  });
  const filterMenu = root.querySelector('.game-catalog-filter-menu');
  filterMenu?.addEventListener('toggle', () => {
    filters.filterMenuOpen = filterMenu.open;
  });

  root.querySelectorAll('[data-genre-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.genreFilter;
      if (filters.genreFilter.has(g)) filters.genreFilter.delete(g);
      else filters.genreFilter.add(g);
      onChange({ focusSelector: `[data-genre-filter="${CSS.escape(g)}"]` });
    });
  });

  root.querySelectorAll('[data-rating-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.ratingFilter;
      if (filters.ratingFilter.has(k)) filters.ratingFilter.delete(k);
      else filters.ratingFilter.add(k);
      onChange({ focusSelector: `[data-rating-filter="${k}"]` });
    });
  });

  root.querySelectorAll('[data-sort-value]').forEach((button) => {
    button.addEventListener('click', () => {
      [filters.sortKey, filters.sortDir] = button.dataset.sortValue.split(':');
      filters.sortMenuOpen = false;
      onChange({ focusSelector: '.game-catalog-sort-trigger' });
    });
  });

  root.querySelector('[data-clear-game-filters]')?.addEventListener('click', () => {
    filters.genreFilter.clear();
    filters.ratingFilter.clear();
    filters.filterMenuOpen = false;
    onChange({ focusSelector: '.game-catalog-filter-trigger' });
  });
}
