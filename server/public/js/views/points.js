import { apiFetch } from '../api.js';
import { state } from '../state.js';
import { getMyId } from '../whoami.js';
import { isGroupAdmin } from '../groupContext.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { emptyStateHtml } from '../emptyState.js';
import { rankedListHtml, sharedRankNumbers } from '../rankedList.js';
import { POINT_SOURCES, signedPoints, pointsSectionHtml, journalSourceState, categoryPlaceSummary } from '../pointsPresentation.js';
import { categoryPointsHtml, pointsHistoryHtml, adminCategoryJournalHtml, categoryEntryFactsHtml } from '../pointsCategories.js';
import { pointsReportButton, wirePointsReportButtons } from '../pointsReports.js';
import { actionMenuHtml, wireActionMenus } from '../actionMenu.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';

let cached = null;
let stale = true;
let cacheKey = '';
let pendingKey = '';
let generation = 0;
let loadError = '';
let historySource = '';
let adminEntries = null;
let adminLoading = false;
let adminError = '';
let categoryAccount = 'orga';
let categoryQuery = '';
let adminCategoryAccount = '';
let adminCategoryQuery = '';
let adminCategoryEntries = null;
let adminCategoryLoading = false;
let adminCategoryError = '';
const participantDialogs = new Map();
const adminCategoryDialogs = new Map();
export function openPointsModal(title, body, options = {}) {
  const dialog = openModal(title, body, { ...options, onClose() {
    participantDialogs.delete(dialog.close);
    options.onClose?.();
  } });
  participantDialogs.set(dialog.close, state.activeEvent?.id);
  return dialog;
}
export function syncPointsDialogVisibility() {
  for (const [close, eventId] of participantDialogs) {
    if (eventId !== state.activeEvent?.id || !state.activeEvent?.pointsEnabled) close();
  }
  for (const [close, key] of adminCategoryDialogs) {
    if (key !== scopeKey() || !isGroupAdmin()) close();
  }
}
const statusLabels = {
  open: 'Tipps offen',
  locked: 'Tipps geschlossen',
  settled: 'Abgerechnet',
  refunded: 'Erstattet',
};
const e = escapeHtml;

function scopeKey() {
  return `${state.activeEvent?.id ?? ''}:${getMyId() ?? ''}`;
}
export function invalidatePoints() {
  generation++;
  stale = true;
  pendingKey = '';
  loadError = '';
  adminEntries = null;
  adminLoading = false;
  adminError = '';
  adminCategoryEntries = null;
  adminCategoryLoading = false;
  adminCategoryError = '';
}
export function pointsRequest(path = '', options = {}, eventId = state.activeEvent?.id) {
  return apiFetch(`/api/points${path}?eventId=${encodeURIComponent(eventId)}`, options);
}
export function ensurePoints(ctx) {
  if (state.activeEvent?.eventType !== 'lan') return;
  if (!state.activeEvent?.pointsEnabled && !isGroupAdmin()) return;
  const key = scopeKey();
  if (cacheKey !== key) {
    invalidatePoints();
    cached = null;
    cacheKey = key;
  }
  if ((cached && !stale) || pendingKey === key || loadError) return;
  pendingKey = key;
  const requestGeneration = generation;
  pointsRequest()
    .then((data) => {
      if (requestGeneration === generation && key === scopeKey()) { cached = data; stale = false; }
    })
    .catch((error) => {
      if (requestGeneration === generation && key === scopeKey()) loadError = error.message;
    })
    .finally(() => {
      if (requestGeneration !== generation || key !== scopeKey()) return;
      pendingKey = '';
      ctx.rerender();
    });
}
function currentData() {
  return cacheKey === scopeKey() ? cached : null;
}
export function currentPointStandings() {
  if (!state.activeEvent?.pointsEnabled) return null;
  return currentData()?.settings ? currentData().standings : null;
}
export function pointsRankingHtml(ctx, { filter = '', addMatch = '' } = {}) {
  if (state.selectedGameId) return '';
  ensurePoints(ctx);
  const standings = currentPointStandings();
  if (!standings) return '';
  const ranks = sharedRankNumbers(standings.map((p) => p.points));
  return `<section class="card stack"><div class="grouped-page-section-title"><h2>LAN-Punkte</h2>${addMatch}</div>
    ${filter}
    <div><button type="button" class="btn btn-sm" data-navigate="points">Punktekonto & Verlauf</button></div>
    ${rankedListHtml(
      standings.map((p, i) => ({ rank: p.rank ?? ranks[i], title: e(p.name), meta: e(categoryPlaceSummary(p.categories)), value: `${p.points} P.` })),
      { ranked: true, label: 'LAN-Punkte' },
    )}</section>`;
}
function refreshPoints(ctx) {
  invalidatePoints();
  ensurePoints(ctx);
  ctx.rerender();
}
function json(method, body) {
  return { method, body: JSON.stringify(body) };
}
async function perform(button, action, done) {
  button.disabled = true;
  try {
    await action();
    done?.();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    button.disabled = false;
  }
}
function numberField(name, label, value, min, max, disabled = false) {
  return `<label class="stack"><span class="field-label is-required">${label}</span><input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="1" required ${disabled ? 'disabled' : ''}></label>`;
}
function kpi(value, label) {
  return `<div class="my-stats-kpi"><span class="my-stats-kpi-value">${e(value)}</span><span class="my-stats-kpi-label">${label}</span></div>`;
}
function overviewHtml(data) {
  return pointsSectionHtml('wallet', 'Wettguthaben', `
    ${data.settings.prize_info ? `<span>${e(data.settings.prize_info)}</span>` : ''}
    ${data.wallet.available < 0 ? '<p role="status">Neue Einsätze sind erst wieder mit ausreichendem Guthaben möglich.</p>' : ''}`, {
    label: 'Mein Punktekonto',
    metaHtml: `${data.settings.closed_at ? '<span>Endstand</span> · ' : ''}<span data-wallet-total>${data.wallet.total}</span> P. gesamt · <span data-wallet-available>${data.wallet.available}</span> P. frei${data.wallet.held ? ` · <span data-wallet-held>${data.wallet.held}</span> P. reserviert` : ''}`,
  });
}

export function pointsHomeHtml(ctx) {
  if (!state.activeEvent?.pointsEnabled) return '';
  ensurePoints(ctx);
  const data = currentData();
  if (!data?.settings) return '';
  const open = data.rounds.filter((r) => r.status === 'open');
  return `<section class="card stack" aria-label="Meine LAN-Punkte"><div class="row-between"><h2>Meine LAN-Punkte</h2><button type="button" class="btn btn-sm" data-navigate="points">Punktekonto öffnen</button></div>
    <div class="my-stats-kpis">${kpi(data.wallet.total, 'Wettguthaben')}${kpi(Math.max(0, data.wallet.available), 'Verfügbar')}${kpi(open.length, 'Offene Tipprunden')}</div>
    <p class="muted">${data.settings.closed_at ? 'Die Endwertung steht fest.' : 'Orga- und Spielpunkte sammeln und mit separatem Wettguthaben tippen.'}</p></section>`;
}

function bettingRound(type, id) {
  if (!state.activeEvent?.pointsEnabled) return null;
  return currentData()?.rounds.find((round) => round.sourceType === type && round.sourceId === id) ?? null;
}

function bettingControlsHtml(round, { actionsOnly = false, showStatus = true } = {}) {
  const closed = Boolean(currentData()?.settings.closed_at);
  const canManage = isGroupAdmin() || round.outcomes.some((outcome) => outcome.playerIds.includes(getMyId()));
  const actions = [
    `<button type="button" class="btn btn-sm" data-tip-round="${e(round.id)}">${round.status === 'open' && !closed ? (round.mine ? 'Tipp ändern' : 'Jetzt tippen') : 'Tippdetails'}</button>`,
    !closed && canManage && round.status === 'open' ? `<button type="button" class="btn btn-sm" data-lock-round="${e(round.id)}">Tipps schließen</button>` : '',
    !closed && canManage && round.status === 'locked' && round.revision === 0 && round.settledAt === null ? `<button type="button" class="btn btn-sm" data-reopen-round="${e(round.id)}">Tipps wieder öffnen</button>` : '',
    !closed && isGroupAdmin() && ['open', 'locked', 'settled'].includes(round.status) ? `<button type="button" class="btn btn-sm" data-refund-round="${e(round.id)}">${round.status === 'settled' ? 'Abrechnung stornieren' : 'Runde erstatten'}</button>` : '',
    pointsReportButton('betting_round', round.id, ['settled', 'refunded'].includes(round.status)),
  ];
  const info = [showStatus ? statusLabels[round.status] : '', round.pot ? `Topf ${round.pot} P.` : '',
    round.mine ? `Dein Tipp ${round.mine.stake} P.${round.mine.payout !== null ? ` · Netto ${signedPoints(round.mine.net)} P.` : ''}` : ''].filter(Boolean).join(' · ');
  return `<div class="points-betting-controls" data-betting-controls="${e(round.id)}">${actionsOnly ? '' : `<span class="muted">${info}</span>`}
    ${actionMenuHtml(actions, `Wetten: ${round.title}`, { key: `betting-${round.id}`, summary: 'Wetten', floating: true })}</div>`;
}

function roundOutcomesHtml(round) {
  return rankedListHtml(round.outcomes.map((outcome) => ({
    title: e(outcome.label), sortKey: outcome.label,
    meta: [round.result === outcome.id ? 'Gewinner' : '', round.mine?.outcomeId === outcome.id ? 'Dein Tipp' : ''].filter(Boolean).join(' · '),
    value: `${outcome.stake} P.`,
  })), { label: 'Einsätze nach Ergebnis' });
}

function roundHtml(round, selected = false) {
  const type = { draw: 'Match', tournament_match: 'Turnierspiel', tournament: 'Turniersieg' }[round.sourceType];
  return pointsSectionHtml(`round-${round.id}`, round.title,
    `${bettingControlsHtml(round, { showStatus: false })}${roundOutcomesHtml(round)}`, {
      flat: true, open: selected,
      meta: [type, statusLabels[round.status]].filter(Boolean).join(' · '),
    });
}

export function competitionBettingHtml(type, id, ctx, options = {}) {
  ensurePoints(ctx);
  const round = bettingRound(type, id);
  return round ? bettingControlsHtml(round, options) : '';
}

function openTip(round, ctx) {
  const data = currentData();
  const editable = round.status === 'open' && !data.settings.closed_at;
  const reportAction = pointsReportButton('tip', round.mine?.id, ['settled', 'refunded'].includes(round.status));
  const tipRules = `${round.payoutPolicy === 'stake_cap_v1' ? 'Gewinn höchstens in Höhe deines Einsatzes; übrige Einsätze gehen anteilig zurück. ' : ''}Tipps auf das eigene Team sind erlaubt. Auszahlung inklusive Einsatz; Rundung auf ganze Punkte.`;
  const { close } = openPointsModal(
    editable ? 'Ergebnis tippen' : 'Dein Tipp',
    `<div class="stack"><form class="stack" data-tip-form>
    ${
      editable
        ? `<label class="stack"><span class="field-label">Ergebnis</span><select name="outcomeId" required>${round.outcomes.map((o) => `<option value="${e(o.id)}" ${round.mine?.outcomeId === o.id ? 'selected' : ''}>${e(o.label)}</option>`).join('')}</select></label>
    ${numberField('stake', `Einsatz (max. ${data.settings.max_stake} P.)`, round.mine?.stake ?? 1, 1, data.settings.max_stake)}
    <div class="row"><span class="muted">${data.wallet.available + (round.mine?.stake ?? 0)} P. verfügbar</span>${infoTooltipHtml('tip-rules', 'Hinweise zum Tipp', tipRules)}</div>
    <div class="row points-actions" style="justify-content:flex-end">${round.mine ? '<button type="button" class="btn" data-remove-tip>Tipp zurücknehmen</button>' : ''}<button type="submit" class="btn btn-primary">Tipp speichern</button></div>`
        : `${round.mine ? `<div><strong>Dein Tipp:</strong> ${e(round.outcomes.find((o) => o.id === round.mine.outcomeId)?.label ?? 'Unbekannter Ausgang')}</div>` : ''}
    <div>${round.mine ? `Einsatz ${round.mine.stake} P. · ${round.mine.payout === null ? 'Auszahlung steht noch aus' : `Auszahlung ${round.mine.payout} P. · Netto ${signedPoints(round.mine.net)} P.`}` : 'Du hast in dieser Runde keinen Tipp abgegeben.'}</div>
    ${roundOutcomesHtml(round)}
    `
    }
    </form>${reportAction ? `<div class="row points-actions">${reportAction}</div>` : ''}</div>`,
    {
      onMount(el) {
        wirePointsReportButtons(el);
        wireInfoTooltips(el);
        el.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          perform(
            form.querySelector('[type="submit"]'),
            () =>
              pointsRequest(
                `/rounds/${encodeURIComponent(round.id)}/tip`,
                json('PUT', { outcomeId: values.get('outcomeId'), stake: Number(values.get('stake')) }),
                data.eventId,
              ),
            () => {
              close();
              refreshPoints(ctx);
            },
          );
        });
        el.querySelector('[data-remove-tip]')?.addEventListener('click', (event) =>
          perform(
            event.currentTarget,
            () => pointsRequest(`/rounds/${encodeURIComponent(round.id)}/tip`, { method: 'DELETE' }, data.eventId),
            () => {
              close();
              refreshPoints(ctx);
            },
          ),
        );
      },
    },
  );
}

function reasonDialog(title, action, ctx) {
  const eventId = state.activeEvent.id;
  const { close } = openModal(
    title,
    `<form class="stack"><label class="stack"><span class="field-label">Begründung</span><textarea name="reason" maxlength="300" required></textarea></label><button type="submit" class="btn btn-primary">${e(title)}</button></form>`,
    {
      onMount(el) {
        el.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const reason = String(new FormData(form).get('reason')).trim();
          if (!reason) return;
          perform(
            form.querySelector('button'),
            () => action(reason, eventId),
            () => {
              close();
              refreshPoints(ctx);
            },
          );
        });
      },
    },
  );
}

export function wireCompetitionBetting(container, ctx) {
  wirePointsReportButtons(container);
  wireActionMenus(container.closest('#view-container') ?? container);
  container.querySelectorAll('[data-tip-round]').forEach((button) =>
    button.addEventListener('click', () => {
      const round = currentData()?.rounds.find((r) => r.id === button.dataset.tipRound);
      if (round) openTip(round, ctx);
    }),
  );
  container.querySelectorAll('[data-lock-round]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (
        !(await confirmDialog('Tippabgabe schließen?', {
          confirmText: 'Tipps schließen',
        }))
      )
        return;
      perform(
        button,
        () => pointsRequest(`/rounds/${encodeURIComponent(button.dataset.lockRound)}/lock`, json('POST', {})),
        () => refreshPoints(ctx),
      );
    }),
  );
  container.querySelectorAll('[data-reopen-round]').forEach((button) =>
    button.addEventListener('click', () => perform(button,
      () => pointsRequest(`/rounds/${encodeURIComponent(button.dataset.reopenRound)}/reopen`, json('POST', {})),
      () => refreshPoints(ctx))),
  );
  container.querySelectorAll('[data-refund-round]').forEach((button) =>
    button.addEventListener('click', () => {
      const round = currentData()?.rounds.find((r) => r.id === button.dataset.refundRound);
      if (!round) return;
      reasonDialog(
        round.status === 'settled' ? 'Abrechnung stornieren' : 'Runde erstatten',
        (reason, eventId) =>
          pointsRequest(
            `/rounds/${encodeURIComponent(round.id)}/${round.status === 'settled' ? 'void' : 'refund'}`,
            json('POST', { reason, revision: round.revision }),
            eventId,
          ),
        ctx,
      );
    }),
  );
}

export function competitionCorrection(type, sourceId, fixtureIds = []) {
  const rounds = (currentData()?.rounds ?? []).filter(
    (r) =>
      r.status === 'settled' &&
      ((r.sourceType === type && r.sourceId === sourceId) ||
        (type === 'tournament' && r.sourceType === 'tournament_match' && fixtureIds.includes(r.sourceId))),
  );
  return {
    html: !rounds.length
      ? ''
      : `<div class="stack">${isGroupAdmin() ? '<label class="stack"><span class="field-label">Begründung der Ergebniskorrektur</span><textarea data-betting-correction-reason maxlength="300" required></textarea></label>' : '<p>Diese Korrektur kann nur ein Admin durchführen.</p>'}</div>`,
    payload(el) {
      if (!rounds.length) return {};
      if (!isGroupAdmin()) throw new Error('Nur ein Admin kann bereits abgerechnete Ergebnisse korrigieren.');
      const reason = el.querySelector('[data-betting-correction-reason]')?.value.trim();
      if (!reason) throw new Error('Bitte die Ergebniskorrektur begründen.');
      return { bettingCorrection: { reason, revisions: rounds.map((r) => ({ id: r.id, revision: r.revision })) } };
    },
  };
}

function entryDetails(entry, allEntries) {
  let details = {};
  try {
    details = JSON.parse(entry.details);
  } catch {
    /* Legacy entries may carry no details. */
  }
  const original = allEntries.find((r) => r.id === entry.original_id);
  (state.activeEvent?.pointsEnabled ? openPointsModal : openModal)(
    'Punktebuchung',
    `<dl class="checklist-detail-facts">
    <dt>Buchung</dt><dd>${e(entry.title)}</dd><dt>Zeitpunkt</dt><dd>${e(formatDateTime(entry.created_at))}</dd>
    <dt>Art</dt><dd>${e(POINT_SOURCES[entry.source] ?? entry.source)}</dd><dt>Punkte</dt><dd>${signedPoints(entry.amount)} P.</dd>
    <dt>Ausgelöst durch</dt><dd>${e(entry.actorName ?? 'Automatische Buchung')}</dd>
    ${details.stake !== undefined ? `<dt>Einsatz</dt><dd>${details.stake} P.</dd><dt>Auszahlung</dt><dd>${details.payout} P.</dd>` : ''}
    ${details.reason ? `<dt>Begründung</dt><dd>${e(details.reason)}</dd>` : ''}
    ${original ? `<dt>Originalbuchung</dt><dd>${e(original.title)} · ${signedPoints(original.amount)} P. · ${e(formatDateTime(original.created_at))}</dd>` : ''}
    <dt>Buchungs-ID</dt><dd>${e(entry.id)}</dd></dl>${pointsReportButton('journal', entry.id)}`,
    { onMount: wirePointsReportButtons },
  );
}

function savedStandingsHtml(data) {
  if (!data.revisions?.length) return '';
  return `<section class="card stack"><h2>Gespeicherte Endstände</h2><div class="stack">
    <label class="stack"><span class="field-label">Endstand auswählen</span><select data-points-revision>${data.revisions.map((r) => `<option value="${r.revision}">Version ${r.revision} · ${e(formatDateTime(r.createdAt))}</option>`).join('')}</select></label>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-sm" data-download-points-revision>Endstand herunterladen</button></div></div></section>`;
}
function wireSavedStandings(container) {
  const eventId = state.activeEvent?.id;
  const key = scopeKey();
  container.querySelector('[data-download-points-revision]')?.addEventListener('click', (event) => {
    const revision = container.querySelector('[data-points-revision]').value;
    perform(event.currentTarget, async () => {
      const snapshot = await pointsRequest(`/snapshots/${encodeURIComponent(revision)}`, {}, eventId);
      if (key !== scopeKey()) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `lan-punkte-${eventId}-v${revision}.json`;
      link.click(); URL.revokeObjectURL(url);
    });
  });
}

export function renderPoints(container, ctx) {
  if (!state.activeEvent?.pointsEnabled) {
    container.innerHTML = emptyStateHtml('LAN-Punkte sind für dieses Event ausgeblendet.');
    return;
  }
  ensurePoints(ctx);
  const data = currentData();
  const header = `<div class="row-between page-title-row points-actions"><h1 class="view-title">Meine LAN-Punkte</h1><div class="row points-actions"><button type="button" class="btn btn-sm" data-points-reports>Meldungen</button>${isGroupAdmin() ? '<button type="button" class="btn btn-sm" data-navigate="pointsAdmin">Punkte verwalten</button>' : ''}</div></div>`;
  if (!data?.settings) {
    container.innerHTML = `${header}${emptyStateHtml(loadError || (data ? 'Für diese LAN ist noch keine Punktewertung aktiviert.' : state.activeEvent?.eventType === 'lan' ? 'Punktekonto wird geladen…' : 'Wähle ein LAN-Event.'))}${loadError ? '<button type="button" class="btn" data-points-retry>Erneut laden</button>' : ''}`;
    wirePointsReportButtons(container);
    container.querySelector('[data-points-retry]')?.addEventListener('click', () => refreshPoints(ctx));
    return;
  }
  const selected = ctx.localRoute?.()?.kind === 'round' ? ctx.localRoute().id : null;
  const rounds = selected ? data.rounds.filter((r) => r.id === selected) : data.rounds;
  container.innerHTML = `${header}${loadError ? `<div class="row points-actions" role="status">${e(loadError)}<button type="button" class="btn btn-sm" data-points-retry>Erneut laden</button></div>` : ''}<div class="grouped-page-sections">${categoryPointsHtml(data)}${overviewHtml(data)}
    ${pointsSectionHtml('rounds', selected ? 'Tipprunde' : 'Spiele & Turniere', `
      ${selected ? '<div><button type="button" class="btn btn-sm" data-all-rounds>Alle Runden</button></div>' : ''}
      ${rounds.length ? rounds.map((r) => roundHtml(r, Boolean(selected))).join('') : emptyStateHtml('Keine Tipprunden.')}`, { open: true, label: 'Tipprunden', meta: String(rounds.length) })}
    ${pointsHistoryHtml(data, { account: categoryAccount, query: categoryQuery, source: historySource })}${savedStandingsHtml(data)}</div>`;
  wireCompetitionBetting(container, ctx);
  container.querySelector('[data-points-retry]')?.addEventListener('click', () => refreshPoints(ctx));
  wireSavedStandings(container);
  container.querySelector('[data-category-account]').addEventListener('change', (event) => {
    categoryAccount = event.target.value;
    ctx.rerender();
  });
  container.querySelector('[data-category-query]').addEventListener('change', (event) => {
    categoryQuery = event.target.value;
    ctx.rerender();
  });
  container.querySelectorAll('[data-category-entry]').forEach((button) => button.addEventListener('click', () => {
    const entry = data.categoryJournal.find((row) => row.id === button.dataset.categoryEntry);
    if (entry) openPointsModal('Kategorie-Buchung', `${categoryEntryFactsHtml(entry)}${pointsReportButton('journal', entry.id)}`, { onMount: wirePointsReportButtons });
  }));
  container.querySelector('[data-all-rounds]')?.addEventListener('click', () => ctx.navigateLocal(null));
  container.querySelector('[data-points-source]')?.addEventListener('change', (event) => {
    historySource = event.target.value;
    ctx.rerender();
  });
  container.querySelectorAll('[data-point-entry]').forEach((button) =>
    button.addEventListener('click', () =>
      entryDetails(
        data.entries.find((r) => r.id === button.dataset.pointEntry),
        data.entries,
      ),
    ),
  );
}

function loadAdminCategories(ctx) {
  if (adminCategoryEntries || adminCategoryLoading || adminCategoryError) return;
  adminCategoryLoading = true;
  const key = scopeKey();
  const requestGeneration = generation;
  pointsRequest('/admin/journal')
    .then((result) => {
      if (isGroupAdmin() && key === scopeKey() && requestGeneration === generation) adminCategoryEntries = result.entries;
    })
    .catch((error) => {
      if (key === scopeKey() && requestGeneration === generation) adminCategoryError = error.message;
    })
    .finally(() => {
      if (key !== scopeKey() || requestGeneration !== generation) return;
      adminCategoryLoading = false;
      ctx.rerender();
    });
}

function openAdminCategoryEntry(entry, data, ctx) {
  const eventId = data.eventId;
  const key = scopeKey();
  const current = journalSourceState(adminCategoryEntries, entry.source_id);
  const editable = !data.settings?.closed_at && ['orga', 'playing'].includes(entry.account);
  const dialog = openModal('Kategorie-Buchung verwalten', `${categoryEntryFactsHtml(entry)}${pointsReportButton('journal', entry.id)}
    <p>Aktueller Gesamtanspruch für diesen Vorgang: <strong>${e(current.total)} P.</strong></p>
    ${editable ? `<form class="stack" data-category-correction>
      ${numberField('total', 'Neuer Gesamtanspruch', current.total, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)}
      <label class="stack"><span class="field-label is-required">Begründung</span><textarea name="reason" maxlength="500" required></textarea></label>
      <p class="muted">Die Korrektur wird nachvollziehbar gebucht. Mit 0 entziehst du den gesamten Anspruch.</p>
      <div class="row" style="justify-content:flex-end;"><button type="submit" class="btn btn-primary btn-sm">Korrektur speichern</button></div>
    </form>` : data.settings?.closed_at ? '<p class="muted">Die Punktewertung ist abgeschlossen.</p>' : ''}`, {
    onClose() { adminCategoryDialogs.delete(dialog.close); },
    onMount(el) {
      wirePointsReportButtons(el);
      el.querySelector('[data-category-correction]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        perform(form.querySelector('[type="submit"]'), async () => {
          if (key !== scopeKey() || !isGroupAdmin()) throw new Error('Der Event- oder Kontokontext hat sich geändert.');
          try {
            await pointsRequest(`/admin/journal/${encodeURIComponent(entry.id)}/correct`, json('POST', {
              total: Number(values.get('total')), revision: current.revision, reason: String(values.get('reason')).trim(),
            }), eventId);
          } catch (error) {
            if (error.status === 409) { dialog.close(); refreshPoints(ctx); }
            throw error;
          }
        }, () => { dialog.close(); refreshPoints(ctx); });
      });
    },
  });
  adminCategoryDialogs.set(dialog.close, key);
}

function loadAdmin(ctx) {
  if (adminEntries || adminLoading || adminError) return;
  adminLoading = true;
  const key = scopeKey();
  const requestGeneration = generation;
  pointsRequest('/admin/entries')
    .then((result) => {
      if (key === scopeKey() && requestGeneration === generation) adminEntries = result.entries;
    })
    .catch((error) => {
      if (key === scopeKey() && requestGeneration === generation) adminError = error.message;
    })
    .finally(() => {
      if (key !== scopeKey() || requestGeneration !== generation) return;
      adminLoading = false;
      ctx.rerender();
    });
}
export function renderPointsAdmin(container, ctx) {
  if (!isGroupAdmin()) {
    container.innerHTML = emptyStateHtml('Nur Admins können Punkte verwalten.');
    return;
  }
  if (state.activeEvent?.eventType !== 'lan') {
    container.innerHTML = emptyStateHtml('Wähle ein LAN-Event.');
    return;
  }
  ensurePoints(ctx);
  const data = currentData();
  if (!data) {
    container.innerHTML = `<h1 class="view-title">LAN-Punkte verwalten</h1>${emptyStateHtml(loadError || 'Punkteverwaltung wird geladen…')}${loadError ? '<button type="button" class="btn" data-points-retry>Erneut laden</button>' : ''}`;
    container.querySelector('[data-points-retry]')?.addEventListener('click', () => refreshPoints(ctx));
    return;
  }
  loadAdmin(ctx);
  loadAdminCategories(ctx);
  const s = data.settings;
  const closed = Boolean(s?.closed_at);
  container.innerHTML = `<div class="row-between page-title-row points-actions"><h1 class="view-title">LAN-Punkte verwalten</h1><div class="row points-actions"><button type="button" class="btn btn-sm" data-points-reports>Meldungen</button>${state.activeEvent?.pointsEnabled ? '<button type="button" class="btn btn-sm" data-navigate="points">Mein Punktekonto</button>' : ''}</div></div>
    <div class="grouped-page-sections">
    ${savedStandingsHtml(data)}${adminCategoryJournalHtml(adminCategoryEntries, { account: adminCategoryAccount, query: adminCategoryQuery, loading: adminCategoryLoading, error: adminCategoryError })}<section class="card stack"><h2>${s ? 'Wettregeln' : 'Punktewertung aktivieren'}</h2>

    <form class="stack" data-points-settings>
      <label class="stack"><span class="field-label">Preis & Vergabe bei Gleichstand</span><textarea name="prizeInfo" maxlength="300" ${closed ? 'disabled' : ''}>${e(s?.prize_info ?? '')}</textarea></label>

      <p class="muted">100 Startpunkte · Max. 20 P. je Wette · Wettplatz ab 2 Abrechnungen mit positivem Netto</p>
      ${closed ? '' : `<div class="row" style="justify-content:flex-end"><button type="submit" class="btn btn-primary">${s ? 'Regeln speichern' : 'Punktewertung aktivieren'}</button></div>`}
    </form>
    ${s ? `<div class="row points-actions"><button type="button" class="btn btn-sm" data-points-close>${closed ? 'Wertung wieder öffnen' : 'LAN-Endwertung festschreiben'}</button></div>` : ''}
    </section>
    ${s ? `<section class="card stack"><h2>Wettguthaben aller Teilnehmer</h2>${adminEntries ? `<label class="stack"><span class="field-label">Teilnehmer oder Buchung suchen</span><input type="search" data-admin-entry-query></label><ol class="points-journal">${adminEntries.map((entry) => `<li data-admin-entry-text="${e(`${entry.playerName} ${entry.title}`.toLocaleLowerCase('de'))}"><div><strong>${e(entry.playerName)}</strong><div>${e(entry.title)} · ${signedPoints(entry.amount)} P.</div><div class="muted">${e(formatDateTime(entry.created_at))}</div></div><button type="button" class="btn btn-sm" data-admin-entry-details="${e(entry.id)}">Details</button></li>`).join('')}</ol>` : emptyStateHtml(adminError || 'Buchungen werden geladen…')}</section>` : ''}
    </div>`;
  wirePointsReportButtons(container);
  wireSavedStandings(container);
  container.querySelector('[data-category-admin-refresh]').addEventListener('click', () => refreshPoints(ctx));
  container.querySelector('[data-admin-category-account]').addEventListener('change', (event) => {
    adminCategoryAccount = event.target.value;
    ctx.rerender();
  });
  container.querySelector('[data-admin-category-query]').addEventListener('change', (event) => {
    adminCategoryQuery = event.target.value;
    ctx.rerender();
  });
  container.querySelectorAll('[data-admin-category-entry]').forEach((button) => button.addEventListener('click', () => {
    const entry = adminCategoryEntries.find((row) => row.id === button.dataset.adminCategoryEntry);
    if (entry) openAdminCategoryEntry(entry, data, ctx);
  }));
  container.querySelector('[data-points-settings]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = {
      initialPoints: 100,
      prizeInfo: values.get('prizeInfo'),
    };
    perform(
      form.querySelector('[type="submit"]'),
      () => pointsRequest('/settings', json('PUT', body)),
      () => refreshPoints(ctx),
    );
  });
  container.querySelector('[data-points-close]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (closed)
      return reasonDialog(
        'Wertung wieder öffnen',
        (reason, eventId) => pointsRequest('/reopen', json('POST', { reason }), eventId),
        ctx,
      );
    if (
      !(await confirmDialog(
        'LAN-Endwertung festschreiben? Offene Punktefehler-Meldungen müssen zuerst abgeschlossen sein. Alle noch nicht abgerechneten Wetten werden vollständig erstattet. Danach sind Punkteänderungen gesperrt.',
        { confirmText: 'Endwertung festschreiben' },
      ))
    )
      return;
    perform(
      button,
      () => pointsRequest('/close', json('POST', {})),
      () => refreshPoints(ctx),
    );
  });
  container.querySelector('[data-admin-entry-query]')?.addEventListener('input', (event) => {
    const query = event.target.value.toLocaleLowerCase('de');
    container.querySelectorAll('[data-admin-entry-text]').forEach((row) => {
      row.hidden = !row.dataset.adminEntryText.includes(query);
    });
  });
  container.querySelectorAll('[data-admin-entry-details]').forEach((button) =>
    button.addEventListener('click', () =>
      entryDetails(
        adminEntries.find((r) => r.id === button.dataset.adminEntryDetails),
        adminEntries,
      ),
    ),
  );

}
