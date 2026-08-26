// Shared player-selection contract used by Matchmaking and Tournament setup.
// Vote keeps its game/genre-specific grid and Packliste keeps its item list:
// neither has this roster semantics, so they deliberately stay separate.

import { avatarHtml, escapeHtml } from './format.js';
import { icon } from './icons.js';
import { matchesSelectionSearch, selectionSearchHtml, wireSelectionSearch } from './selectionSearch.js';

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
  emptyText = 'Keine passenden Spieler gefunden.',
  searchId = `${id}-search`,
  itemAttribute = '',
  playerAttribute = '',
  emptyAttribute = '',
  selectAllId = '',
  selectNoneId = '',
}) {
  const itemCompatibilityAttribute = itemAttribute ? ` ${itemAttribute}` : '';
  const emptyCompatibilityAttribute = emptyAttribute ? ` ${emptyAttribute}` : '';
  const selectAllIdAttribute = selectAllId ? ` id="${escapeHtml(selectAllId)}"` : '';
  const selectNoneIdAttribute = selectNoneId ? ` id="${escapeHtml(selectNoneId)}"` : '';
  const rows = players.map((player) => `
    <label class="check-row" data-roster-picker-item${itemCompatibilityAttribute} data-selection-search="${escapeHtml(player.name)}">
      <input type="checkbox" data-roster-picker-player="${escapeHtml(player.id)}"${playerAttribute ? ` ${playerAttribute}="${escapeHtml(player.id)}"` : ''}${selectedIds.has(player.id) ? ' checked' : ''} />
      ${avatarHtml(player, 20)}
      <span class="player-name" style="flex:1;">${escapeHtml(player.name)}</span>
      ${renderTrailing(player)}
    </label>`).join('');

  return `<div data-roster-picker="${escapeHtml(id)}">
    <div class="selection-toolbar">
      ${toolbarLabel ? `<span class="field-label">${escapeHtml(toolbarLabel)}</span>` : ''}
      ${toolbarLeadingHtml}
      ${showBulkActions ? `
        <button type="button" class="icon-btn selection-toolbar-icon"${selectAllIdAttribute} data-roster-select-all aria-label="Sichtbare Spieler markieren" data-tooltip="Sichtbare markieren">${icon('listChecks')}</button>
        <button type="button" class="icon-btn selection-toolbar-icon selection-toolbar-icon--clear"${selectNoneIdAttribute} data-roster-select-none aria-label="Sichtbare Spieler abwählen" data-tooltip="Sichtbare abwählen">${icon('listX')}</button>
      ` : ''}
      ${selectionSearchHtml(searchId, query, { label: searchLabel })}
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

  wireSelectionSearch(picker, {
    inputId: searchId,
    itemSelector: '[data-roster-picker-item]',
    emptySelector: '[data-roster-picker-empty]',
    onQueryChange,
  });

  picker.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-roster-picker-player]');
    if (!checkbox) return;
    const playerId = checkbox.dataset.rosterPickerPlayer;
    if (checkbox.checked) selectedIds.add(playerId);
    else selectedIds.delete(playerId);
    onSelectionChange({ kind: 'single', playerId, checked: checkbox.checked });
  });

  picker.addEventListener('click', (event) => {
    const bulkButton = event.target.closest('[data-roster-select-all], [data-roster-select-none]');
    if (!bulkButton) return;
    const checked = bulkButton.hasAttribute('data-roster-select-all');
    setVisibleRosterSelection(selectedIds, players, input?.value ?? '', checked);
    picker.querySelectorAll('[data-roster-picker-player]').forEach((checkbox) => {
      if (!matchesSelectionSearch(
        players.find((player) => player.id === checkbox.dataset.rosterPickerPlayer)?.name ?? '',
        input?.value ?? '',
      )) return;
      checkbox.checked = checked;
    });
    onSelectionChange({ kind: 'bulk', checked });
  });
}
