import { apiFetch } from '../api.js';
import { state } from '../state.js';
import { getMyId } from '../whoami.js';
import { isGroupAdmin } from '../groupContext.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { emptyStateHtml } from '../emptyState.js';
import { rankedListHtml, sharedRankNumbers } from '../rankedList.js';
import { POINT_SOURCES, signedPoints, pointsChartHtml } from '../pointsPresentation.js';

let cached = null;
let cacheKey = '';
let pendingKey = '';
let generation = 0;
let loadError = '';
let historySource = '';
let historyQuery = '';
let adminEntries = null;
let adminLoading = false;
let adminError = '';
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
  cached = null;
  pendingKey = '';
  loadError = '';
  adminEntries = null;
  adminLoading = false;
  adminError = '';
}
export function pointsRequest(path = '', options = {}, eventId = state.activeEvent?.id) {
  return apiFetch(`/api/points${path}?eventId=${encodeURIComponent(eventId)}`, options);
}
export function ensurePoints(ctx) {
  if (state.activeEvent?.eventType !== 'lan') return;
  const key = scopeKey();
  if (cacheKey !== key) {
    invalidatePoints();
    cacheKey = key;
  }
  if (cached || pendingKey === key || loadError) return;
  pendingKey = key;
  const requestGeneration = generation;
  pointsRequest()
    .then((data) => {
      if (requestGeneration === generation && key === scopeKey()) cached = data;
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
  return currentData()?.settings ? currentData().standings : null;
}
export function pointsRankingHtml(ctx) {
  ensurePoints(ctx);
  const standings = currentPointStandings();
  if (!standings) return '';
  const ranks = sharedRankNumbers(standings.map((p) => p.points));
  return `<section class="card stack"><div class="row-between"><h2>LAN-Punkte</h2><button type="button" class="btn btn-sm" data-navigate="points">Punktekonto & Verlauf</button></div>
    <p class="muted">Wertung dieser LAN aus Orga-Punkten und Sieger-Tipps. Gleiche Punkte teilen sich den Platz.</p>
    ${rankedListHtml(
      standings.map((p, i) => ({ rank: ranks[i], title: e(p.name), value: `${p.points} P.` })),
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
  return `<label class="stack"><span class="field-label">${label}</span><input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="1" required ${disabled ? 'disabled' : ''}></label>`;
}
function kpi(value, label) {
  return `<div class="my-stats-kpi"><span class="my-stats-kpi-value">${e(value)}</span><span class="my-stats-kpi-label">${label}</span></div>`;
}
function overviewHtml(data) {
  return `<section class="card stack" aria-label="Mein Punktekonto">
    <div class="row-between"><h2>Mein Punktekonto</h2><span class="badge">${data.settings.closed_at ? 'Endstand' : 'LAN-Wertung'}</span></div>
    ${data.settings.prize_info ? `<p><strong>Preis &amp; Vergabe:</strong> ${e(data.settings.prize_info)}</p>` : ''}
    <div class="my-stats-kpis">${kpi(data.wallet.total, 'Punkte gesamt')}${kpi(Math.max(0, data.wallet.available), 'Frei verfügbar')}${kpi(data.wallet.held, 'Für Wetten reserviert')}${data.wallet.available < 0 ? kpi(-data.wallet.available, 'Korrekturschuld') : ''}</div>
    ${data.wallet.available < 0 ? '<p role="status">Eine Korrektur hat dein verfügbares Guthaben reduziert. Neue Einsätze sind erst wieder mit ausreichendem Guthaben möglich.</p>' : ''}
    <p class="muted">Punkte gibt es für Orga-Aufgaben und richtige Sieger-Tipps. Ein Sieg im Spiel selbst bringt keine Punkte.</p>
    <div class="row points-actions"><button type="button" class="btn btn-sm" data-navigate="checklist">Mit Orga-Aufgaben Punkte verdienen</button></div>
  </section>`;
}
export function pointsHomeHtml(ctx) {
  ensurePoints(ctx);
  const data = currentData();
  if (!data?.settings) return '';
  const open = data.rounds.filter((r) => r.status === 'open');
  return `<section class="card stack" aria-label="Meine LAN-Punkte"><div class="row-between"><h2>Meine LAN-Punkte</h2><button type="button" class="btn btn-sm" data-navigate="points">Punktekonto öffnen</button></div>
    <div class="my-stats-kpis">${kpi(data.wallet.total, 'Punkte')}${kpi(Math.max(0, data.wallet.available), 'Verfügbar')}${kpi(open.length, 'Offene Tipprunden')}</div>
    <p class="muted">${data.settings.closed_at ? 'Die Endwertung steht fest.' : 'Orga übernehmen, Punkte verdienen und auf Sieger tippen.'}</p></section>`;
}

function roundHtml(round, compact = false) {
  const mine = round.mine;
  const pick = round.outcomes.find((o) => o.id === mine?.outcomeId);
  return `<div class="stack points-round" data-points-round="${e(round.id)}">
    <div class="row-between"><${compact ? 'h3' : 'h2'}>${e(round.title)}</${compact ? 'h3' : 'h2'}><span class="badge">${statusLabels[round.status]}</span></div>
    <p class="muted">${round.status === 'open' ? `Tipps bis ${e(formatDateTime(round.closesAt))} · Einsätze bleiben bis Tippschluss verborgen.` : `Topf: ${round.pot} Punkte · ${round.tipCount} Tipps`}</p>
    ${round.status !== 'open' ? `<ul class="points-outcomes">${round.outcomes.map((o) => `<li><span>${e(o.label)}${round.result === o.id ? ' · Sieger' : ''}</span><span>${o.stake} P.${o.odds ? ` · Quote ${o.odds.toFixed(2)}` : ''}</span></li>`).join('')}</ul>` : ''}
    ${mine ? `<p>Dein Tipp: <strong>${e(pick?.label ?? '')}</strong> · Einsatz ${mine.stake} P.${mine.payout !== null ? ` · Auszahlung ${mine.payout} P. · Netto ${signedPoints(mine.net)} P.` : ' · reserviert'}</p>` : '<p class="muted">Du hast noch keinen Tipp abgegeben.</p>'}
    <div class="row points-actions">
      ${round.status === 'open' && !currentData()?.settings.closed_at ? `<button type="button" class="btn btn-primary btn-sm" data-tip-round="${e(round.id)}">${mine ? 'Tipp ändern' : 'Jetzt tippen'}</button>` : `<button type="button" class="btn btn-sm" data-tip-round="${e(round.id)}">Details</button>`}
      ${round.status === 'open' && (isGroupAdmin() || round.outcomes.some((o) => o.playerIds.includes(getMyId()))) ? `<button type="button" class="btn btn-sm" data-lock-round="${e(round.id)}">Spielstart / Tipps schließen</button>` : ''}
      ${isGroupAdmin() && ['open', 'locked', 'settled'].includes(round.status) && !currentData()?.settings.closed_at ? `<button type="button" class="btn btn-sm" data-refund-round="${e(round.id)}">${round.status === 'settled' ? 'Abrechnung stornieren' : 'Runde erstatten'}</button>` : ''}
    </div>
  </div>`;
}

export function competitionBettingHtml(type, id, ctx, { canOpen = true } = {}) {
  ensurePoints(ctx);
  const data = currentData();
  if (!data?.settings) return '';
  const round = data.rounds.find((r) => r.sourceType === type && r.sourceId === id);
  if (round) return roundHtml(round, true);
  if (!canOpen || !isGroupAdmin() || data.settings.closed_at || data.settings.max_rounds === 0) return '';
  return `<div class="row points-actions"><button type="button" class="btn btn-sm" data-open-betting-type="${type}" data-open-betting-source="${e(id)}">Tipprunde öffnen</button><span class="muted">${data.rounds.length}/${data.settings.max_rounds} offizielle Runden</span></div>`;
}

function openTip(round, ctx) {
  const data = currentData();
  const editable = round.status === 'open' && !data.settings.closed_at;
  const { close } = openModal(
    editable ? 'Sieger tippen' : 'Dein Tipp',
    `<form class="stack" data-tip-form>
    <p>${e(round.title)}</p>
    ${
      editable
        ? `<label class="stack"><span class="field-label">Dein Sieger</span><select name="outcomeId" required>${round.outcomes.map((o) => `<option value="${e(o.id)}" ${round.mine?.outcomeId === o.id ? 'selected' : ''}>${e(o.label)}</option>`).join('')}</select></label>
    ${numberField('stake', `Einsatz · maximal ${data.settings.max_stake} Punkte`, round.mine?.stake ?? 1, 1, data.settings.max_stake)}
    <p class="muted">${data.wallet.available + (round.mine?.stake ?? 0)} Punkte verfügbar für diesen Tipp. Tageslimit: ${data.settings.daily_limit} Punkte (Europe/Berlin). Auch Tipps auf das eigene Team oder den Gegner sind erlaubt. Der Topf wird nur umverteilt.</p>
    <div class="row points-actions">${round.mine ? '<button type="button" class="btn" data-remove-tip>Tipp zurücknehmen</button>' : ''}<button type="submit" class="btn btn-primary">Tipp speichern</button></div>`
        : `<p>${round.mine ? `Einsatz ${round.mine.stake} P. · ${round.mine.payout === null ? 'Auszahlung steht noch aus' : `Auszahlung ${round.mine.payout} P. · Netto ${signedPoints(round.mine.net)} P.`}` : 'Du hast in dieser Runde keinen Tipp abgegeben.'}</p>
    <ul class="points-outcomes">${round.outcomes.map((o) => `<li><span>${e(o.label)}</span><span>${o.stake} P.${o.odds ? ` · Quote ${o.odds.toFixed(2)}` : ''}</span></li>`).join('')}</ul>
    <p class="muted">Auszahlung enthält den Einsatz. Rundungen werden nach dem größten Rest verteilt. Bei ungültigem Topf, Abbruch oder Unentschieden wird erstattet.</p>`
    }
    </form>`,
    {
      onMount(el) {
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

function openRound(type, sourceId, ctx) {
  const eventId = state.activeEvent.id;
  const { close } = openModal(
    'Offizielle Tipprunde öffnen',
    `<form class="stack" data-round-form>
    <p>Alle LAN-Teilnehmer werden benachrichtigt, auch die Mitspieler. Die Runde zählt dauerhaft zum LAN-Kontingent.</p>
    ${numberField('minutes', 'Tippschluss in Minuten', 10, 1, 1440)}
    <p class="muted">Vor Spielbeginn „Spielstart / Tipps schließen“ betätigen. Wird ein Ergebnis vor Tippschluss eingetragen, wird der Topf zur Sicherheit erstattet.</p>
    <button type="submit" class="btn btn-primary">Runde öffnen & benachrichtigen</button></form>`,
    {
      onMount(el) {
        el.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const minutes = Number(new FormData(form).get('minutes'));
          perform(
            form.querySelector('button'),
            () =>
              pointsRequest(
                '/rounds',
                json('POST', { sourceType: type, sourceId, closesAt: Date.now() + minutes * 60000 }),
                eventId,
              ),
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
  container
    .querySelectorAll('[data-open-betting-type]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        openRound(button.dataset.openBettingType, button.dataset.openBettingSource, ctx),
      ),
    );
  container.querySelectorAll('[data-tip-round]').forEach((button) =>
    button.addEventListener('click', () => {
      const round = currentData()?.rounds.find((r) => r.id === button.dataset.tipRound);
      if (round) openTip(round, ctx);
    }),
  );
  container.querySelectorAll('[data-lock-round]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (
        !(await confirmDialog('Tipps jetzt schließen? Danach können die Einsätze nicht mehr geändert werden.', {
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
      : `<div class="stack"><p>Für diesen Wettbewerb wurden Tipps abgerechnet. Betroffene Abrechnungen werden mit dem Ergebnis atomar gegen- und neu gebucht.</p>${isGroupAdmin() ? '<label class="stack"><span class="field-label">Begründung der Ergebniskorrektur</span><textarea data-betting-correction-reason maxlength="300" required></textarea></label>' : '<p>Diese Korrektur kann nur ein Admin durchführen.</p>'}</div>`,
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
  openModal(
    'Punktebuchung',
    `<dl class="checklist-detail-facts">
    <dt>Buchung</dt><dd>${e(entry.title)}</dd><dt>Zeitpunkt</dt><dd>${e(formatDateTime(entry.created_at))}</dd>
    <dt>Art</dt><dd>${e(POINT_SOURCES[entry.source] ?? entry.source)}</dd><dt>Punkte</dt><dd>${signedPoints(entry.amount)} P.</dd>
    <dt>Ausgelöst durch</dt><dd>${e(entry.actorName ?? 'Automatische Buchung')}</dd>
    ${details.stake !== undefined ? `<dt>Einsatz</dt><dd>${details.stake} P.</dd><dt>Auszahlung</dt><dd>${details.payout} P.</dd>` : ''}
    ${details.reason ? `<dt>Begründung</dt><dd>${e(details.reason)}</dd>` : ''}
    ${original ? `<dt>Originalbuchung</dt><dd>${e(original.title)} · ${signedPoints(original.amount)} P. · ${e(formatDateTime(original.created_at))}</dd>` : ''}
    <dt>Buchungs-ID</dt><dd>${e(entry.id)}</dd></dl>`,
  );
}

function historyHtml(data) {
  const entries = data.entries.filter(
    (entry) =>
      (!historySource || entry.source === historySource) &&
      `${entry.title} ${POINT_SOURCES[entry.source] ?? ''}`
        .toLocaleLowerCase('de')
        .includes(historyQuery.toLocaleLowerCase('de')),
  );
  return `<section class="card stack" aria-label="Punkteverlauf"><h2>Punkteverlauf</h2>${pointsChartHtml(data.entries)}
    <div class="points-filters"><label class="stack"><span class="field-label">Buchungen durchsuchen</span><input type="search" data-points-query value="${e(historyQuery)}" placeholder="Aufgabe oder Wette suchen"></label>
    <label class="stack"><span class="field-label">Buchungsart</span><select data-points-source><option value="">Alle Buchungen</option>${Object.entries(
      POINT_SOURCES,
    )
      .map(([id, label]) => `<option value="${id}" ${id === historySource ? 'selected' : ''}>${label}</option>`)
      .join('')}</select></label></div>
    <p class="muted">${entries.length} von ${data.entries.length} Buchungen · neueste zuerst. Die Kurve zeigt immer das vollständige Konto.</p>
    ${
      entries.length
        ? `<ol class="points-journal">${[...entries]
            .reverse()
            .map(
              (entry) =>
                `<li><div><strong>${e(entry.title)}</strong><div class="muted">${e(POINT_SOURCES[entry.source] ?? entry.source)} · ${e(formatDateTime(entry.created_at))}</div></div><strong>${signedPoints(entry.amount)} P.</strong><button type="button" class="btn btn-sm" data-point-entry="${e(entry.id)}" aria-label="Details: ${e(entry.title)}">Details</button></li>`,
            )
            .join('')}</ol>`
        : emptyStateHtml('Keine Buchungen gefunden')
    }
    </section>`;
}

export function renderPoints(container, ctx) {
  ensurePoints(ctx);
  const data = currentData();
  const header = `<div class="row-between page-title-row points-actions"><h1 class="view-title">Meine LAN-Punkte</h1>${isGroupAdmin() ? '<button type="button" class="btn btn-sm" data-navigate="pointsAdmin">Punkte verwalten</button>' : ''}</div>`;
  if (!data?.settings) {
    container.innerHTML = `${header}${emptyStateHtml(loadError || (data ? 'Für diese LAN ist noch keine Punktewertung aktiviert.' : state.activeEvent?.eventType === 'lan' ? 'Punktekonto wird geladen…' : 'Wähle ein LAN-Event.'))}${loadError ? '<button type="button" class="btn" data-points-retry>Erneut laden</button>' : ''}`;
    container.querySelector('[data-points-retry]')?.addEventListener('click', () => refreshPoints(ctx));
    return;
  }
  const ranks = sharedRankNumbers(data.standings.map((p) => p.points));
  const selected = ctx.localRoute?.()?.kind === 'round' ? ctx.localRoute().id : null;
  const rounds = selected ? data.rounds.filter((r) => r.id === selected) : data.rounds;
  container.innerHTML = `${header}<div class="grouped-page-sections">${overviewHtml(data)}
    <section class="card stack" aria-label="Tipprunden"><div class="row-between"><h2>${selected ? 'Tipprunde' : 'Spiele & Turniere tippen'}</h2>${selected ? '<button type="button" class="btn btn-sm" data-all-rounds>Alle Runden</button>' : ''}</div>
      <p class="muted">Max. ${data.settings.max_stake} P. pro Runde · ${data.settings.daily_limit} P. pro Tag · ${data.rounds.length}/${data.settings.max_rounds} offizielle Runden. Auch eigene Spiele und Turniere sind erlaubt.</p>
      ${rounds.length ? rounds.map((r) => roundHtml(r)).join('') : emptyStateHtml(selected ? 'Diese Tipprunde wurde nicht gefunden.' : data.settings.max_rounds === 0 ? 'Diese LAN startet ausschließlich mit Orga-Punkten. Wetten sind deaktiviert.' : 'Noch keine offiziellen Tipprunden. Admins öffnen sie direkt am Match oder Turnier.')}</section>
    ${historyHtml(data)}
    <section class="card stack" aria-label="LAN-Rangliste"><h2>${data.settings.closed_at ? 'Endwertung' : 'LAN-Rangliste'}</h2><p class="muted">Bei gleichem Punktestand wird der Platz geteilt. Spiel-Skill und Siege entscheiden keinen Gleichstand.</p>${rankedListHtml(
      data.standings.map((p, i) => ({
        rank: ranks[i],
        title: e(p.name),
        meta: p.playerId === getMyId() ? 'Du' : '',
        value: `${p.points} P.`,
      })),
      { ranked: true, label: 'LAN-Rangliste' },
    )}</section></div>`;
  wireCompetitionBetting(container, ctx);
  container.querySelector('[data-all-rounds]')?.addEventListener('click', () => ctx.navigateLocal(null));
  container.querySelector('[data-points-source]').addEventListener('change', (event) => {
    historySource = event.target.value;
    ctx.rerender();
  });
  container.querySelector('[data-points-query]').addEventListener('change', (event) => {
    historyQuery = event.target.value;
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
function deductDialog(entry, remaining, ctx) {
  const eventId = state.activeEvent.id;
  const requestId = crypto.randomUUID();
  const { close } = openModal(
    'Punkte entziehen',
    `<form class="stack"><p>${e(entry.playerName)} · ${e(entry.title)} · noch ${remaining} P. entziehbar</p>
    ${numberField('amount', 'Punkte', remaining, 1, remaining)}<label class="stack"><span class="field-label">Begründung</span><textarea name="reason" maxlength="300" required></textarea></label>
    <p class="muted">Der Entzug erscheint als eigene Buchung. Das Orga-Budget wird dadurch nicht erneut aufgefüllt.</p><button type="submit" class="btn btn-primary">Punkte entziehen</button></form>`,
    {
      onMount(el) {
        el.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          perform(
            form.querySelector('button'),
            () =>
              pointsRequest(
                `/entries/${encodeURIComponent(entry.id)}/deduct`,
                json('POST', { amount: Number(values.get('amount')), reason: values.get('reason'), requestId }),
                eventId,
              ),
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
  const s = data.settings;
  const closed = Boolean(s?.closed_at);
  const remaining = (entry) =>
    entry.amount +
    (adminEntries ?? [])
      .filter((r) => r.original_id === entry.id && r.source === 'correction')
      .reduce((sum, r) => sum + r.amount, 0);
  container.innerHTML = `<div class="row-between page-title-row points-actions"><h1 class="view-title">LAN-Punkte verwalten</h1><button type="button" class="btn btn-sm" data-navigate="points">Mein Punktekonto</button></div>
    <div class="grouped-page-sections"><section class="card stack"><h2>${s ? 'Regeln & Budget' : 'Punktewertung aktivieren'}</h2>
    <p>Orga-Aufgaben werden beim Erledigen automatisch gutgeschrieben. Es gibt keinen Freigabeprozess. Spielsiege geben keine Punkte.</p>
    <form class="stack" data-points-settings>
      <label class="stack"><span class="field-label">Preis & Vergabe bei Gleichstand (optional)</span><textarea name="prizeInfo" maxlength="300" ${closed ? 'disabled' : ''}>${e(s?.prize_info ?? '')}</textarea></label>
      <p class="muted">Kündige Preis und Sachpreisvergabe bei gleichem Punktestand vor Beginn an. Die Rangliste teilt gleiche Plätze ohne Skill-Tiebreaker.</p>
      ${numberField('initialPoints', 'Grundstock pro Teilnehmer', s?.initial_points ?? 100, 0, 10000, Boolean(s))}
      ${numberField('orgaBudget', 'Orga-Gesamtbudget', s?.orga_budget ?? 400, 0, 1000000, closed)}
      ${numberField('maxStake', 'Maximaler Einsatz je Runde', s?.max_stake ?? 10, 1, 1000, closed || data.rounds.length > 0)}
      ${numberField('dailyLimit', 'Tageskontingent pro Teilnehmer', s?.daily_limit ?? 30, 1, 10000, closed || data.rounds.length > 0)}
      ${numberField('maxRounds', 'Offizielle Tipprunden insgesamt (0 = nur Orga-Punkte)', s?.max_rounds ?? 6, 0, 100, closed)}
      ${closed ? '' : `<button type="submit" class="btn btn-primary">${s ? 'Regeln speichern' : 'Punktewertung aktivieren'}</button>`}
    </form>
    ${s ? `<div class="my-stats-kpis">${kpi(data.budget.available, 'Budget verfügbar')}${kpi(data.budget.reserved, 'Für Aufgaben gebunden')}${kpi(data.budget.issued, 'Bereits vergeben')}</div><p class="muted">Belohnungen direkt am offenen To-Do festlegen, bevor jemand übernimmt. Tipprunden direkt am Match oder Turnier öffnen.</p><div class="row points-actions"><button type="button" class="btn btn-sm" data-navigate="checklist">Zu den To-Dos</button><button type="button" class="btn btn-sm" data-points-close>${closed ? 'Wertung wieder öffnen' : 'LAN-Endwertung festschreiben'}</button></div>` : ''}
    </section>
    ${s ? `<section class="card stack"><h2>Buchungen aller Teilnehmer</h2><p class="muted">Eine Originalbuchung bleibt erhalten. Jeder Entzug braucht eine Begründung.</p>${adminEntries ? `<label class="stack"><span class="field-label">Teilnehmer oder Buchung suchen</span><input type="search" data-admin-entry-query></label><ol class="points-journal">${adminEntries.map((entry) => `<li data-admin-entry-text="${e(`${entry.playerName} ${entry.title}`.toLocaleLowerCase('de'))}"><div><strong>${e(entry.playerName)}</strong><div>${e(entry.title)} · ${signedPoints(entry.amount)} P.</div><div class="muted">${e(formatDateTime(entry.created_at))}</div></div><button type="button" class="btn btn-sm" data-admin-entry-details="${e(entry.id)}">Details</button>${!closed && entry.amount > 0 && remaining(entry) > 0 ? `<button type="button" class="btn btn-sm" data-deduct-entry="${e(entry.id)}">Entziehen</button>` : '<span class="muted">Journal</span>'}</li>`).join('')}</ol>` : emptyStateHtml(adminError || 'Buchungen werden geladen…')}</section>` : ''}
    </div>`;
  container.querySelector('[data-points-settings]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = {
      initialPoints: s?.initial_points ?? Number(values.get('initialPoints')),
      orgaBudget: Number(values.get('orgaBudget')),
      maxStake: data.rounds.length ? s.max_stake : Number(values.get('maxStake')),
      dailyLimit: data.rounds.length ? s.daily_limit : Number(values.get('dailyLimit')),
      maxRounds: Number(values.get('maxRounds')),
      prizeInfo: values.get('prizeInfo'),
    };
    perform(
      form.querySelector('[type="submit"]'),
      () => pointsRequest('/settings', json('PUT', body)),
      () => refreshPoints(ctx),
    );
  });
  container.querySelector('[data-points-close]')?.addEventListener('click', async (event) => {
    if (closed)
      return reasonDialog(
        'Wertung wieder öffnen',
        (reason, eventId) => pointsRequest('/reopen', json('POST', { reason }), eventId),
        ctx,
      );
    if (
      !(await confirmDialog(
        'LAN-Endwertung festschreiben? Alle Tipprunden müssen abgerechnet oder erstattet sein. Danach sind Punkteänderungen gesperrt.',
        { confirmText: 'Endwertung festschreiben' },
      ))
    )
      return;
    perform(
      event.currentTarget,
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
  container.querySelectorAll('[data-deduct-entry]').forEach((button) =>
    button.addEventListener('click', () => {
      const entry = adminEntries.find((r) => r.id === button.dataset.deductEntry);
      deductDialog(entry, remaining(entry), ctx);
    }),
  );
}

export function openTaskReward(task, ctx, onSaved) {
  const eventId = state.activeEvent.id;
  const { close } = openModal(
    'Orga-Punkte festlegen',
    `<form class="stack"><p>${e(task.title)}</p>
    ${numberField('perPerson', 'Punkte pro Helfer', 5, 1, 1000)}${numberField('slots', 'Belohnte Helferplätze', 1, 1, 30)}
    <p class="muted">Die ersten Helfer sichern sich die Plätze. Weitere Helfer können ohne Punkte mitmachen. Die Belohnung ist danach verbindlich; beim Erledigen wird automatisch gebucht.</p>
    <button type="submit" class="btn btn-primary">Belohnung festlegen</button></form>`,
    {
      onMount(el) {
        el.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          perform(
            form.querySelector('button'),
            () =>
              pointsRequest(
                `/tasks/${encodeURIComponent(task.id)}/reward`,
                json('POST', { perPerson: Number(values.get('perPerson')), slots: Number(values.get('slots')) }),
                eventId,
              ),
            () => {
              close();
              invalidatePoints();
              onSaved?.();
              ctx.rerender();
            },
          );
        });
      },
    },
  );
}
