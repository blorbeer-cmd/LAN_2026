// Admin panel: one-tap admin mode (no PIN for now — see
// docs/KONZEPT-TEST-USER.md), seeded test players to try features solo,
// grant/revoke admin, delete players, and agent diagnostics. Most features
// stay open to everyone in the LAN trust model; this is just the extra role
// for testing and moderation.

import { api } from '../api.js';
import { confirmDialog } from '../modal.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { isAdmin, setAdmin } from '../admin.js';
import { icon } from '../icons.js';

let agentDiagnostics = null;
let diagnosticsLoading = false;
let seedBusy = false;

async function loadAgentDiagnostics(ctx, force = false) {
  if (diagnosticsLoading || (agentDiagnostics && !force)) return;
  diagnosticsLoading = true;
  try {
    agentDiagnostics = await api.admin.agentDiagnostics();
  } catch (err) {
    showToast(err.message, { error: true });
    agentDiagnostics = [];
  } finally {
    diagnosticsLoading = false;
    ctx.rerender();
  }
}

async function createTestUsers(count, ctx) {
  if (seedBusy) return;
  seedBusy = true;
  try {
    const res = await api.admin.createTestUsers(count);
    showToast(`${res.created.length} Test-Spieler angelegt – mit Sitzplatz, Skills, Bock und Spielzeit.`);
    await ctx.refresh();
  } catch (err) {
    showToast(err.message, { error: true });
  } finally {
    seedBusy = false;
  }
}

async function cleanupTestUsers(ctx) {
  if (!(await confirmDialog('Alle Test-Spieler und ihre Daten (Sitzplätze, Skills, Spielzeit) löschen?'))) return;
  try {
    const res = await api.admin.cleanupTestUsers();
    showToast(res.deleted > 0 ? `${res.deleted} Test-Spieler entfernt.` : 'Keine Test-Spieler vorhanden.');
    await ctx.refresh();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function toggleAdmin(player, ctx) {
  try {
    await api.players.update(player.id, { isAdmin: !player.is_admin });
    showToast(player.is_admin ? `${player.name} ist kein Admin mehr.` : `${player.name} ist jetzt Admin.`);
    await ctx.refresh();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function deletePlayer(player, ctx) {
  if (!(await confirmDialog(`Spieler "${player.name}" wirklich löschen?`))) return;
  try {
    await api.players.remove(player.id);
    showToast('Spieler gelöscht.');
    await ctx.refresh();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function downloadBackup() {
  try {
    const { blob, filename } = await api.backup.download();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Datenbank-Backup heruntergeladen.');
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

function renderActivate(container) {
  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Admin</h1>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="admin-mode-title">
        <div class="grouped-page-section-title"><h2 id="admin-mode-title">Admin-Modus</h2></div>
        <p class="muted">Im Admin-Modus kannst du Test-Spieler mit fertigen Daten anlegen,
        Admin-Rechte vergeben und Spieler löschen. Test-Spieler sind nur sichtbar,
        solange der Admin-Modus aktiv ist.</p>
        <button type="button" class="btn btn-primary btn-block" id="admin-activate">Admin-Modus aktivieren</button>
      </section>
    </div>
  `;

  container.querySelector('#admin-activate').addEventListener('click', () => {
    setAdmin(true); // app.js reacts to respawn:admin-changed: banner + refresh
    showToast('Admin-Modus aktiv.');
  });
}

function renderPanel(container, ctx) {
  const players = state.players || [];
  const testCount = players.filter((p) => p.is_test).length;
  if (agentDiagnostics === null && !diagnosticsLoading) loadAgentDiagnostics(ctx);
  const rows = players
    .map(
      (p) => `
      <div class="row-between admin-player-row" style="padding:var(--space-2) 0;border-bottom:1px solid var(--border);">
        <span class="row admin-player-identity" style="gap:var(--space-2);">
          <span class="avatar-dot" style="background:${escapeHtml(p.color)};"></span>
          <span class="player-name">${escapeHtml(p.name)}</span>
          ${p.is_admin ? '<span class="badge badge-playing">Admin</span>' : ''}
          ${p.is_test ? '<span class="badge badge-paused">Test</span>' : ''}
        </span>
        <span class="row admin-player-actions" style="gap:var(--space-2);">
          <button type="button" class="btn btn-sm" data-toggle-admin="${p.id}">${p.is_admin ? 'Admin entziehen' : 'Admin machen'}</button>
          <button type="button" class="btn btn-sm btn-danger" data-delete-player="${p.id}">Löschen</button>
        </span>
      </div>`
    )
    .join('');

  const diagnosticRows = (agentDiagnostics || [])
    .map((entry) => {
      const lastReport = entry.lastReportAt
        ? new Date(entry.lastReportAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Noch nie';
      const processes = entry.processNames.length
        ? entry.processNames.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join('')
        : '<span class="muted">Keine Prozesse gemeldet.</span>';
      return `
        <div class="agent-diagnostic-row">
          <div class="row-between" style="gap:var(--space-2);">
            <strong>${escapeHtml(entry.name)}</strong>
            <span class="row" style="gap:var(--space-2);">
              <span class="badge ${entry.online ? 'badge-playing' : 'badge-offline'}">${entry.online ? 'Agent online' : 'Agent offline'}</span>
              <span class="badge">v${escapeHtml(entry.agentVersion || 'unbekannt')}</span>
            </span>
          </div>
          <div class="muted" style="font-size:var(--font-size-xs);">Letzter Report: ${escapeHtml(lastReport)}</div>
          <div class="chip-list">${processes}</div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <div class="row-between">
      <h1 class="view-title">Admin</h1>
      <button type="button" class="btn btn-sm" id="admin-leave">Modus verlassen</button>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="admin-tools-title">
        <div class="grouped-page-section-title"><h2 id="admin-tools-title">Werkzeuge</h2></div>
        <div class="two-column-card-grid">
          <div class="card stack">
            <strong>Sitzplan</strong>
            <span class="muted">Tisch, Plätze und Sitzordnung verwalten.</span>
            <button type="button" class="btn btn-sm btn-block" data-navigate="seating">Sitzplan öffnen</button>
          </div>
          <div class="card stack">
            <strong>Backup</strong>
            <span class="muted">Aktuellen Stand als SQLite-Datei sichern.</span>
            <button type="button" class="btn btn-sm btn-block" id="download-backup">Backup herunterladen</button>
          </div>
        </div>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="admin-test-players-title">
        <div class="grouped-page-section-title"><h2 id="admin-test-players-title">Test-Spieler</h2></div>
        <p class="muted">Kommen fertig eingerichtet: Platz im Sitzplan samt sichtbarer Monitore,
        Skill- und Bock-Werte pro Spiel, Spielzeit fürs aktive Event – zwei davon spielen gerade.
        Nur im Admin-Modus sichtbar.</p>
        <div class="row" style="gap:var(--space-2);">
          <input type="number" id="admin-count" value="5" min="1" max="20" style="max-width:calc(var(--space-8) * 2);" />
          <button type="button" class="btn btn-primary" id="admin-bulk" style="flex:1;" ${seedBusy ? 'disabled' : ''}>Test-Spieler anlegen</button>
        </div>
        <div class="row-between">
          <span class="muted">${testCount} Test-Spieler vorhanden</span>
          <button type="button" class="btn btn-sm btn-danger" id="admin-cleanup" ${testCount === 0 ? 'disabled' : ''}>Test-Daten aufräumen</button>
        </div>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="admin-players-title">
        <div class="grouped-page-section-title"><h2 id="admin-players-title">Spieler (${players.length})</h2></div>
        <div class="card">${rows || '<span class="muted">Noch keine Spieler.</span>'}</div>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="admin-agent-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-agent-title">Agent-Diagnose</h2>
          <button type="button" class="btn btn-sm" id="agent-diagnostics-refresh">Aktualisieren</button>
        </div>
        <div class="card stack">
          ${diagnosticsLoading && agentDiagnostics === null ? '<div class="muted">Diagnose laden…</div>' : diagnosticRows || '<span class="muted">Noch keine Spieler.</span>'}
        </div>
      </section>
    </div>
  `;

  container.querySelector('#admin-leave').addEventListener('click', () => {
    setAdmin(false); // app.js reacts: banner disappears, data refetched
    showToast('Admin-Modus verlassen.');
  });

  container.querySelector('#admin-bulk').addEventListener('click', () => {
    const count = Math.min(20, Math.max(1, parseInt(container.querySelector('#admin-count').value, 10) || 5));
    createTestUsers(count, ctx);
  });

  container.querySelector('#admin-cleanup').addEventListener('click', () => cleanupTestUsers(ctx));

  container.querySelector('#download-backup').addEventListener('click', downloadBackup);

  container.querySelector('#agent-diagnostics-refresh').addEventListener('click', () => loadAgentDiagnostics(ctx, true));

  container.querySelectorAll('[data-toggle-admin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = (state.players || []).find((p) => p.id === btn.dataset.toggleAdmin);
      if (player) toggleAdmin(player, ctx);
    });
  });

  container.querySelectorAll('[data-delete-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = (state.players || []).find((p) => p.id === btn.dataset.deletePlayer);
      if (player) deletePlayer(player, ctx);
    });
  });
}

export function renderAdmin(container, ctx) {
  if (isAdmin()) renderPanel(container, ctx);
  else renderActivate(container);
}
