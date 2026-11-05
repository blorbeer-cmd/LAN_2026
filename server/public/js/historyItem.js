import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Match history and LAN points share the same card, independent disclosure
// and trailing actions. Meta, actions and details are trusted, escaped markup.
export function historyItemHtml(id, title, meta, actions, details, { open = false, extraClass = '', isMine = false } = {}) {
  const panelId = `match-history-${id}`;
  return `<div class="card matchmaking-history-item ${extraClass}" data-history-item="${escapeHtml(id)}">
    <div class="matchmaking-history-head">
      <button type="button" class="matchmaking-history-toggle" data-history-toggle="${escapeHtml(id)}" aria-expanded="${open}" aria-controls="${escapeHtml(panelId)}">
        <span class="matchmaking-history-chevron">${icon('chevronRight')}</span>
        <span class="matchmaking-history-title player-name">${isMine ? `<strong>${escapeHtml(title)}</strong>` : escapeHtml(title)}</span>
        <span class="matchmaking-history-meta">${meta}</span>
      </button>
      <div class="matchmaking-draw-actions">${actions}</div>
    </div>
    <div id="${escapeHtml(panelId)}" class="matchmaking-history-details stack" ${open ? '' : 'hidden'}>${details}</div>
  </div>`;
}
