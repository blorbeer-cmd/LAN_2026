// Admin panel: one-tap admin mode (no PIN for now — see
// docs/KONZEPT-TEST-USER.md), seeded test players to try features solo,
// grant/revoke admin, delete players, and agent diagnostics. Most features
// stay open to everyone in the LAN trust model; this is just the extra role
// for testing and moderation.

import { api } from '../api.js';
import { confirmDialog, openModal } from '../modal.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { isAdmin, setAdmin } from '../admin.js';
import { withStepUp } from '../reauth.js';
import { icon } from '../icons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { authRequired } from '../authGate.js';
import { getMyId } from '../whoami.js';

const SEATING_HELP = 'Tisch, Plätze und Sitzordnung verwalten.';
const BACKUP_HELP = 'Aktuellen Stand als SQLite-Datei sichern.';
const TEST_DATA_HELP = 'Kommen fertig eingerichtet: Platz im Sitzplan samt sichtbarer Monitore, Skill- und Bock-Werte pro Spiel, Spielzeit fürs aktive Event – zwei davon spielen gerade. Nur im Admin-Modus sichtbar.';

let agentDiagnostics = null;
let diagnosticsLoading = false;
let seedBusy = false;
let adminPlayers = null;
let adminPlayersLoading = false;
let activeInvites = null;
let activeInvitesLoading = false;

function inviteUrl(invite) {
  const param = invite.purpose === 'register' ? 'invite' : invite.purpose;
  return `${location.origin}/?${param}=${encodeURIComponent(invite.code)}`;
}

function invitePurposeLabel(purpose) {
  if (purpose === 'claim') return 'Konto übernehmen';
  if (purpose === 'reset') return 'Passwort zurücksetzen';
  return 'Neue Person';
}

function openInviteModal(invite) {
  const url = inviteUrl(invite);
  const target = invite.playerName ? ` für ${invite.playerName}` : '';
  const { el } = openModal(
    `${invitePurposeLabel(invite.purpose)}${escapeHtml(target)}`,
    `<div class="stack">
      <label for="admin-invite-link">Einmal-Link</label>
      <div class="row" style="gap:var(--space-2);">
        <input type="text" id="admin-invite-link" readonly value="${escapeHtml(url)}" style="flex:1;font-family:monospace;font-size:var(--font-size-xs);" />
        <button type="button" class="btn btn-sm" id="admin-invite-copy">Kopieren</button>
      </div>
      <button type="button" class="btn btn-sm" id="admin-invite-qr-toggle">${icon('scanQrCode')} QR-Code anzeigen</button>
      <div id="admin-invite-qr" style="text-align:center;" hidden></div>
      <p class="muted" style="font-size:var(--font-size-xs);">Gültig bis ${escapeHtml(new Date(invite.expiresAt).toLocaleString('de-DE'))}. Der Link funktioniert nur einmal.</p>
    </div>`
  );
  el.querySelector('#admin-invite-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Einmal-Link kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });
  el.querySelector('#admin-invite-qr-toggle').addEventListener('click', async (event) => {
    const qr = el.querySelector('#admin-invite-qr');
    if (!qr.hidden) {
      qr.hidden = true;
      event.currentTarget.innerHTML = `${icon('scanQrCode')} QR-Code anzeigen`;
      return;
    }
    qr.hidden = false;
    event.currentTarget.innerHTML = `${icon('scanQrCode')} QR-Code ausblenden`;
    if (qr.dataset.loaded) return;
    try {
      qr.innerHTML = await api.qrcode.svg(url);
      qr.dataset.loaded = '1';
    } catch (error) {
      qr.textContent = 'QR-Code konnte nicht geladen werden.';
      showToast(error.message, { error: true });
    }
  });
}

async function loadActiveInvites(ctx, force = false) {
  if (!authRequired || activeInvitesLoading || (activeInvites && !force)) return;
  activeInvitesLoading = true;
  try {
    activeInvites = await api.auth.invites();
  } catch (error) {
    showToast(error.message, { error: true });
    activeInvites = [];
  } finally {
    activeInvitesLoading = false;
    ctx.rerender();
  }
}

async function loadAdminPlayers(ctx, force = false) {
  if (adminPlayersLoading || (adminPlayers && !force)) return;
  adminPlayersLoading = true;
  try {
    adminPlayers = await api.admin.players();
  } catch (error) {
    showToast(error.message, { error: true });
    adminPlayers = [];
  } finally {
    adminPlayersLoading = false;
    ctx.rerender();
  }
}

async function refreshAdminData(ctx) {
  await ctx.refresh();
  await Promise.all([loadAdminPlayers(ctx, true), ...(authRequired ? [loadActiveInvites(ctx, true)] : [])]);
}

async function createLoginInvite(purpose, player, ctx) {
  try {
    const invite = await withStepUp(() => api.auth.createInvite({ purpose, ...(player ? { playerId: player.id } : {}) }));
    if (invite === undefined) return;
    const enriched = { ...invite, playerName: player?.name || null };
    showToast('Einmal-Link erstellt.');
    openInviteModal(enriched);
    await loadActiveInvites(ctx, true);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

async function revokeLoginInvite(invite, ctx) {
  if (!(await confirmDialog('Diesen Einmal-Link wirklich widerrufen?', {
    title: 'Link widerrufen',
    confirmText: 'Widerrufen',
    danger: true,
  }))) return;
  try {
    const result = await withStepUp(() => api.auth.revokeInvite(invite.code));
    if (result === undefined) return;
    showToast('Einmal-Link widerrufen.');
    await loadActiveInvites(ctx, true);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

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
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  } finally {
    seedBusy = false;
  }
}

async function cleanupTestUsers(ctx) {
  if (!(await confirmDialog('Alle markierten Testdaten löschen? Das entfernt Test-Spieler sowie historische Test-LANs mitsamt Ergebnissen und Turnieren.'))) return;
  try {
    const res = await withStepUp(() => api.admin.cleanupTestUsers());
    if (res === undefined) return;
    const removed = (res.deletedPlayers ?? res.deleted ?? 0) + (res.deletedEvents ?? 0);
    showToast(
      removed > 0
        ? `${res.deletedPlayers ?? res.deleted ?? 0} Test-Spieler und ${res.deletedEvents ?? 0} Test-LANs entfernt.`
        : 'Keine Testdaten vorhanden.'
    );
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function toggleAdmin(player, ctx) {
  try {
    const updated = await withStepUp(() => api.players.update(player.id, { isAdmin: !player.is_admin }));
    if (updated === undefined) return;
    showToast(player.is_admin ? `${player.name} ist kein Admin mehr.` : `${player.name} ist jetzt Admin.`);
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function deletePlayer(player, ctx) {
  if (!(await confirmDialog(`Spieler "${player.name}" wirklich löschen?`))) return;
  try {
    const removed = await withStepUp(() => api.players.remove(player.id));
    if (removed === undefined) return;
    showToast('Spieler gelöscht.');
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function downloadBackup() {
  try {
    const result = await withStepUp(() => api.backup.download());
    if (result === undefined) return;
    const { blob, filename } = result;
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

async function deactivatePlayer(player, ctx) {
  if (!(await confirmDialog(`Konto „${player.name}“ deaktivieren? Login, Agent, Push und offene Sitzungen werden sofort beendet; Historie und Statistiken bleiben erhalten.`, {
    title: 'Konto deaktivieren',
    confirmText: 'Deaktivieren',
    danger: true,
  }))) return;
  try {
    const result = await withStepUp(() => api.players.deactivate(player.id));
    if (result === undefined) return;
    showToast('Konto deaktiviert.');
    await refreshAdminData(ctx);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

async function reactivatePlayer(player, ctx) {
  try {
    const result = await withStepUp(() => api.players.reactivate(player.id));
    if (result === undefined) return;
    showToast('Konto reaktiviert. Die Admin-Rolle bleibt aus Sicherheitsgründen entzogen.');
    await refreshAdminData(ctx);
  } catch (error) {
    showToast(error.message, { error: true });
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
  if (adminPlayers === null && !adminPlayersLoading) loadAdminPlayers(ctx);
  if (authRequired && activeInvites === null && !activeInvitesLoading) loadActiveInvites(ctx);
  const players = adminPlayers || [];
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
          ${p.deactivated_at ? '<span class="badge badge-offline">Deaktiviert</span>' : ''}
        </span>
        <span class="row admin-player-actions" style="gap:var(--space-2);">
          ${p.deactivated_at ? `<button type="button" class="btn btn-sm" data-reactivate-player="${p.id}">Reaktivieren</button>` : `<button type="button" class="btn btn-sm" data-toggle-admin="${p.id}" ${p.is_test ? 'disabled' : ''}>${p.is_admin ? 'Admin entziehen' : 'Admin machen'}</button>`}
          ${p.deactivated_at ? '' : p.is_test ? `<button type="button" class="btn btn-sm btn-danger" data-delete-player="${p.id}">Löschen</button>` : `<button type="button" class="btn btn-sm btn-danger" data-deactivate-player="${p.id}">Deaktivieren</button>`}
        </span>
      </div>`
    )
    .join('');

  const accountRows = players
    .filter((player) => !player.is_test && !player.deactivated_at)
    .map(
      (player) => `<div class="row-between" style="gap:var(--space-2);">
        <span>
          <strong>${escapeHtml(player.name)}</strong>
          <span class="badge ${player.is_claimed ? 'badge-playing' : 'badge-paused'}">${player.is_claimed ? 'Aktiv' : 'Noch nicht übernommen'}</span>
        </span>
        <button type="button" class="btn btn-sm" data-create-login-link="${player.is_claimed ? 'reset' : 'claim'}" data-player-id="${player.id}">
          ${player.is_claimed ? 'Reset-Link' : 'Claim-Link'}
        </button>
      </div>`
    )
    .join('');

  const inviteRows = (activeInvites || [])
    .map(
      (invite) => `<div class="row-between" style="gap:var(--space-2);">
        <span>
          <strong>${escapeHtml(invite.playerName || invitePurposeLabel(invite.purpose))}</strong>
          <span class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(invitePurposeLabel(invite.purpose))} · bis ${escapeHtml(new Date(invite.expiresAt).toLocaleString('de-DE'))}</span>
        </span>
        <span class="row" style="gap:var(--space-2);">
          <button type="button" class="btn btn-sm" data-show-login-link="${invite.code}">Anzeigen</button>
          <button type="button" class="btn btn-sm btn-danger" data-revoke-login-link="${invite.code}">Widerrufen</button>
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
      ${authRequired ? '' : '<button type="button" class="btn btn-sm" id="admin-leave">Modus verlassen</button>'}
    </div>
    <div class="grouped-page-sections">
      ${
        authRequired
          ? `<section class="card stack grouped-page-section" aria-labelledby="admin-onboarding-title">
        <div class="grouped-page-section-title"><h2 id="admin-onboarding-title">Onboarding &amp; Kontozugang</h2></div>
        <p class="muted">Neue Personen registrieren sich über einen allgemeinen Einmal-Link. Bestehende Profile erhalten einen persönlichen Claim-Link; für vergessene Passwörter gibt es einen Reset-Link.</p>
        <button type="button" class="btn btn-primary" id="admin-register-link">Link für neue Person erstellen</button>
        <div class="stack">${accountRows || '<span class="muted">Keine aktiven echten Konten vorhanden.</span>'}</div>
        <div class="section-title">Aktive Einmal-Links</div>
        <div class="stack">${activeInvitesLoading && activeInvites === null ? '<span class="muted">Links werden geladen…</span>' : inviteRows || '<span class="muted">Keine aktiven Links.</span>'}</div>
      </section>`
          : ''
      }
      <section class="card stack grouped-page-section" aria-labelledby="admin-tools-title">
        <div class="grouped-page-section-title"><h2 id="admin-tools-title">Werkzeuge</h2></div>
        <div class="two-column-card-grid">
          <div class="card admin-tool-row">
            <span class="title-with-info">
              <strong>Sitzplan</strong>
              ${infoTooltipHtml('admin-seating-help', 'Sitzplan', SEATING_HELP)}
            </span>
            <button type="button" class="btn btn-primary btn-sm" data-navigate="seating">Öffnen</button>
          </div>
          <div class="card admin-tool-row">
            <span class="title-with-info">
              <strong>Backup</strong>
              ${infoTooltipHtml('admin-backup-help', 'Backup', BACKUP_HELP)}
            </span>
            <button type="button" class="btn btn-primary btn-sm" id="download-backup">Herunterladen</button>
          </div>
        </div>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="admin-test-players-title">
        <div class="grouped-page-section-title">
          <span class="title-with-info">
            <h2 id="admin-test-players-title">Testdaten</h2>
            ${infoTooltipHtml('admin-test-data-help', 'Testdaten', TEST_DATA_HELP)}
          </span>
        </div>
        <div class="title-with-info">
          <strong>Test-Spieler</strong>
          ${infoTooltipHtml('admin-test-count-help', 'Vorhandene Test-Spieler', `${testCount} Test-Spieler vorhanden`)}
        </div>
        <div class="admin-test-controls">
          <input type="number" id="admin-count" value="5" min="1" max="20" aria-label="Anzahl Test-Spieler" />
          <button type="button" class="btn btn-sm btn-danger" id="admin-cleanup">Test-Daten aufräumen</button>
          <button type="button" class="btn btn-primary btn-sm" id="admin-bulk" ${seedBusy ? 'disabled' : ''}>Test-Spieler anlegen</button>
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

  container.querySelector('#admin-leave')?.addEventListener('click', () => {
    setAdmin(false);
    showToast('Admin-Modus verlassen.');
  });

  container.querySelector('#admin-register-link')?.addEventListener('click', () => createLoginInvite('register', null, ctx));
  container.querySelectorAll('[data-create-login-link]').forEach((button) => {
    button.addEventListener('click', () => {
      const player = players.find((entry) => entry.id === button.dataset.playerId);
      if (player) createLoginInvite(button.dataset.createLoginLink, player, ctx);
    });
  });
  container.querySelectorAll('[data-show-login-link]').forEach((button) => {
    button.addEventListener('click', () => {
      const invite = (activeInvites || []).find((entry) => entry.code === button.dataset.showLoginLink);
      if (invite) openInviteModal(invite);
    });
  });
  container.querySelectorAll('[data-revoke-login-link]').forEach((button) => {
    button.addEventListener('click', () => {
      const invite = (activeInvites || []).find((entry) => entry.code === button.dataset.revokeLoginLink);
      if (invite) revokeLoginInvite(invite, ctx);
    });
  });

  container.querySelector('#admin-bulk').addEventListener('click', () => {
    const count = Math.min(20, Math.max(1, parseInt(container.querySelector('#admin-count').value, 10) || 5));
    createTestUsers(count, ctx);
  });

  container.querySelector('#admin-cleanup').addEventListener('click', () => cleanupTestUsers(ctx));

  container.querySelector('#download-backup').addEventListener('click', downloadBackup);
  wireInfoTooltips(container);

  container.querySelector('#agent-diagnostics-refresh').addEventListener('click', () => loadAgentDiagnostics(ctx, true));

  container.querySelectorAll('[data-toggle-admin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = players.find((p) => p.id === btn.dataset.toggleAdmin);
      if (player) toggleAdmin(player, ctx);
    });
  });

  container.querySelectorAll('[data-delete-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = players.find((p) => p.id === btn.dataset.deletePlayer);
      if (player) deletePlayer(player, ctx);
    });
  });
  container.querySelectorAll('[data-deactivate-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = players.find((p) => p.id === btn.dataset.deactivatePlayer);
      if (player) deactivatePlayer(player, ctx);
    });
  });
  container.querySelectorAll('[data-reactivate-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = players.find((p) => p.id === btn.dataset.reactivatePlayer);
      if (player) reactivatePlayer(player, ctx);
    });
  });
}

export function renderAdmin(container, ctx) {
  if (authRequired) {
    const current = (state.players || []).find((player) => player.id === getMyId());
    if (!current?.is_admin) {
      if (isAdmin()) setAdmin(false);
      container.innerHTML = `
        <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
        <h1 class="view-title">${icon('shield')} Admin</h1>
        <div class="card"><p class="muted">Dieses Konto hat keine Admin-Rechte.</p></div>`;
      return;
    }
    if (!isAdmin()) {
      setAdmin(true);
      return;
    }
    renderPanel(container, ctx);
    return;
  }
  if (isAdmin()) renderPanel(container, ctx);
  else renderActivate(container);
}
