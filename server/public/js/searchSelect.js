// Generic searchable stand-in for a native <select>: a visible text input
// bound to a <datalist> (type to filter/autocomplete) plus a hidden
// <input id="${id}"> holding the actual resolved value, so existing call
// sites that read `container.querySelector('#${id}').value` or listen for
// its 'change' event keep working unchanged — only the HTML-producing line
// and one wireSearchSelect() call after render need to change. Mirrors the
// dateTimeField.js drop-in pattern (hidden input as the stable interface,
// themed visible control in front of it).

import { escapeHtml } from './format.js';

// options: Array<{ value: string, label: string }>
export function searchSelectHtml(id, options, selectedValue, { placeholder = 'Suchen…' } = {}) {
  const selected = options.find((o) => o.value === (selectedValue ?? ''));
  const initialLabel = selected ? selected.label : '';
  const datalistOptions = options.map((o) => `<option value="${escapeHtml(o.label)}"></option>`).join('');
  return `
    <input type="hidden" id="${id}" value="${escapeHtml(selectedValue ?? '')}" />
    <input type="text" id="${id}-search" list="${id}-list" value="${escapeHtml(initialLabel)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    <datalist id="${id}-list">${datalistOptions}</datalist>
  `;
}

export function wireSearchSelect(container, id, options, { onChange } = {}) {
  const hidden = container.querySelector(`#${id}`);
  const search = container.querySelector(`#${id}-search`);
  if (!hidden || !search) return;
  const byLabel = new Map(options.map((o) => [o.label.toLowerCase(), o.value]));

  // Only resolves once the typed text exactly matches an option label (that's
  // what selecting a <datalist> suggestion produces) — a partial in-progress
  // search string just keeps the previous valid selection until it matches or
  // the user picks a suggestion.
  const resolve = () => {
    const typed = search.value.trim().toLowerCase();
    const value = byLabel.get(typed);
    if (value === undefined) return;
    if (hidden.value === value) return;
    hidden.value = value;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    onChange?.(value);
  };

  search.addEventListener('input', resolve);
  search.addEventListener('change', resolve);
}
