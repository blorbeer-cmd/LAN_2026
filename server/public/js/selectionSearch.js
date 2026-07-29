import { normalizeSearchText } from './searchText.js';

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
  applyFilter();
}
