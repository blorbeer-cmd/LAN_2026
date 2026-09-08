// Shared markup for the app's ubiquitous empty/loading placeholders. Simple
// states use the safe text shorthand. A state with an illustration or CTA uses
// the structured form so views cannot smuggle arbitrary copy HTML into this
// otherwise canonical component. Empty-state copy is always one plain line.

import { escapeHtml } from './format.js';

function illustrationHtml(illustration) {
  if (!illustration?.src) return '';
  const width = Number.isFinite(illustration.width) && illustration.width > 0
    ? ` width="${illustration.width}"`
    : '';
  const height = Number.isFinite(illustration.height) && illustration.height > 0
    ? ` height="${illustration.height}"`
    : '';
  const className = illustration.className ? ` class="${escapeHtml(illustration.className)}"` : '';
  return `<img src="${escapeHtml(illustration.src)}" alt="${escapeHtml(illustration.alt ?? '')}"${width}${height}${className} />`;
}

function actionHtml(action) {
  if (!action?.label) return '';
  const id = action.id ? ` id="${escapeHtml(action.id)}"` : '';
  const navigate = action.navigate ? ` data-navigate="${escapeHtml(action.navigate)}"` : '';
  const className = action.className ?? 'btn btn-primary btn-sm';
  return `<div class="empty-state-actions"><button type="button" class="${escapeHtml(className)}"${id}${navigate}>${escapeHtml(action.label)}</button></div>`;
}

export function emptyStateHtml(content, presentation = {}) {
  const structured = content !== null && typeof content === 'object' && !Array.isArray(content);
  const options = structured ? content : presentation;
  const illustration = structured ? illustrationHtml(options.illustration) : '';
  const copy = structured
    ? `${options.text ? `<span class="empty-state-text">${escapeHtml(options.text)}</span>` : ''}${actionHtml(options.action)}`
    : escapeHtml(content);
  const classes = `empty-state${structured ? ' empty-state-structured' : ''}${options.className ? ` ${escapeHtml(options.className)}` : ''}`;
  const styleAttr = options.style ? ` style="${escapeHtml(options.style)}"` : '';
  return `<div class="${classes}"${styleAttr}>${illustration}${copy}</div>`;
}
