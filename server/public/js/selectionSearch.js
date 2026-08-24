import { normalizeSearchText } from './searchText.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';

export function selectionSearchHtml(inputId, query = '', { placeholder = 'Spieler suchen…', label = 'Spieler suchen' } = {}) {
  const expanded = Boolean(query.trim());
  return `
    <div class="selection-search${expanded ? ' is-open' : ''}" data-selection-search>
      <button type="button" class="selection-search-trigger icon-btn" data-selection-search-trigger aria-label="${escapeHtml(label)}" aria-controls="${escapeHtml(inputId)}" aria-expanded="${expanded}" data-tooltip="${escapeHtml(label)}" ${expanded ? 'hidden' : ''}>${icon('search')}</button>
      <div class="selection-search-field" data-selection-search-field ${expanded ? '' : 'hidden'}>
        <input type="search" id="${escapeHtml(inputId)}" value="${escapeHtml(query)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}" autocomplete="off" />
        <button type="button" class="selection-search-close icon-btn" data-selection-search-close aria-label="Suche schließen">${icon('x')}</button>
      </div>
    </div>`;
}

export function matchesSelectionSearch(value, query) {
  const normalizedQuery = normalizeSearchText(query);
  return !normalizedQuery || normalizeSearchText(value).includes(normalizedQuery);
}

export function wireSelectionSearch(
  container,
  { inputId, itemSelector, emptySelector, onQueryChange },
) {
  const input = container.querySelector(`#${inputId}`);
  if (!input) return;
  const wrapper = input.closest('[data-selection-search]');
  const trigger = wrapper?.querySelector('[data-selection-search-trigger]');
  const field = wrapper?.querySelector('[data-selection-search-field]');
  const closeButton = wrapper?.querySelector('[data-selection-search-close]');

  const setExpanded = (expanded, { focus = false } = {}) => {
    if (!wrapper || !trigger || !field) return;
    wrapper.classList.toggle('is-open', expanded);
    trigger.hidden = expanded;
    field.hidden = !expanded;
    trigger.setAttribute('aria-expanded', String(expanded));
    if (expanded && focus) input.focus({ preventScroll: true });
  };

  const applyFilter = () => {
    const normalizedQuery = normalizeSearchText(input.value);
    let visibleCount = 0;
    container.querySelectorAll(itemSelector).forEach((item) => {
      const visible = !normalizedQuery || normalizeSearchText(item.dataset.selectionSearch).includes(normalizedQuery);
      item.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const empty = container.querySelector(emptySelector);
    if (empty) empty.hidden = !normalizedQuery || visibleCount > 0;
  };

  input.addEventListener('input', () => {
    onQueryChange(input.value);
    applyFilter();
  });
  trigger?.addEventListener('click', () => setExpanded(true, { focus: true }));
  closeButton?.addEventListener('click', () => {
    input.value = '';
    onQueryChange('');
    applyFilter();
    setExpanded(false);
    trigger?.focus({ preventScroll: true });
  });
  setExpanded(Boolean(input.value.trim()));
  applyFilter();
}
