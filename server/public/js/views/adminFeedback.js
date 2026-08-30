// Admin-only feedback inbox. The public feedback form remains available in
// the app shell; this view is only for reviewing submitted entries.

import { api } from '../api.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';
import { emptyStateHtml } from '../emptyState.js';
import { backButtonHtml } from '../backButton.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';

const SENTIMENT_LABEL = { positive: 'Positiv', negative: 'Negativ', problem: 'Problem', idea: 'Idee' };

let feedbackEntries = null;
let feedbackLoading = false;
let feedbackError = null;
let feedbackSentimentFilter = 'all'; // 'all' | 'positive' | 'negative' | 'problem' | 'idea'
let completedSectionOpen = false;
const updatingFeedbackIds = new Set();

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
  const updating = updatingFeedbackIds.has(entry.id);
  const nextResolved = !entry.resolvedAt;
  const actionLabel = nextResolved ? 'Erledigen' : 'Wieder öffnen';
  const accessibleActionLabel = nextResolved
    ? `Feedback von ${entry.playerName || 'Unbekannt'} erledigen`
    : `Feedback von ${entry.playerName || 'Unbekannt'} wieder öffnen`;
  return `
    <div class="card stack" style="padding:var(--space-3);" data-feedback-entry="${escapeHtml(entry.id)}">
      <div class="row-between" style="align-items:flex-start;flex-wrap:wrap;">
        <span style="min-width:0;flex:1 1 auto;">
          <strong>${escapeHtml(entry.playerName || 'Unbekannt')}</strong>${sentiment}
          <div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(entry.view)} · ${escapeHtml(entry.eventName || '')} · ${formatDateTime(entry.createdAt)} Uhr</div>
        </span>
        <button type="button" class="btn btn-sm" data-feedback-resolution="${escapeHtml(entry.id)}"
          data-next-resolved="${nextResolved}" aria-label="${escapeHtml(accessibleActionLabel)}" ${updating ? 'disabled' : ''}>${actionLabel}</button>
      </div>
      <p style="margin:0;">${escapeHtml(entry.message)}</p>
    </div>`;
}

async function setFeedbackResolved(id, resolved, ctx) {
  if (updatingFeedbackIds.has(id)) return;
  updatingFeedbackIds.add(id);
  ctx.rerender();
  try {
    const updated = await api.feedback.setResolved(id, resolved);
    feedbackEntries = (feedbackEntries || []).map((entry) => (entry.id === id ? { ...entry, ...updated } : entry));
    showToast(resolved ? 'Feedback erledigt.' : 'Feedback wieder geöffnet.');
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    updatingFeedbackIds.delete(id);
    ctx.rerender();
  }
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

function filteredFeedbackEntries() {
  return (feedbackEntries || []).filter(
    (entry) => feedbackSentimentFilter === 'all' || entry.sentiment === feedbackSentimentFilter,
  );
}

function openFeedbackBodyHtml(entries) {
  if (feedbackError) {
    return `<div class="notice notice-warning row-between" style="gap:var(--space-2);">
      <span>Feedback konnte nicht geladen werden.</span>
      <button type="button" class="btn btn-sm" id="admin-feedback-retry">Erneut versuchen</button>
    </div>`;
  }
  if (feedbackLoading && feedbackEntries === null) return '<div class="card muted">Feedback wird geladen…</div>';
  if (entries.length === 0) {
    if ((feedbackEntries || []).length === 0) return emptyStateHtml('Noch kein Feedback eingegangen.');
    return emptyStateHtml(feedbackSentimentFilter === 'all' ? 'Kein offenes Feedback.' : 'Kein offenes Feedback dieser Art.');
  }
  return `<div class="stack">${entries.map(feedbackEntryHtml).join('')}</div>`;
}

function completedFeedbackSectionHtml(entries) {
  if (entries.length === 0) return '';
  return `
    <details class="card grouped-page-section collapsible-section" data-admin-feedback-completed ${completedSectionOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>Erledigt</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge">${entries.length}</span>
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">
        <div class="stack">${entries.map(feedbackEntryHtml).join('')}</div>
      </div>
    </details>`;
}

function renderAccessDenied(container) {
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        ${backButtonHtml({ view: 'admin' })}
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
  const visibleEntries = filteredFeedbackEntries();
  const openEntries = visibleEntries.filter((entry) => !entry.resolvedAt);
  const completedEntries = visibleEntries.filter((entry) => Boolean(entry.resolvedAt));

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        ${backButtonHtml({ view: 'admin' })}
        <h1 class="view-title">Feedback</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="admin-feedback-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-feedback-title">Offen</h2>
          <button type="button" class="btn btn-sm" id="admin-feedback-refresh" ${feedbackLoading ? 'disabled' : ''}>Aktualisieren</button>
        </div>
        ${feedbackError || (feedbackEntries || []).length === 0 ? '' : feedbackSentimentFilterHtml()}
        ${openFeedbackBodyHtml(openEntries)}
      </section>
      ${feedbackError ? '' : completedFeedbackSectionHtml(completedEntries)}
    </div>`;

  container.querySelector('#admin-feedback-refresh')?.addEventListener('click', () => loadFeedbackEntries(ctx, true));
  container.querySelector('#admin-feedback-retry')?.addEventListener('click', () => loadFeedbackEntries(ctx, true));
  container.querySelectorAll('[data-feedback-sentiment-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      feedbackSentimentFilter = button.dataset.feedbackSentimentFilter;
      ctx.rerender();
    });
  });
  const completedSection = container.querySelector('[data-admin-feedback-completed]');
  completedSection?.addEventListener('toggle', () => {
    completedSectionOpen = completedSection.open;
  });
  container.querySelectorAll('[data-feedback-resolution]').forEach((button) => {
    button.addEventListener('click', () => {
      void setFeedbackResolved(button.dataset.feedbackResolution, button.dataset.nextResolved === 'true', ctx);
    });
  });
}
