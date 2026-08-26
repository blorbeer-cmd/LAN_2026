import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Canonical back-navigation control. Header back buttons use one icon, one
// compact shape and the same default label across every view. A local `id`
// supports sub-views that return through their own state instead of a route.
export function backButtonHtml({ view, id, label = 'Zurück' } = {}) {
  if (!view && !id) throw new Error('Ein Zurück-Button braucht view oder id.');
  const viewAttr = view ? ` data-navigate="${escapeHtml(view)}"` : '';
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  return `<button type="button" class="btn btn-sm"${idAttr}${viewAttr}>${icon('chevronLeft')} ${escapeHtml(label)}</button>`;
}
