// Shared searchable combobox used wherever a game or an event must be
// selected. The visible listbox is rendered by Respawn instead of the
// browser's native <datalist> popup, so it follows the dark design system
// consistently while preserving the hidden input contract used by the
// existing views.
//
// An option may carry a leading status icon (`icon`, plus the German
// `iconLabel` naming the state and an `iconState` key that colours it). It is
// rendered in the collapsed control *and* on every row of the open list, so a
// reader sees the state while choosing rather than only after choosing — the
// native <select> this replaces could not show an icon inside its options at
// all. The state is never colour alone: `iconLabel` becomes the row's own
// accessible name and the control's description.

import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Icon markup shared by the collapsed control and the list rows, so both
// always describe a state the same way.
function statusIconHtml(option, className) {
  if (!option?.icon) return '';
  const state = option.iconState ? ` data-event-status="${escapeHtml(option.iconState)}"` : '';
  return `<span class="${className}"${state} role="img" aria-label="${escapeHtml(option.iconLabel ?? '')}" title="${escapeHtml(option.iconLabel ?? '')}">${icon(option.icon)}</span>`;
}

function optionHtml(id, option, index, selectedValue) {
  const selected = option.value === (selectedValue ?? '');
  return `<button type="button" id="${id}-option-${index}" class="search-select-option" role="option" aria-selected="${selected}" tabindex="-1" data-search-select-index="${index}" data-search-select-value="${escapeHtml(option.value)}">${statusIconHtml(option, 'search-select-option-icon')}<span class="search-select-option-label">${escapeHtml(option.label)}</span></button>`;
}

// options: Array<{ value, label, icon?, iconLabel?, iconState? }>
// `ariaLabel` names the control itself where no visible <label for="{id}-search">
// precedes it; `label` names the listbox.
export function searchSelectHtml(
  id,
  options,
  selectedValue,
  { placeholder = 'Suchen…', label = 'Verfügbare Optionen', ariaLabel = '' } = {},
) {
  const selected = options.find((option) => option.value === (selectedValue ?? ''));
  const initialLabel = selected ? selected.label : '';
  const renderedOptions = options.map((option, index) => optionHtml(id, option, index, selectedValue)).join('');
  // Only reserve the leading inset when this instance actually uses icons, so
  // the game pickers keep their existing text alignment untouched.
  const withIcons = options.some((option) => option.icon);

  return `
    <div class="search-select${withIcons ? ' has-status-icon' : ''}" data-search-select>
      <input type="hidden" id="${id}" value="${escapeHtml(selectedValue ?? '')}" />
      <div class="search-select-control">
        ${withIcons ? `<span class="search-select-value-icon" data-search-select-value-icon>${statusIconHtml(selected, 'search-select-status')}</span>` : ''}
        <input type="text" id="${id}-search" value="${escapeHtml(initialLabel)}" placeholder="${escapeHtml(placeholder)}"${ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : ''} autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" />
        <button type="button" class="search-select-toggle" aria-label="Auswahl öffnen" aria-controls="${id}-list" aria-expanded="false" tabindex="-1">${icon('chevronDown')}</button>
      </div>
      <div id="${id}-list" class="search-select-list" role="listbox" aria-label="${escapeHtml(label)}" hidden>${renderedOptions}</div>
    </div>
  `;
}

export function wireSearchSelect(container, id, options, { onChange, emptyText = 'Kein passendes Spiel gefunden.' } = {}) {
  const hidden = container.querySelector(`#${id}`);
  const search = container.querySelector(`#${id}-search`);
  const wrapper = search?.closest('[data-search-select]');
  const list = container.querySelector(`#${id}-list`);
  const toggle = wrapper?.querySelector('.search-select-toggle');
  const valueIcon = wrapper?.querySelector('[data-search-select-value-icon]');
  if (!hidden || !search || !wrapper || !list || !toggle) return;

  let filteredOptions = options.map((option, originalIndex) => ({ ...option, originalIndex }));
  let activeIndex = -1;
  let suppressNextFocusOpen = false;

  const optionForValue = () => options.find((option) => option.value === hidden.value);
  const labelForValue = () => optionForValue()?.label ?? '';
  const isOpen = () => !list.hidden;

  // A modal is its own scroll container and therefore clips absolutely
  // positioned descendants at its edges. Keep the listbox inside that
  // visible boundary, flipping it above the field when the modal has more
  // room there; the list's existing local scrollbar handles longer results.
  const updateListPlacement = () => {
    wrapper.classList.remove('opens-upward');
    list.style.removeProperty('--search-select-available-height');
    const modal = wrapper.closest('.modal');
    if (!modal || list.hidden) return;

    const modalRect = modal.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const boundaryTop = modalRect.top + modal.clientTop;
    const boundaryBottom = boundaryTop + modal.clientHeight;
    const listGap = Math.max(0, listRect.top - wrapperRect.bottom);
    const availableBelow = Math.max(0, boundaryBottom - listRect.top);
    const availableAbove = Math.max(0, wrapperRect.top - boundaryTop - listGap);
    const opensUpward = listRect.height > availableBelow && availableAbove > availableBelow;
    const availableHeight = opensUpward ? availableAbove : availableBelow;

    wrapper.classList.toggle('opens-upward', opensUpward);
    list.style.setProperty('--search-select-available-height', `${Math.floor(availableHeight)}px`);
  };

  // Keep the collapsed control's status icon in step with the selection, so
  // the state stays readable once the list is closed again.
  const updateValueIcon = () => {
    if (!valueIcon) return;
    valueIcon.innerHTML = statusIconHtml(optionForValue(), 'search-select-status');
  };

  const updateExpandedState = (expanded) => {
    wrapper.classList.toggle('is-open', expanded);
    search.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Auswahl schließen' : 'Auswahl öffnen');
  };

  const updateActiveOption = () => {
    const optionElements = [...list.querySelectorAll('[data-search-select-index]')];
    optionElements.forEach((element, index) => {
      const active = index === activeIndex;
      element.classList.toggle('is-active', active);
    });
    const active = optionElements[activeIndex];
    if (active) search.setAttribute('aria-activedescendant', active.id);
    else search.removeAttribute('aria-activedescendant');
    active?.scrollIntoView({ block: 'nearest' });
  };

  const renderOptions = (query = '') => {
    const normalizedQuery = query.trim().toLocaleLowerCase('de-DE');
    filteredOptions = options
      .map((option, originalIndex) => ({ ...option, originalIndex }))
      .filter((option) => option.label.toLocaleLowerCase('de-DE').includes(normalizedQuery));

    if (filteredOptions.length === 0) {
      list.innerHTML = `<div class="search-select-empty">${escapeHtml(emptyText)}</div>`;
      activeIndex = -1;
      search.removeAttribute('aria-activedescendant');
      updateListPlacement();
      return;
    }

    list.innerHTML = filteredOptions
      .map((option) => optionHtml(id, option, option.originalIndex, hidden.value))
      .join('');
    const selectedIndex = filteredOptions.findIndex((option) => option.value === hidden.value);
    activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    updateListPlacement();
    updateActiveOption();
  };

  const open = ({ clear = false } = {}) => {
    if (clear) search.value = '';
    list.hidden = false;
    updateExpandedState(true);
    renderOptions(search.value);
  };

  const close = ({ restore = true } = {}) => {
    if (restore) search.value = labelForValue();
    list.hidden = true;
    updateExpandedState(false);
    wrapper.classList.remove('opens-upward');
    list.style.removeProperty('--search-select-available-height');
    search.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const focusSearchWithoutOpening = () => {
    if (document.activeElement === search) return;
    suppressNextFocusOpen = true;
    search.focus({ preventScroll: true });
  };

  const selectOption = (option) => {
    if (!option) return;
    const changed = hidden.value !== option.value;
    hidden.value = option.value;
    search.value = option.label;
    updateValueIcon();
    close({ restore: false });
    focusSearchWithoutOpening();
    if (!changed) return;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    onChange?.(option.value);
  };

  const resolveExactMatch = () => {
    const typed = search.value.trim().toLocaleLowerCase('de-DE');
    const option = options.find((entry) => entry.label.toLocaleLowerCase('de-DE') === typed);
    if (option) selectOption(option);
  };

  search.addEventListener('focus', () => {
    if (suppressNextFocusOpen) {
      suppressNextFocusOpen = false;
      return;
    }
    if (!isOpen()) open({ clear: true });
  });
  search.addEventListener('click', () => {
    if (!isOpen()) open({ clear: true });
  });
  search.addEventListener('input', () => {
    if (!isOpen()) open();
    else renderOptions(search.value);
    resolveExactMatch();
  });
  search.addEventListener('change', resolveExactMatch);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen()) open({ clear: true });
      if (filteredOptions.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + direction + filteredOptions.length) % filteredOptions.length;
      updateActiveOption();
    } else if (event.key === 'Enter' && isOpen()) {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab' && isOpen()) {
      close();
    }
  });

  toggle.addEventListener('click', () => {
    if (isOpen()) {
      close();
      focusSearchWithoutOpening();
      return;
    }
    open({ clear: true });
    focusSearchWithoutOpening();
  });

  list.addEventListener('pointermove', (event) => {
    const optionElement = event.target.closest('[data-search-select-index]');
    if (!optionElement) return;
    const index = filteredOptions.findIndex((option) => option.originalIndex === Number(optionElement.dataset.searchSelectIndex));
    if (index < 0 || index === activeIndex) return;
    activeIndex = index;
    updateActiveOption();
  });
  list.addEventListener('click', (event) => {
    const optionElement = event.target.closest('[data-search-select-index]');
    if (!optionElement) return;
    const option = options[Number(optionElement.dataset.searchSelectIndex)];
    selectOption(option);
  });

  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) close();
  });

  const closeFromOutsidePointer = (event) => {
    if (!wrapper.isConnected) {
      document.removeEventListener('pointerdown', closeFromOutsidePointer);
      return;
    }
    if (isOpen() && !wrapper.contains(event.target)) close();
  };
  document.addEventListener('pointerdown', closeFromOutsidePointer);
}
