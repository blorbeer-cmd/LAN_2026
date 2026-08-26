// Shared markup for the app's ubiquitous empty/loading placeholders. Simple
// states use the safe text shorthand. A state with title, explanation or CTA
// uses the structured form so views cannot smuggle arbitrary copy HTML into
// this otherwise canonical component.

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
  const iconHtml = options.icon ? `<span class="empty-state-icon">${options.icon}</span>` : '';
  const illustration = structured ? illustrationHtml(options.illustration) : '';
  const copy = structured
    ? `${options.title ? `<strong class="empty-state-title">${escapeHtml(options.title)}</strong>` : ''}${options.body ? `<p class="empty-state-body">${escapeHtml(options.body)}</p>` : ''}${actionHtml(options.action)}`
    : escapeHtml(content);
  const classes = `empty-state${structured ? ' empty-state-structured' : ''}${options.className ? ` ${escapeHtml(options.className)}` : ''}`;
  const styleAttr = options.style ? ` style="${escapeHtml(options.style)}"` : '';
  return `<div class="${classes}"${styleAttr}>${iconHtml}${illustration}${copy}</div>`;
}
