// Admin-only feedback inbox. The public feedback form remains available in
// the app shell; this view is only for reviewing submitted entries.

import { api } from '../api.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';
import { emptyStateHtml } from '../emptyState.js';
import { icon } from '../icons.js';

const SENTIMENT_LABEL = { positive: 'Positiv', negative: 'Negativ', problem: 'Problem', idea: 'Idee' };

let feedbackEntries = null;
let feedbackLoading = false;
let feedbackError = null;
let feedbackSentimentFilter = 'all'; // 'all' | 'positive' | 'negative' | 'problem' | 'idea'

async function loadFeedbackEntries(ctx, force = false) {
  if (feedbackLoading || (feedbackEntries && !force)) return;
  feedbackLoading = true;
  feedbackError = null;
  if (force) ctx.rerender();
  try {
    feedbackEntries = await api.feedback.list();
  } catch (error) {
    feedbackEntries = null;
    feedbackError = error.message;
  } finally {
    feedbackLoading = false;
    ctx.rerender();
  }
}

function feedbackEntryHtml(entry) {
  const sentiment = entry.sentiment ? ` <span class="badge">${escapeHtml(SENTIMENT_LABEL[entry.sentiment] ?? entry.sentiment)}</span>` : '';
  return `
    <div class="card stack" style="padding:var(--space-3);">
      <div class="row-between">
        <span>
          <strong>${escapeHtml(entry.playerName || 'Unbekannt')}</strong>${sentiment}
          <div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(entry.view)} · ${escapeHtml(entry.eventName || '')} · ${formatDateTime(entry.createdAt)} Uhr</div>
        </span>
      </div>
      <p style="margin:0;">${escapeHtml(entry.message)}</p>
    </div>`;
}

function feedbackSentimentFilterHtml() {
  const options = [{ value: 'all', label: 'Alle' }, ...Object.entries(SENTIMENT_LABEL).map(([value, label]) => ({ value, label }))];
  return `
    <div class="chip-list" role="group" aria-label="Nach Art filtern">
      ${options
        .map(
          (option) => `<button type="button" class="chip${feedbackSentimentFilter === option.value ? ' is-active' : ''}"
            aria-pressed="${feedbackSentimentFilter === option.value}" data-feedback-sentiment-filter="${option.value}">${escapeHtml(option.label)}</button>`,
        )
        .join('')}
    </div>`;
}

function feedbackBodyHtml() {
  const visibleEntries = (feedbackEntries || []).filter(
    (entry) => feedbackSentimentFilter === 'all' || entry.sentiment === feedbackSentimentFilter,
  );
  if (feedbackError) {
    return `<div class="notice notice-warning row-between" style="gap:var(--space-2);">
      <span>Feedback konnte nicht geladen werden.</span>
      <button type="button" class="btn btn-sm" id="admin-feedback-retry">Erneut versuchen</button>
    </div>`;
  }
  if (feedbackLoading && feedbackEntries === null) return '<div class="card muted">Feedback wird geladen…</div>';
  if (visibleEntries.length === 0) {
    return emptyStateHtml((feedbackEntries || []).length === 0 ? 'Noch kein Feedback eingegangen.' : 'Kein Feedback dieser Art.');
  }
  return `<div class="stack">${visibleEntries.map(feedbackEntryHtml).join('')}</div>`;
}

function renderAccessDenied(container) {
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <button type="button" class="btn btn-sm" data-navigate="admin">${icon('chevronLeft')} Zurück zum Admin</button>
        <h1 class="view-title">Feedback</h1>
      </div>
    </div>
    <div class="card"><p class="muted">Dieses Konto hat keine Admin-Rechte.</p></div>`;
}

export function renderAdminFeedback(container, ctx) {
  if (!currentPlayerHasAdminRole()) {
    renderAccessDenied(container);
    return;
  }
  if (feedbackEntries === null && !feedbackLoading && !feedbackError) loadFeedbackEntries(ctx);

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <button type="button" class="btn btn-sm" data-navigate="admin">${icon('chevronLeft')} Zurück zum Admin</button>
        <h1 class="view-title">Feedback</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="admin-feedback-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-feedback-title">Feedback</h2>
          <button type="button" class="btn btn-sm" id="admin-feedback-refresh" ${feedbackLoading ? 'disabled' : ''}>Aktualisieren</button>
        </div>
        ${feedbackError || (feedbackEntries || []).length === 0 ? '' : feedbackSentimentFilterHtml()}
        ${feedbackBodyHtml()}
      </section>
    </div>`;

  container.querySelector('#admin-feedback-refresh')?.addEventListener('click', () => loadFeedbackEntries(ctx, true));
  container.querySelector('#admin-feedback-retry')?.addEventListener('click', () => loadFeedbackEntries(ctx, true));
  container.querySelectorAll('[data-feedback-sentiment-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      feedbackSentimentFilter = button.dataset.feedbackSentimentFilter;
      ctx.rerender();
    });
  });
}
