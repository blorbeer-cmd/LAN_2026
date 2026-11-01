import { escapeHtml, formatDateTime } from './format.js';
import { emptyStateHtml } from './emptyState.js';
import { POINT_CATEGORIES, pointsChartHtml, signedPoints } from './pointsPresentation.js';

const e = escapeHtml;
const categoryName = (account) => POINT_CATEGORIES[account] ?? (account === 'wallet' ? 'Wettguthaben' : account);

function categoryOptions(selected, all = false) {
  return `${all ? '<option value="">Alle Konten</option>' : ''}${Object.entries({
    ...POINT_CATEGORIES, ...(all ? { wallet: 'Wettguthaben' } : {}),
  }).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('')}`;
}

function rowsHtml(entries, admin = false) {
  return `<ol class="points-journal">${entries.map((entry) => `<li>
    <div><strong>${e(admin ? entry.playerName : entry.title)}</strong>${admin ? `<div>${e(entry.title)}</div>` : ''}
      <div class="muted">${e(categoryName(entry.account))} · ${e(formatDateTime(entry.createdAt ?? entry.created_at))}</div>
      ${entry.reason ? `<div class="muted">${e(entry.reason)}</div>` : ''}
    </div><strong>${e(signedPoints(entry.amount))} P.</strong>
    <button type="button" class="btn btn-sm" ${admin ? 'data-admin-category-entry' : 'data-category-entry'}="${e(entry.id)}" aria-label="Details: ${e(admin ? `${entry.playerName} · ${entry.title}` : entry.title)}">Details</button>
  </li>`).join('')}</ol>`;
}

export function categoryPointsHtml(data, { account, query }) {
  const entries = (data.categoryJournal ?? []).filter((entry) => entry.account === account);
  const needle = query.trim().toLocaleLowerCase('de');
  const filtered = entries.filter((entry) => `${entry.title} ${entry.reason ?? ''}`.toLocaleLowerCase('de').includes(needle));
  return `<section class="card stack" aria-label="Meine Kategorien"><h2>Kategorien</h2>
    <div class="my-stats-kpis">${Object.entries(POINT_CATEGORIES).map(([key, label]) => `<div class="my-stats-kpi">
      <span class="my-stats-kpi-value" data-category-balance="${key}">${e(data.categoryBalances?.[key] ?? 0)}</span>
      <span class="my-stats-kpi-label">${label}</span></div>`).join('')}</div>
    <p class="muted">Spiel- und Orga-Punkte werden getrennt vom Wettguthaben gesammelt.</p>
  </section><section class="card stack" aria-label="Kategorie-Verlauf"><h2>Kategorie-Verlauf</h2>
    <div class="points-filters"><label class="stack"><span class="field-label">Kategorie</span><select name="categoryAccount" data-category-account>${categoryOptions(account)}</select></label>
      <label class="stack"><span class="field-label">Buchungen durchsuchen</span><input type="search" name="categoryQuery" data-category-query value="${e(query)}" placeholder="Vorgang suchen"></label></div>
    ${account === 'betting' && data.bettingParticipation ? `<p class="muted">Regulär abgerechnete Wetten: ${e(data.bettingParticipation.settledTips)}. Für einen Wettplatz sind mindestens ${e(data.bettingParticipation.minimumTips)} und ein positiver Nettogewinn erforderlich. Vollständige Erstattungen zählen nicht.</p>` : ''}
    ${pointsChartHtml(entries, { label: `${categoryName(account)}-Punkteverlauf` })}
    ${filtered.length ? rowsHtml([...filtered].reverse()) : emptyStateHtml(needle ? 'Keine Buchungen gefunden.' : 'Noch keine Buchungen.')}
  </section>`;
}

export function adminCategoryJournalHtml(entries, { account, query, loading, error }) {
  const needle = query.trim().toLocaleLowerCase('de');
  const filtered = (entries ?? []).filter((entry) => (!account || entry.account === account)
    && `${entry.playerName} ${entry.title} ${entry.reason ?? ''}`.toLocaleLowerCase('de').includes(needle));
  return `<section class="card stack" aria-label="Kategorie-Journal"><div class="row-between points-actions"><h2>Kategorie-Journal</h2>
    <button type="button" class="btn btn-sm" data-category-admin-refresh${loading ? ' disabled' : ''}>Aktualisieren</button></div>
    <div class="points-filters"><label class="stack"><span class="field-label">Konto</span><select name="adminCategoryAccount" data-admin-category-account>${categoryOptions(account, true)}</select></label>
      <label class="stack"><span class="field-label">Teilnehmer oder Buchung suchen</span><input type="search" name="adminCategoryQuery" data-admin-category-query value="${e(query)}" placeholder="Teilnehmer oder Vorgang suchen"></label></div>
    ${entries ? (filtered.length ? rowsHtml(filtered, true) : emptyStateHtml(needle || account ? 'Keine Buchungen gefunden.' : 'Noch keine Buchungen.')) : emptyStateHtml(error || 'Journal wird geladen…')}
  </section>`;
}

export function categoryEntryFactsHtml(entry) {
  return `<dl class="checklist-detail-facts">
    ${entry.playerName ? `<dt>Teilnehmer</dt><dd>${e(entry.playerName)}</dd>` : ''}
    <dt>Kategorie</dt><dd>${e(categoryName(entry.account))}</dd><dt>Anlass</dt><dd>${e(entry.title)}</dd>
    <dt>Zeitpunkt</dt><dd>${e(formatDateTime(entry.createdAt ?? entry.created_at))}</dd>
    <dt>Betrag</dt><dd>${e(signedPoints(entry.amount))} P.</dd>
    ${entry.reason ? `<dt>Begründung</dt><dd>${e(entry.reason)}</dd>` : ''}
    ${entry.actorName ? `<dt>Korrigiert durch</dt><dd>${e(entry.actorName)}</dd>` : ''}
  </dl>`;
}
