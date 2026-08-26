// Admin-only usage overview built from existing group data.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { currentPlayerHasAdminRole } from '../adminAccess.js';
import { eventSelectOptions } from '../eventStatus.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { backButtonHtml } from '../backButton.js';

const FEATURE_USAGE_AREAS = ['Wettkampf', 'Orga', 'Sonstiges'];
const featureUsageFilters = { eventId: '' };

let featureUsage = null;
let featureUsageLoading = false;
let featureUsageError = null;

const FEATURE_USAGE_HELP =
  'Zeigt, wie viele Personen jede Funktion bereits genutzt haben — direkt aus den vorhandenen Daten, ohne separate Erhebung. „Gesamter Verlauf“ zählt über alle Events der Gruppe; einzelne Zeilen sind nicht auf ein Event eingrenzbar und weisen das dann direkt aus.';

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
// the group produced, independent of the admin's own membership.
function featureUsageEventOptions() {
  const events = (state.managedEvents || []).filter((event) => !event.isOutsideEvents);
  return eventSelectOptions(events, { allEntryLabel: 'Gesamter Verlauf' });
}

function featureUsageRowHtml(entry, rosterSize, eventFilterActive) {
  const share = rosterSize > 0 ? Math.round((entry.players / rosterSize) * 100) : null;
  const unscopedNote =
    eventFilterActive && !entry.eventScoped
      ? '<div class="muted" style="font-size:var(--font-size-xs);">Zeigt den gesamten Verlauf, nicht auf das gewählte Event eingrenzbar.</div>'
      : '';
  return `
    <div class="row-between" style="padding:var(--space-2) 0;border-bottom:1px solid var(--border);">
      <span>
        <strong>${escapeHtml(entry.label)}</strong>
        ${entry.detail ? `<div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(entry.detail)}</div>` : ''}
        ${unscopedNote}
      </span>
      <span class="row-between" style="gap:var(--space-3);text-align:right;">
        <span>${entry.players}${share !== null ? ` <span class="muted">(${share}%)</span>` : ''} Person(en)</span>
        <span class="muted">${entry.total}×</span>
      </span>
    </div>`;
}

function usageBodyHtml() {
  if (featureUsageError) {
    return `<div class="notice notice-warning row-between" style="gap:var(--space-2);">
      <span>Bestandsdaten konnten nicht geladen werden.</span>
      <button type="button" class="btn btn-sm" id="admin-feature-usage-retry">Erneut versuchen</button>
    </div>`;
  }
  if (featureUsageLoading && featureUsage === null) return '<div class="card muted">Bestandsdaten werden geladen…</div>';
  if (!featureUsage) return '';

  return FEATURE_USAGE_AREAS.map((area) => {
    const entries = featureUsage.entries.filter((entry) => entry.area === area);
    if (entries.length === 0) return '';
    return `<div class="card stack">
      <div class="section-title">${escapeHtml(area)}</div>
      ${entries.map((entry) => featureUsageRowHtml(entry, featureUsage.rosterSize, Boolean(featureUsageFilters.eventId))).join('')}
    </div>`;
  }).join('');
}

function renderAccessDenied(container) {
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        ${backButtonHtml({ view: 'admin' })}
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
        ${backButtonHtml({ view: 'admin' })}
        <h1 class="view-title">Nutzungsauswertung</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="admin-feature-usage-title">
        <div class="grouped-page-section-title">
          <span class="title-with-info">
            <h2 id="admin-feature-usage-title">Nutzungsauswertung</h2>
            ${infoTooltipHtml('admin-feature-usage-help', 'Nutzungsauswertung', FEATURE_USAGE_HELP)}
          </span>
          <button type="button" class="btn btn-sm" id="admin-feature-usage-refresh" ${featureUsageLoading ? 'disabled' : ''}>Aktualisieren</button>
        </div>
        ${searchSelectHtml('admin-feature-usage-event', featureUsageEventOptions(), featureUsageFilters.eventId, {
          placeholder: 'Event suchen…',
          ariaLabel: 'Event',
          label: 'Events',
        })}
        ${featureUsage ? `<div class="muted" style="font-size:var(--font-size-xs);">Aktueller Bestand: ${featureUsage.rosterSize} aktive Mitglieder.</div>` : ''}
        <div class="stack">${usageBodyHtml()}</div>
      </section>
    </div>`;

  container.querySelector('#admin-feature-usage-refresh')?.addEventListener('click', () => loadFeatureUsage(ctx, true));
  container.querySelector('#admin-feature-usage-retry')?.addEventListener('click', () => loadFeatureUsage(ctx, true));
  wireSearchSelect(container, 'admin-feature-usage-event', featureUsageEventOptions(), {
    emptyText: 'Kein passendes Event gefunden.',
    onChange: (eventId) => {
      featureUsageFilters.eventId = eventId;
      featureUsage = null;
      featureUsageError = null;
      ctx.rerender();
    },
  });
  wireInfoTooltips(container);
}
