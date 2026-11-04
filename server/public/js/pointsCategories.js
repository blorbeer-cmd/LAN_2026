import { escapeHtml, formatDateTime } from './format.js';
import { emptyStateHtml } from './emptyState.js';
import { rankedListHtml } from './rankedList.js';
import { POINT_CATEGORIES, POINT_SOURCES, pointsChartHtml, pointsSectionHtml, signedPoints } from './pointsPresentation.js';

const e = escapeHtml;
const categoryName = (account) => POINT_CATEGORIES[account] ?? (account === 'wallet' ? 'Wettguthaben' : account);

function categoryOptions(selected, { all = false, wallet = false } = {}) {
  return `${all ? '<option value="">Alle Konten</option>' : ''}${Object.entries({
    ...POINT_CATEGORIES, ...(wallet ? { wallet: 'Wettguthaben' } : {}),
  }).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('')}`;
}

function rowsHtml(entries, admin = false) {
  return `<ol class="points-journal">${entries.map((entry) => `<li>
    <div><strong>${e(admin ? entry.playerName : entry.title)}</strong>${admin ? `<div>${e(entry.title)}</div>` : ''}
      <div class="muted">${e(entry.source ? POINT_SOURCES[entry.source] ?? entry.source : categoryName(entry.account))} · ${e(formatDateTime(entry.createdAt ?? entry.created_at))}</div>
      ${entry.reason ? `<div class="muted">${e(entry.reason)}</div>` : ''}
    </div><strong>${e(signedPoints(entry.amount))} P.</strong>
    <button type="button" class="btn btn-sm" ${admin ? 'data-admin-category-entry' : entry.account === 'wallet' ? 'data-point-entry' : 'data-category-entry'}="${e(entry.id)}" aria-label="Details: ${e(admin ? `${entry.playerName} · ${entry.title}` : entry.title)}">Details</button>
  </li>`).join('')}</ol>`;
}

export function categoryPointsHtml(data) {
  const categories = Object.entries(POINT_CATEGORIES).map(([key, label]) => {
    const score = data.categoryStanding?.categories?.[key];
    const leaders = (data.standings ?? []).filter((row) => row.categories[key].rank !== null)
      .sort((a, b) => a.categories[key].rank - b.categories[key].rank || a.name.localeCompare(b.name, 'de'));
    const ranking = leaders.length ? rankedListHtml(leaders.map((row) => ({
      rank: row.categories[key].rank, title: e(row.name),
      meta: `${e(row.categories[key].raw)} Punkte`, value: `${e(row.categories[key].placePoints)} P.`,
    })), { ranked: true, label: `${label}-Rangliste` }) : emptyStateHtml('Noch keine Platzierung.');
    return pointsSectionHtml(`ranking-${key}`, label, ranking, {
      flat: true,
      metaHtml: `<span data-category-balance="${key}">${e(data.categoryBalances?.[key] ?? 0)}</span> Punkte${score ? ` · <span data-category-score="${key}">${score.rank === null ? 'Kein Platz' : `Platz ${score.rank}`} · ${e(score.placePoints)} Platzpunkte</span>` : ''}`,
      label: `${label}-Rangliste`,
    });
  }).join('');
  const overall = pointsSectionHtml('overall-ranking', data.settings?.closed_at ? 'Gesamt-Endstand' : 'Gesamtwertung',
    rankedListHtml((data.standings ?? []).map((row) => ({ rank: row.rank, title: e(row.name),
      meta: Object.entries(POINT_CATEGORIES).map(([key, label]) => `${label} ${row.categories[key].placePoints}`).join(' · '),
      value: `${e(row.points ?? 0)} P.`,
    })), { ranked: true, label: 'LAN-Rangliste' }), { flat: true, label: 'LAN-Rangliste' });
  const summary = pointsSectionHtml('categories', 'Wertung', `<div class="stack">${categories}${overall}</div>`, {
    open: true, label: 'Meine Kategorien',
    meta: data.categoryStanding ? `Gesamt ${data.categoryStanding.points} P. · Platz ${data.categoryStanding.rank}` : 'Ohne Wertung',
  });
  return summary;
}

export function pointsHistoryHtml(data, { account, query, source = '' }) {
  const wallet = account === 'wallet';
  const entries = wallet ? data.entries.map((entry) => ({ ...entry, account: 'wallet' }))
    : (data.categoryJournal ?? []).filter((entry) => entry.account === account);
  const needle = query.trim().toLocaleLowerCase('de');
  const filtered = entries.filter((entry) => (!wallet || !source || entry.source === source)
    && `${entry.title} ${entry.reason ?? ''} ${entry.source ? POINT_SOURCES[entry.source] ?? '' : ''}`.toLocaleLowerCase('de').includes(needle));
  return pointsSectionHtml('history', 'Punkteverlauf', `
    <div class="points-filters"><label class="stack"><span class="field-label">Konto</span><select name="categoryAccount" data-category-account>${categoryOptions(account, { wallet: true })}</select></label>
      <label class="stack"><span class="field-label">Suche</span><input type="search" name="categoryQuery" data-category-query value="${e(query)}" placeholder="Vorgang suchen"></label></div>
    ${wallet ? `<label class="stack"><span class="field-label">Buchungsart</span><select data-points-source><option value="">Alle Buchungen</option>${Object.entries(POINT_SOURCES).map(([id, label]) => `<option value="${id}"${id === source ? ' selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}
    ${account === 'betting' && data.bettingParticipation && data.categoryStanding?.categories?.betting.rank == null ? `<p class="muted">${e(data.bettingParticipation.settledTips)}/${e(data.bettingParticipation.minimumTips)} abgerechnete Tipps · Für einen Platz ist positiver Nettogewinn nötig.</p>` : ''}
    ${pointsSectionHtml('category-chart', 'Verlauf', pointsChartHtml(entries, { label: wallet ? 'Verfügbares Wettguthaben' : `${categoryName(account)}-Punkteverlauf` }))}
    ${filtered.length ? rowsHtml([...filtered].reverse()) : emptyStateHtml(needle ? 'Keine Buchungen gefunden.' : 'Noch keine Buchungen.')}`);
}

export function adminCategoryJournalHtml(entries, { account, query, loading, error }) {
  const needle = query.trim().toLocaleLowerCase('de');
  const filtered = (entries ?? []).filter((entry) => (!account || entry.account === account)
    && `${entry.playerName} ${entry.title} ${entry.reason ?? ''} ${entry.id ?? ''} ${entry.sourceKey ?? ''}`.toLocaleLowerCase('de').includes(needle));
  return `<section class="card stack" aria-label="Kategorie-Journal"><div class="row-between points-actions"><h2>Kategorie-Journal</h2>
    <button type="button" class="btn btn-sm" data-category-admin-refresh${loading ? ' disabled' : ''}>Aktualisieren</button></div>
    <div class="points-filters"><label class="stack"><span class="field-label">Konto</span><select name="adminCategoryAccount" data-admin-category-account>${categoryOptions(account, { all: true, wallet: true })}</select></label>
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
