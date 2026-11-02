import { apiFetch } from './api.js';
import { state } from './state.js';
import { getMyId } from './whoami.js';
import { currentGroup, isGroupAdmin } from './groupContext.js';
import { escapeHtml as e, formatDateTime } from './format.js';
import { openModal } from './modal.js';
import { emptyStateHtml } from './emptyState.js';
import { showToast } from './toast.js';

const dialogs = new Map();
const labels = { open: 'Offen', corrected: 'Korrigiert', dismissed: 'In Ordnung' };
const scope = () => `${currentGroup()?.id}:${currentGroup()?.role}:${getMyId()}:${state.activeEvent?.id}`;
const request = (eventId, path = '', options = {}) => apiFetch(`/api/points/reports${path}?eventId=${encodeURIComponent(eventId)}`, options);
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });
function register(dialog, eventId, kind, reload) {
  dialogs.set(dialog.close, { eventId, kind, key: scope(), reload });
  return dialog;
}
export function refreshPointsReports() {
  for (const [close, entry] of dialogs) {
    if (entry.key !== scope() || (entry.kind === 'create' && entry.eventId === state.activeEvent?.id && state.activeEvent?.pointsClosedAt)) close();
    else entry.reload?.();
  }
}
export function pointsReportButton(type, id, enabled = true) {
  if (!enabled || !id || !state.activeEvent?.pointsEnabled || state.activeEvent?.pointsClosedAt) return '';
  return `<button type="button" class="btn btn-sm" hidden data-report-points="${e(type)}" data-report-target="${e(id)}">Punktefehler melden</button>`;
}
export function wirePointsReportButtons(container) {
  const eventId = state.activeEvent?.id;
  const key = scope();
  container.querySelectorAll('[data-report-points]').forEach((button) => {
    const type = button.dataset.reportPoints, id = button.dataset.reportTarget;
    request(eventId, `/targets/${encodeURIComponent(type)}/${encodeURIComponent(id)}`).then((data) => {
      if (button.isConnected && key === scope()) button.hidden = !data.canReport;
    }).catch(() => {});
    button.addEventListener('click', () => openPointsReport(eventId, type, id));
  });
  container.querySelectorAll('[data-points-reports]').forEach((button) =>
    button.addEventListener('click', () => openPointsReports(button.dataset.pointsReports || eventId)));
}
function openPointsReport(eventId, targetType, targetId) {
  const key = scope();
  const dialog = openModal('Punktefehler melden', `<form class="stack" data-points-report-form>
    <p>Die Punktevergabe für diesen Eintrag prüfen lassen.</p>
    <label class="stack"><span class="field-label">Was stimmt an den Punkten nicht?</span><textarea name="reason" maxlength="300"></textarea></label>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">Meldung senden</button></div>
    </form>`, { onClose() { dialogs.delete(dialog.close); } });
  register(dialog, eventId, 'create');
  dialog.el.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (key !== scope()) return dialog.close();
    const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await request(eventId, '', json({ targetType, targetId, reason: new FormData(event.target).get('reason') }));
      if (key !== scope()) return;
      dialog.close(); showToast('Punktefehler gemeldet.'); openPointsReports(eventId);
    } catch (error) { if (key === scope()) showToast(error.message, { error: true }); }
    finally { button.disabled = false; }
  });
}
function reportHtml(report, inbox) {
  return `<article class="stack points-report" data-points-report-id="${e(report.id)}">
    <div class="row-between"><strong>${e(report.title)}</strong><span class="badge">${e(labels[report.status])}</span></div>
    ${report.anonymous ? '<p class="muted">Anonyme Meldung zu eigenen Punkten. Absender und Freitext sind verborgen.</p>' : ''}
    ${inbox && report.reporter ? `<p class="muted">Gemeldet von ${e(report.reporter.name)}</p>` : ''}
    ${report.reason ? `<p>${e(report.reason)}</p>` : ''}
    ${report.createdAt ? `<p class="muted">${e(formatDateTime(report.createdAt))}</p>` : ''}
    <p class="muted">Vorgang: ${e(report.targetId)}</p>
    ${report.resolution ? `<p>${e(report.resolution)}</p>` : ''}
    ${inbox && report.canResolve && report.status === 'open' ? `<div class="row points-actions">
      <button type="button" class="btn btn-sm" data-resolve-points-report="${e(report.id)}" data-report-status="corrected">Korrigiert</button>
      <button type="button" class="btn btn-sm" data-resolve-points-report="${e(report.id)}" data-report-status="dismissed">In Ordnung</button></div>` : ''}
    </article>`;
}
export function openPointsReports(eventId = state.activeEvent?.id) {
  const key = scope();
  let generation = 0;
  const dialog = openModal('Punktefehler-Meldungen', '<div class="stack" data-report-list></div>', { onClose() { dialogs.delete(dialog.close); } });
  const body = dialog.el.querySelector('[data-report-list]');
  async function reload() {
    const version = ++generation;
    body.innerHTML = emptyStateHtml('Meldungen werden geladen…');
    try {
      const data = await request(eventId);
      if (!body.isConnected || key !== scope() || version !== generation) return;
      body.innerHTML = `<section class="stack"><h3>Meine Meldungen</h3>${data.own.map((r) => reportHtml(r, false)).join('') || emptyStateHtml('Noch keine eigenen Meldungen.')}</section>
        <section class="stack"><h3>Zur Prüfung</h3>${data.inbox.map((r) => reportHtml(r, true)).join('') || emptyStateHtml('Keine Meldungen zur Prüfung.')}
        ${data.inbox.length && isGroupAdmin() && eventId === state.activeEvent?.id ? '<div class="row"><button type="button" class="btn btn-sm" data-review-points>Zum Punktejournal</button></div>' : ''}</section>`;
      body.querySelector('[data-review-points]')?.addEventListener('click', () => {
        dialog.close(); window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: { view: 'pointsAdmin' } }));
      });
      body.querySelectorAll('[data-resolve-points-report]').forEach((button) => button.addEventListener('click', () => {
        openResolution(eventId, button.dataset.resolvePointsReport, button.dataset.reportStatus, reload);
      }));
    } catch (error) {
      if (!body.isConnected || key !== scope() || version !== generation) return;
      body.innerHTML = `${emptyStateHtml(error.message)}<button type="button" class="btn btn-sm" data-retry-reports>Erneut laden</button>`;
      body.querySelector('[data-retry-reports]').addEventListener('click', reload);
    }
  }
  register(dialog, eventId, 'inbox', reload);
  void reload();
  return dialog;
}
function openResolution(eventId, reportId, status, reload) {
  const key = scope();
  const dialog = openModal(`Meldung: ${labels[status]}`, `<form class="stack">
    ${status === 'corrected' ? '<p>Eine Punktekorrektur muss separat mit Begründung im Journal gebucht werden.</p>' : ''}
    <label class="stack"><span class="field-label">Rückmeldung</span><textarea name="resolution" maxlength="300"></textarea></label>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">Meldung abschließen</button></div>
    </form>`, { onClose() { dialogs.delete(dialog.close); } });
  register(dialog, eventId, 'resolve');
  dialog.el.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (key !== scope()) return dialog.close();
    const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    try { await request(eventId, `/${encodeURIComponent(reportId)}/resolve`, json({ status, resolution: new FormData(event.target).get('resolution') }));
      if (key !== scope()) return;
      dialog.close(); void reload();
    } catch (error) { if (key === scope()) showToast(error.message, { error: true }); }
    finally { button.disabled = false; }
  });
}
