// Shared searchable combobox used wherever a game must be selected. The
// visible listbox is rendered by Respawn instead of the browser's native
// <datalist> popup, so it follows the dark design system consistently while
// preserving the hidden input contract used by the existing views.

import { escapeHtml } from './format.js';
import { icon } from './icons.js';

function optionHtml(id, option, index, selectedValue) {
  const selected = option.value === (selectedValue ?? '');
  return `<button type="button" id="${id}-option-${index}" class="search-select-option" role="option" aria-selected="${selected}" data-search-select-index="${index}" data-search-select-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`;
}

// options: Array<{ value: string, label: string }>
export function searchSelectHtml(id, options, selectedValue, { placeholder = 'Suchen…' } = {}) {
  const selected = options.find((option) => option.value === (selectedValue ?? ''));
  const initialLabel = selected ? selected.label : '';
  const renderedOptions = options.map((option, index) => optionHtml(id, option, index, selectedValue)).join('');

  return `
    <div class="search-select" data-search-select>
      <input type="hidden" id="${id}" value="${escapeHtml(selectedValue ?? '')}" />
      <div class="search-select-control">
        <input type="text" id="${id}-search" value="${escapeHtml(initialLabel)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" />
        <button type="button" class="search-select-toggle" aria-label="Auswahl öffnen" aria-controls="${id}-list" aria-expanded="false" tabindex="-1">${icon('chevronDown')}</button>
      </div>
      <div id="${id}-list" class="search-select-list" role="listbox" aria-label="Verfügbare Optionen" hidden>${renderedOptions}</div>
    </div>
  `;
}

export function wireSearchSelect(container, id, options, { onChange } = {}) {
  const hidden = container.querySelector(`#${id}`);
  const search = container.querySelector(`#${id}-search`);
  const wrapper = search?.closest('[data-search-select]');
  const list = container.querySelector(`#${id}-list`);
  const toggle = wrapper?.querySelector('.search-select-toggle');
  if (!hidden || !search || !wrapper || !list || !toggle) return;

  let filteredOptions = options.map((option, originalIndex) => ({ ...option, originalIndex }));
  let activeIndex = -1;
  let suppressNextFocusOpen = false;

  const labelForValue = () => options.find((option) => option.value === hidden.value)?.label ?? '';
  const isOpen = () => !list.hidden;

  const updateExpandedState = (expanded) => {
    wrapper.classList.toggle('is-open', expanded);
    search.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-expanded', String(expanded));
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
      list.innerHTML = '<div class="search-select-empty">Kein passendes Spiel gefunden.</div>';
      activeIndex = -1;
      search.removeAttribute('aria-activedescendant');
      return;
    }

    list.innerHTML = filteredOptions
      .map((option) => optionHtml(id, option, option.originalIndex, hidden.value))
      .join('');
    const selectedIndex = filteredOptions.findIndex((option) => option.value === hidden.value);
    activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
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
      close();
    }
  });

  toggle.addEventListener('click', () => {
    if (isOpen()) {
      close();
      focusSearchWithoutOpening();
      return;
    }
    search.focus();
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
}
