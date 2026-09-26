// Admin-only feedback inbox. The public feedback form remains available in
// the app shell; this view is only for reviewing submitted entries.

import { api } from '../api.js';
import { escapeHtml, formatDate, formatDateTime } from '../format.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';
import { emptyStateHtml } from '../emptyState.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { openModal } from '../modal.js';
import { getMyId } from '../whoami.js';
import { viewDefinition } from '../viewManifest.js';
import { wireSelectionSearch } from '../selectionSearch.js';
import { wireActionMenus } from '../actionMenu.js';

const SENTIMENT_LABEL = { positive: 'Positiv', negative: 'Negativ', problem: 'Problem', idea: 'Idee' };
const DEVICE_LABEL = { mobile: 'Handy', tablet: 'Tablet', desktop: 'Desktop' };
const SORTS = [
  ['newest', 'Neueste'],
  ['oldest', 'Älteste'],
];
const SENTIMENT_FILTERS = [['all', 'Alle'], ...Object.entries(SENTIMENT_LABEL)];
// The row shows one calm line like the Durchsage and To-Do tables; the detail
// dialog shows the full text.
const MESSAGE_PREVIEW_LENGTH = 40;

let feedbackEntries = null;
let feedbackLoading = false;
let feedbackError = null;
let feedbackSentimentFilter = 'all'; // 'all' | 'positive' | 'negative' | 'problem' | 'idea'
let feedbackSort = 'newest';
let feedbackQuery = '';
let filterMenuOpen = false;
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

// Feedback stores the view key it was sent from; admins read the page name.
// Match is the navigation name of the team view.
function viewLabel(view) {
  if (view === 'matchmaking') return 'Match';
  return viewDefinition(view)?.label ?? view;
}

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function shortTime(timestampMs, now = Date.now()) {
  if (!sameDay(timestampMs, now)) return formatDate(timestampMs);
  return new Date(timestampMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function previewText(message) {
  const line = message.replace(/\s*\n\s*/g, ' · ');
  return line.length > MESSAGE_PREVIEW_LENGTH ? `${line.slice(0, MESSAGE_PREVIEW_LENGTH).trimEnd()}…` : line;
}

function senderName(entry) {
  return entry.playerName || 'Unbekannt';
}

function senderHtml(entry) {
  const name = escapeHtml(senderName(entry));
  return entry.playerId && entry.playerId === getMyId() ? `<strong class="broadcast-table-me">${name}</strong>` : name;
}

function metaText(entry) {
  return [SENTIMENT_LABEL[entry.sentiment], viewLabel(entry.view), shortTime(entry.createdAt)].filter(Boolean).join(' · ');
}

function searchText(entry) {
  return [entry.message, senderName(entry), SENTIMENT_LABEL[entry.sentiment], viewLabel(entry.view), entry.eventName].filter(Boolean).join(' ');
}

// One table row per entry: message, sender, meta and one fixed action column.
// The whole row opens the detail dialog. Completed entries have no row
// action; they reopen from the dialog.
function feedbackRowHtml(entry) {
  const done = Boolean(entry.resolvedAt);
  const updating = updatingFeedbackIds.has(entry.id);
  const action = done
    ? ''
    : `<button type="button" class="btn btn-sm" data-feedback-resolution="${escapeHtml(entry.id)}" data-next-resolved="true"
        aria-label="${escapeHtml(`Feedback von ${senderName(entry)} erledigen`)}" ${updating ? 'disabled' : ''}>Erledigt</button>`;
  return `
    <div class="broadcast-table-row${done ? ' is-past' : ''}" role="row" data-feedback-entry="${escapeHtml(entry.id)}"
      data-selection-search="${escapeHtml(searchText(entry))}">
      <div class="broadcast-table-message" role="cell">
        <button type="button" class="broadcast-table-open" data-feedback-detail="${escapeHtml(entry.id)}" title="${escapeHtml(entry.message)}">${escapeHtml(previewText(entry.message))}</button>
      </div>
      <div class="broadcast-table-sender" role="cell"><span>${senderHtml(entry)}</span></div>
      <div class="broadcast-table-when" role="cell">${escapeHtml(metaText(entry))}</div>
      <div class="broadcast-table-action" role="cell">${action}</div>
    </div>`;
}

function tableHtml(entries, label) {
  return `<div class="broadcast-table" role="table" aria-label="${label}">${entries.map(feedbackRowHtml).join('')}</div>`;
}

async function setFeedbackResolved(id, resolved, ctx) {
  if (updatingFeedbackIds.has(id)) return false;
  updatingFeedbackIds.add(id);
  ctx.rerender();
  try {
    const updated = await api.feedback.setResolved(id, resolved);
    feedbackEntries = (feedbackEntries || []).map((entry) => (entry.id === id ? { ...entry, ...updated } : entry));
    showToast(resolved ? 'Feedback erledigt.' : 'Feedback wieder geöffnet.');
    return true;
  } catch (error) {
    showToast(error.message, { error: true });
    return false;
  } finally {
    updatingFeedbackIds.delete(id);
    ctx.rerender();
  }
}

function openFeedbackDetail(entry, ctx) {
  const done = Boolean(entry.resolvedAt);
  const facts = [
    ['Von', senderHtml(entry)],
    ['Art', escapeHtml(SENTIMENT_LABEL[entry.sentiment] ?? '')],
    ['Seite', escapeHtml(viewLabel(entry.view))],
    ['Event', escapeHtml(entry.eventName ?? '')],
    ['Gerät', escapeHtml(DEVICE_LABEL[entry.device] ?? '')],
    ['Gesendet', `${formatDateTime(entry.createdAt)} Uhr`],
    ['Erledigt', done ? `${formatDateTime(entry.resolvedAt)} Uhr` : ''],
  ].filter(([, value]) => value);
  const { close } = openModal(
    'Feedback',
    `<div class="stack">
       <p class="broadcast-detail-message">${escapeHtml(entry.message)}</p>
       <dl class="broadcast-detail-facts">
         ${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}
       </dl>
       <div class="broadcast-detail-footer">
         <button type="button" class="btn btn-sm" data-detail-resolution>${done ? 'Wieder öffnen' : 'Erledigt'}</button>
       </div>
     </div>`,
    {
      onMount: (el) => {
        el.querySelector('.modal')?.classList.add('broadcast-detail-modal');
        el.querySelector('[data-detail-resolution]')?.addEventListener('click', async (event) => {
          const button = event.currentTarget;
          if (button.disabled) return;
          button.disabled = true;
          if (await setFeedbackResolved(entry.id, !done, ctx)) close();
          else button.disabled = false;
        });
      },
    },
  );
}

function menuOptionsHtml(options, current, attr) {
  return options
    .map(
      ([value, label]) =>
        `<button type="button" class="btn btn-sm game-catalog-sort-option${value === current ? ' is-active' : ''}" ${attr}="${value}" aria-pressed="${value === current}">${label}</button>`,
    )
    .join('');
}

// Two directions are an either/or choice, so one button flips between them
// instead of opening a menu with two entries.
function sortToggleHtml() {
  const current = SORTS.find(([key]) => key === feedbackSort)[1];
  const next = SORTS.find(([key]) => key !== feedbackSort)[1];
  return `<button type="button" class="btn btn-sm game-catalog-sort-trigger" data-feedback-sort-toggle aria-label="Sortierung: ${current} zuerst, umschalten auf ${next} zuerst">
      ${current} ${icon('arrowDownUp')}
    </button>`;
}

function toolbarHtml() {
  const activeFilters = feedbackSentimentFilter !== 'all' ? 1 : 0;
  return `<section class="game-catalog-toolbar" aria-label="Feedback durchsuchen, sortieren und filtern">
    <input type="search" id="admin-feedback-search" value="${escapeHtml(feedbackQuery)}" placeholder="Feedback suchen" aria-label="Feedback suchen" autocomplete="off" />
    ${sortToggleHtml()}
    <details class="action-menu game-catalog-filter-menu admin-feedback-filter-menu" ${filterMenuOpen ? 'open' : ''}>
      <summary class="btn btn-sm game-catalog-filter-trigger" aria-label="Filter öffnen${activeFilters ? `, ${activeFilters} aktiv` : ''}">
        Filter${activeFilters ? ` (${activeFilters})` : ''} ${icon('chevronDown')}
      </summary>
      <div class="action-menu-panel game-catalog-filter-panel">
        <div class="stack game-catalog-filter-section" role="group" aria-label="Nach Art filtern">
          <span class="game-catalog-filter-heading">Art</span>
          <div class="checklist-filter-options">${menuOptionsHtml(SENTIMENT_FILTERS, feedbackSentimentFilter, 'data-feedback-sentiment-filter')}</div>
        </div>
      </div>
    </details>
  </section>`;
}

function filteredFeedbackEntries() {
  const direction = feedbackSort === 'oldest' ? 1 : -1;
  return (feedbackEntries || [])
    .filter((entry) => feedbackSentimentFilter === 'all' || entry.sentiment === feedbackSentimentFilter)
    .sort((a, b) => direction * (a.createdAt - b.createdAt));
}

function openFeedbackBodyHtml(entries) {
  if (feedbackError) {
    return `<div class="row-between" style="gap:var(--space-2);">
      <span class="muted" style="flex:1;min-width:0;">Feedback konnte nicht geladen werden.</span>
      <button type="button" class="btn btn-sm" id="admin-feedback-retry">Erneut versuchen</button>
    </div>`;
  }
  if (feedbackLoading && feedbackEntries === null) return emptyStateHtml('Feedback wird geladen');
  if ((feedbackEntries || []).length === 0) return emptyStateHtml('Noch kein Feedback.');
  const body = entries.length
    ? tableHtml(entries, 'Offenes Feedback')
    : emptyStateHtml(feedbackSentimentFilter === 'all' ? 'Kein offenes Feedback.' : 'Kein offenes Feedback dieser Art.');
  return `${toolbarHtml()}
    ${body}
    <p class="muted" data-admin-feedback-search-empty role="status" style="font-size:var(--font-size-xs);" hidden>Kein passendes Feedback gefunden.</p>`;
}

function completedFeedbackSectionHtml(entries) {
  if (entries.length === 0) return '';
  return `
    <details class="card grouped-page-section history-details collapsible-section" data-admin-feedback-completed ${completedSectionOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2>Historie</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${entries.length}</span>
          <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content">${tableHtml(entries, 'Historie')}</div>
    </details>`;
}

function renderAccessDenied(container) {
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
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
        <h1 class="view-title">Feedback</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="admin-feedback-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-feedback-title">Offen</h2>
          <button type="button" class="btn btn-sm" id="admin-feedback-refresh" ${feedbackLoading ? 'disabled' : ''}>Aktualisieren</button>
        </div>
        ${openFeedbackBodyHtml(openEntries)}
      </section>
      ${feedbackError ? '' : completedFeedbackSectionHtml(completedEntries)}
    </div>`;

  container.querySelector('#admin-feedback-refresh')?.addEventListener('click', () => loadFeedbackEntries(ctx, true));
  container.querySelector('#admin-feedback-retry')?.addEventListener('click', () => loadFeedbackEntries(ctx, true));

  wireActionMenus(container);
  const filterMenu = container.querySelector('.admin-feedback-filter-menu');
  filterMenu?.addEventListener('toggle', () => {
    filterMenuOpen = filterMenu.open;
  });
  wireSelectionSearch(container, {
    inputId: 'admin-feedback-search',
    itemSelector: '[data-feedback-entry]',
    emptySelector: '[data-admin-feedback-search-empty]',
    onQueryChange: (query) => {
      feedbackQuery = query;
    },
  });
  container.querySelector('[data-feedback-sort-toggle]')?.addEventListener('click', () => {
    feedbackSort = feedbackSort === 'newest' ? 'oldest' : 'newest';
    ctx.rerender();
    // Keep the toggle under the keyboard so it can be flipped back at once.
    container.querySelector('[data-feedback-sort-toggle]')?.focus();
  });
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
  container.querySelectorAll('[data-feedback-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = (feedbackEntries || []).find((candidate) => candidate.id === button.dataset.feedbackDetail);
      if (entry) openFeedbackDetail(entry, ctx);
    });
  });
  container.querySelectorAll('[data-feedback-resolution]').forEach((button) => {
    button.addEventListener('click', () => {
      void setFeedbackResolved(button.dataset.feedbackResolution, button.dataset.nextResolved === 'true', ctx);
    });
  });
}
