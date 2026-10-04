// Admin-only usage overview built from existing group data. The same shape as
// Statistiken: an overview card with the event filter and key figures, then
// one card per area whose features are a ranking by reach.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';
import { eventSelectOptions } from '../eventStatus.js';
import { emptyStateHtml } from '../emptyState.js';
import { rankedListHtml, sharedRankNumbers } from '../rankedList.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';

const FEATURE_USAGE_AREAS = ['Wettkampf', 'Orga', 'Sonstiges'];
const featureUsageFilters = { eventId: '' };

let featureUsage = null;
let featureUsageLoading = false;
let featureUsageError = null;

export function invalidateAdminFeatureUsage() {
  featureUsage = null;
  featureUsageError = null;
}

async function loadFeatureUsage(ctx, force = false) {
  if (featureUsageLoading || (featureUsage && !force)) return;
  featureUsageLoading = true;
  featureUsageError = null;
  if (force) ctx.rerender();
  try {
    featureUsage = await api.admin.featureUsage(featureUsageFilters.eventId || undefined);
  } catch (error) {
    featureUsage = null;
    featureUsageError = error.message;
  } finally {
    featureUsageLoading = false;
    ctx.rerender();
  }
}

// The group's whole event history, not just events the admin personally
// joined (state.managedEvents, owner/admin only) — usage covers everything
// the group produced, independent of the admin's own membership. "Alle
// Events" carries its own icon like the filter in Statistiken, so its text
// lines up with the event options.
function featureUsageEventOptions() {
  const events = (state.managedEvents || []).filter((event) => !event.isOutsideEvents);
  const [all, ...options] = eventSelectOptions(events, { allEntryLabel: 'Alle Events' });
  return [{ ...all, icon: 'calendar', iconLabel: 'Alle Events' }, ...options];
}

function personCount(count) {
  return `${count} ${count === 1 ? 'Person' : 'Personen'}`;
}

// Features of one area ranked by how many people used them; equal reach
// shares a place. An unused feature keeps its row with 0 % and no meta, and
// a row the event filter cannot narrow says so in its meta line.
function areaItems(entries, rosterSize, eventFilterActive) {
  const sorted = [...entries].sort((a, b) => b.players - a.players || b.total - a.total);
  const ranks = sharedRankNumbers(sorted.map((entry) => entry.players));
  return sorted.map((entry, i) => {
    const used = entry.players > 0;
    const meta = [
      used ? personCount(entry.players) : '',
      used ? `${entry.total}×` : '',
      used && entry.detail ? escapeHtml(entry.detail) : '',
      eventFilterActive && !entry.eventScoped ? 'alle Events' : '',
    ].filter(Boolean).join(' · ');
    const share = rosterSize > 0 ? `${Math.round((entry.players / rosterSize) * 100)} %` : String(entry.players);
    return { title: escapeHtml(entry.label), meta, value: share, rank: ranks[i] };
  });
}

function areaSection(area) {
  const entries = featureUsage.entries.filter((entry) => entry.area === area);
  if (entries.length === 0) return '';
  const items = areaItems(entries, featureUsage.rosterSize, Boolean(featureUsageFilters.eventId));
  return `
    <section class="card stack grouped-page-section" aria-labelledby="feature-usage-${area}">
      <div class="grouped-page-section-title"><h2 id="feature-usage-${area}">${escapeHtml(area)}</h2></div>
      ${rankedListHtml(items, { ranked: true, label: area })}
    </section>`;
}

function overviewBodyHtml() {
  if (featureUsageError) {
    return `<div class="notice notice-warning row-between" style="gap:var(--space-2);">
      <span>Bestandsdaten konnten nicht geladen werden.</span>
      <button type="button" class="btn btn-sm" id="admin-feature-usage-retry">Erneut versuchen</button>
    </div>`;
  }
  if (!featureUsage) return emptyStateHtml('Lädt', { className: 'empty-state-compact' });
  const used = featureUsage.entries.filter((entry) => entry.players > 0).length;
  // Four figures, so the phone layout keeps two even rows.
  const figures = [
    [featureUsage.rosterSize, 'Mitglieder'],
    [featureUsage.entries.length, 'Funktionen'],
    [used, 'Genutzt'],
    [featureUsage.entries.length - used, 'Ungenutzt'],
  ];
  return `<div class="my-stats-kpis">
    ${figures.map(([value, text]) => `
      <div class="my-stats-kpi">
        <span class="my-stats-kpi-value">${value}</span>
        <span class="my-stats-kpi-label">${text}</span>
      </div>`).join('')}
  </div>`;
}

function renderAccessDenied(container) {
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Nutzungsauswertung</h1>
      </div>
    </div>
    <div class="card"><p class="muted">Dieses Konto hat keine Admin-Rechte.</p></div>`;
}

export function renderAdminFeatureUsage(container, ctx) {
  if (!currentPlayerHasAdminRole()) {
    renderAccessDenied(container);
    return;
  }
  if (featureUsage === null && !featureUsageLoading && !featureUsageError) loadFeatureUsage(ctx);

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Nutzungsauswertung</h1>
        <button type="button" class="btn btn-sm" id="admin-feature-usage-refresh" ${featureUsageLoading ? 'disabled' : ''}>Aktualisieren</button>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="feature-usage-overview-title">
        <div class="grouped-page-section-title"><h2 id="feature-usage-overview-title">Überblick</h2></div>
        ${searchSelectHtml('admin-feature-usage-event', featureUsageEventOptions(), featureUsageFilters.eventId, {
          placeholder: 'Event suchen',
          ariaLabel: 'Event',
          label: 'Auswertbare Events',
        })}
        ${overviewBodyHtml()}
      </section>
      ${featureUsage ? FEATURE_USAGE_AREAS.map(areaSection).join('') : ''}
    </div>`;

  container.querySelector('#admin-feature-usage-refresh')?.addEventListener('click', () => loadFeatureUsage(ctx, true));
  container.querySelector('#admin-feature-usage-retry')?.addEventListener('click', () => loadFeatureUsage(ctx, true));
  wireSearchSelect(container, 'admin-feature-usage-event', featureUsageEventOptions(), {
    emptyText: 'Kein passendes Event gefunden',
    onChange: (eventId) => {
      featureUsageFilters.eventId = eventId;
      featureUsage = null;
      featureUsageError = null;
      ctx.rerender();
    },
  });
}
