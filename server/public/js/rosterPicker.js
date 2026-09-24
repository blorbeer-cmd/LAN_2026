// Shared player-selection contract used by Matchmaking and Tournament setup.
// Vote keeps its game/genre-specific grid and Packliste keeps its item list:
// neither has this roster semantics, so they deliberately stay separate.

import { avatarHtml, escapeHtml } from './format.js';
import { icon } from './icons.js';
import { matchesSelectionSearch, selectionSearchHtml, wireSelectionSearch } from './selectionSearch.js';
import { normalizeSearchText } from './searchText.js';

export function pruneRosterSelection(selectedIds, players) {
  const available = new Set(players.map((player) => player.id));
  return new Set([...selectedIds].filter((id) => available.has(id)));
}

export function visibleRosterIds(players, query) {
  return players
    .filter((player) => matchesSelectionSearch(player.name, query))
    .map((player) => player.id);
}

export function setVisibleRosterSelection(selectedIds, players, query, checked) {
  for (const id of visibleRosterIds(players, query)) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  }
  return selectedIds;
}

// True when every player matching the query is selected, so the one bulk
// toggle offers "abwählen" instead of "markieren".
export function allVisibleRosterSelected(selectedIds, players, query) {
  const visible = visibleRosterIds(players, query);
  return visible.length > 0 && visible.every((id) => selectedIds.has(id));
}

function bulkToggleContent(allSelected) {
  return allSelected
    ? { iconName: 'listX', label: 'Sichtbare Spieler abwählen', tooltip: 'Sichtbare abwählen' }
    : { iconName: 'listChecks', label: 'Sichtbare Spieler markieren', tooltip: 'Sichtbare markieren' };
}

export function rosterPickerHtml({
  id,
  players,
  selectedIds,
  query = '',
  toolbarLeadingHtml = '',
  toolbarLabel = '',
  searchLabel = 'Spieler suchen',
  gridClass = '',
  renderTrailing = () => '',
  showBulkActions = true,
  showSearch = true,
  emptyText = 'Keine passenden Spieler gefunden.',
  searchId = `${id}-search`,
  itemAttribute = '',
  playerAttribute = '',
  emptyAttribute = '',
  selectAllId = '',
}) {
  const itemCompatibilityAttribute = itemAttribute ? ` ${itemAttribute}` : '';
  const emptyCompatibilityAttribute = emptyAttribute ? ` ${emptyAttribute}` : '';
  const selectAllIdAttribute = selectAllId ? ` id="${escapeHtml(selectAllId)}"` : '';
  const bulk = bulkToggleContent(allVisibleRosterSelected(selectedIds, players, query));
  const rows = players.map((player) => `
    <label class="check-row" data-roster-picker-item${itemCompatibilityAttribute} data-selection-search="${escapeHtml(player.name)}"${matchesSelectionSearch(player.name, query) ? '' : ' hidden'}>
      <input type="checkbox" data-roster-picker-player="${escapeHtml(player.id)}"${playerAttribute ? ` ${playerAttribute}="${escapeHtml(player.id)}"` : ''}${selectedIds.has(player.id) ? ' checked' : ''} />
      ${avatarHtml(player, 20)}
      <span class="player-name" style="flex:1;">${escapeHtml(player.name)}</span>
      ${renderTrailing(player)}
    </label>`).join('');

  return `<div class="stack" data-roster-picker="${escapeHtml(id)}">
    <div class="selection-toolbar">
      ${toolbarLabel ? `<span class="field-label">${escapeHtml(toolbarLabel)}</span>` : ''}
      ${toolbarLeadingHtml}
      ${showBulkActions ? `
        <button type="button" class="icon-btn selection-toolbar-icon"${selectAllIdAttribute} data-roster-select-toggle aria-label="${bulk.label}" data-tooltip="${bulk.tooltip}">${icon(bulk.iconName)}</button>
      ` : ''}
      ${showSearch ? selectionSearchHtml(searchId, query, { label: searchLabel }) : ''}
    </div>
    <div class="player-selection-grid tournament-player-grid${gridClass ? ` ${escapeHtml(gridClass)}` : ''}">${rows}</div>
    <p class="muted" data-roster-picker-empty${emptyCompatibilityAttribute} role="status" style="font-size:var(--font-size-xs);" hidden>${escapeHtml(emptyText)}</p>
  </div>`;
}

export function wireRosterPicker(container, {
  id,
  players,
  selectedIds,
  searchId = `${id}-search`,
  onQueryChange = () => {},
  onSelectionChange = () => {},
}) {
  const picker = container.querySelector(`[data-roster-picker="${id}"]`);
  if (!picker) return;
  const input = picker.querySelector(`#${searchId}`);
  const toggle = picker.querySelector('[data-roster-select-toggle]');
  const currentQuery = () => input?.value ?? '';

  const syncBulkToggle = () => {
    if (!toggle) return;
    const bulk = bulkToggleContent(allVisibleRosterSelected(selectedIds, players, currentQuery()));
    toggle.setAttribute('aria-label', bulk.label);
    toggle.dataset.tooltip = bulk.tooltip;
    toggle.innerHTML = icon(bulk.iconName);
  };

  wireSelectionSearch(picker, {
    inputId: searchId,
    itemSelector: '[data-roster-picker-item]',
    emptySelector: '[data-roster-picker-empty]',
    onQueryChange: (query) => {
      onQueryChange(query);
      syncBulkToggle();
    },
  });

  picker.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-roster-picker-player]');
    if (!checkbox) return;
    const playerId = checkbox.dataset.rosterPickerPlayer;
    if (checkbox.checked) selectedIds.add(playerId);
    else selectedIds.delete(playerId);
    syncBulkToggle();
    onSelectionChange({ kind: 'single', playerId, checked: checkbox.checked });
  });

  picker.addEventListener('click', (event) => {
    if (!event.target.closest('[data-roster-select-toggle]')) return;
    const query = currentQuery();
    const checked = !allVisibleRosterSelected(selectedIds, players, query);
    setVisibleRosterSelection(selectedIds, players, query, checked);
    picker.querySelectorAll('[data-roster-picker-player]').forEach((checkbox) => {
      if (!matchesSelectionSearch(
        players.find((player) => player.id === checkbox.dataset.rosterPickerPlayer)?.name ?? '',
        query,
      )) return;
      checkbox.checked = checked;
    });
    syncBulkToggle();
    onSelectionChange({ kind: 'bulk', checked });
  });
}

// Filters a picker rendered with `showSearch: false` from a search field that
// lives elsewhere, e.g. the Captain Draft roster search also narrowing the
// captain list below it.
export function filterRosterPicker(container, id, query) {
  const picker = container.querySelector(`[data-roster-picker="${id}"]`);
  if (!picker) return;
  const normalizedQuery = normalizeSearchText(query);
  let visibleCount = 0;
  picker.querySelectorAll('[data-roster-picker-item]').forEach((item) => {
    const visible = !normalizedQuery || normalizeSearchText(item.dataset.selectionSearch).includes(normalizedQuery);
    item.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = picker.querySelector('[data-roster-picker-empty]');
  if (empty) empty.hidden = !normalizedQuery || visibleCount > 0;
}
