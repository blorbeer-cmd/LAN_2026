// Admin panel for authenticated owners/admins: onboarding, roles, seeded test
// players, account lifecycle and agent diagnostics.

import { api } from '../api.js';
import { confirmDialog, openModal } from '../modal.js';
import { state } from '../state.js';
import { eventHasFeature } from '../eventFeatures.js';
import { escapeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';
import { isAdmin, setAdmin } from '../admin.js';
import { withStepUp } from '../reauth.js';
import { icon } from '../icons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { getMyId } from '../whoami.js';
import { currentGroup, refreshGroupContext } from '../groupContext.js';
import { eventSelectOptions } from '../eventStatus.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';

const ONBOARDING_HELP = 'Neue Person: Registrierungslink. Bestehendes Profil: Claim-Link. Vergessenes Passwort: Reset-Link.';
const TEST_DATA_HELP = 'Legt Test-Spieler mit Sitzplatz, Bewertungen und Spielzeit sowie ein Test-LAN und ein allgemeines Testevent an. Nur im Admin-Modus sichtbar.';
const ADMIN_ROLE_HELP = 'Owner und Admins dürfen den Admin-Bereich verwalten. Mindestens ein aktiver Owner muss erhalten bleiben.';
const AGENT_DIAGNOSTICS_HELP = 'Der Agent fragt den PC gezielt nur nach den hier hinterlegten Spiele-Prozessen. Andere laufende Programme sieht er gar nicht erst und sie verlassen den PC nie.';

export const REGISTER_INVITE_DURATION_OPTIONS = Object.freeze([
  { value: 24 * 60 * 60 * 1000, label: '24 Stunden' },
  { value: 3 * 24 * 60 * 60 * 1000, label: '3 Tage' },
  { value: 7 * 24 * 60 * 60 * 1000, label: '7 Tage' },
  { value: 14 * 24 * 60 * 60 * 1000, label: '14 Tage' },
  { value: 30 * 24 * 60 * 60 * 1000, label: '30 Tage' },
  { value: 90 * 24 * 60 * 60 * 1000, label: '90 Tage' },
]);
export const DEFAULT_REGISTER_INVITE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

let agentDiagnostics = null;
let diagnosticsLoading = false;
let seedBusy = false;
let adminPlayers = null;
let adminPlayersLoading = false;
let adminMembers = null;
let adminMembersLoading = false;
let adminMembersError = null;
const roleChangesInFlight = new Set();
let activeInvites = null;
let activeInvitesLoading = false;
let readiness = null;
let readinessLoading = false;
let readinessError = null;

const READINESS_STATUS = {
  ready: { label: 'Bereit', badge: 'badge-playing' },
  warning: { label: 'Prüfen', badge: 'badge-paused' },
  error: { label: 'Fehler', badge: 'badge-overdue' },
};

function inviteUrl(invite) {
  const param = invite.purpose === 'register' ? 'invite' : invite.purpose === 'test_login' ? 'testSession' : invite.purpose;
  return `${location.origin}/?${param}=${encodeURIComponent(invite.code)}`;
}

function invitePurposeLabel(purpose) {
  if (purpose === 'claim') return 'Konto übernehmen';
  if (purpose === 'reset') return 'Passwort zurücksetzen';
  if (purpose === 'test_login') return 'Testsitzung';
  return 'Registrierungslink';
}

export function formatInviteRemaining(expiresAt, now = Date.now()) {
  if (expiresAt == null) return 'Gültig bis zum Widerruf';
  const remainingMs = Number(expiresAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'abgelaufen';
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `noch ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} gültig`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `noch ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'} gültig`;
  const days = Math.ceil(hours / 24);
  return `noch ${days} ${days === 1 ? 'Tag' : 'Tage'} gültig`;
}

export function inviteValidityLabel(expiresAt, now = Date.now()) {
  if (expiresAt == null) return 'Gültig bis zum Widerruf';
  return `${formatInviteRemaining(expiresAt, now)} · bis ${formatDateTime(expiresAt)} Uhr`;
}

function openInviteModal(invite) {
  const url = inviteUrl(invite);
  const target = invite.playerName ? ` für ${invite.playerName}` : '';
  const usageCount = Number.isInteger(invite.usageCount) ? invite.usageCount : 0;
  const reusable = invite.reusable || (invite.purpose === 'register' && invite.expiresAt == null);
  const eventHint = invite.eventSelectable === false
    ? `<div class="admin-invite-event"><span class="muted">Event</span><strong>${escapeHtml(invite.eventName || 'Ziel-Event')}</strong><span class="muted">Ziel-Event beendet oder abgesagt – neue Konten starten in Allgemein.</span></div>`
    : invite.eventName
      ? `<div class="admin-invite-event"><span class="muted">Event</span><strong>${escapeHtml(invite.eventName)}</strong></div>`
      : '';
  const validityHint = `${inviteValidityLabel(invite.expiresAt)}. ${reusable ? 'Mehrfach nutzbar.' : 'Der Link funktioniert nur einmal.'}`;
  const { el } = openModal(
    `${invitePurposeLabel(invite.purpose)}${escapeHtml(target)}`,
    `<div class="stack">
      <label for="admin-invite-link">Link</label>
      ${eventHint}
      <div class="invite-link-row">
        <input type="text" id="admin-invite-link" readonly value="${escapeHtml(url)}" style="flex:1;font-family:monospace;font-size:var(--font-size-xs);" />
        <button type="button" class="btn btn-sm" id="admin-invite-copy">Kopieren</button>
      </div>
      <button type="button" class="btn btn-sm" id="admin-invite-qr-toggle">${icon('scanQrCode')} QR-Code anzeigen</button>
      <div id="admin-invite-qr" style="text-align:center;" hidden></div>
      <p class="muted" style="font-size:var(--font-size-xs);">${validityHint} ${usageCount}× genutzt.</p>
    </div>`
  );
  el.querySelector('#admin-invite-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link kopiert.');
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
  if (activeInvitesLoading || (activeInvites && !force)) return;
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
    const group = currentGroup();
    adminMembers = group ? await api.groups.members(group.id) : [];
  } catch (error) {
    showToast(error.message, { error: true });
    adminPlayers = [];
    adminMembers = [];
  } finally {
    adminPlayersLoading = false;
    ctx.rerender();
  }
}

async function loadAdminMembers(ctx, force = false) {
  if (adminMembersLoading || (adminMembers !== null && !force)) return;
  adminMembersLoading = true;
  adminMembersError = null;
  ctx.rerender();
  try {
    const group = currentGroup();
    if (!group) throw new Error('Der interne Zugriffskontext ist nicht verfügbar.');
    adminMembers = await api.groups.members(group.id);
  } catch (error) {
    showToast(error.message, { error: true });
    adminMembersError = error.message;
    if (adminMembers === null) adminMembers = [];
  } finally {
    adminMembersLoading = false;
    ctx.rerender();
  }
}

export function invalidateAdminMemberships() {
  adminMembers = null;
  adminMembersError = null;
  invalidateAdminReadiness();
}

export function invalidateAdminReadiness() {
  readiness = null;
  readinessError = null;
}

function focusReadinessTarget(preferredId) {
  const target =
    (preferredId ? document.getElementById(preferredId) : null) ||
    document.getElementById('admin-readiness-refresh') ||
    document.getElementById('admin-readiness-status');
  target?.focus({ preventScroll: true });
}

async function loadReadiness(ctx, force = false, restoreFocusId = null) {
  if (readinessLoading || (readiness && !force)) return;
  readinessLoading = true;
  readinessError = null;
  if (force) {
    ctx.rerender();
    focusReadinessTarget('admin-readiness-status');
  }
  try {
    readiness = await api.admin.readiness();
  } catch (error) {
    readiness = null;
    readinessError = error.message;
  } finally {
    readinessLoading = false;
    ctx.rerender();
    if (restoreFocusId) focusReadinessTarget(restoreFocusId);
  }
}

function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', member: 'Mitglied' }[role] ?? role;
}

function roleControl(player) {
  const membership = adminMembers?.find((member) => member.playerId === player.id);
  if (!membership || player.deactivated_at) return '';

  const myRole = currentGroup()?.role;
  const canChangeOwner = myRole === 'owner';
  const canChangeMember = myRole === 'admin' && membership.role !== 'owner';
  if (player.is_test || (!canChangeOwner && !canChangeMember)) {
    return `<span class="badge">${escapeHtml(roleLabel(membership.role))}</span>`;
  }

  const roles = canChangeOwner ? ['member', 'admin', 'owner'] : ['member', 'admin'];
  return `<select class="admin-role-select" data-player-role="${escapeHtml(player.id)}" aria-label="Rolle von ${escapeHtml(player.name)}" ${roleChangesInFlight.has(player.id) ? 'disabled' : ''}>
    ${roles.map((role) => `<option value="${role}" ${membership.role === role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}
  </select>`;
}

async function changeRole(player, role, ctx) {
  if (roleChangesInFlight.has(player.id)) return;
  const group = currentGroup();
  if (!group) {
    showToast('Der interne Zugriffskontext ist nicht verfügbar.', { error: true });
    ctx.rerender();
    return;
  }
  roleChangesInFlight.add(player.id);
  try {
    const result = await withStepUp(() => api.groups.updateMember(group.id, player.id, role));
    if (result === undefined) {
      await loadAdminMembers(ctx, true);
      return;
    }
    showToast(`Rolle von ${player.name} geändert.`);
    await refreshGroupContext();
    if (player.id === getMyId() && role === 'member') {
      await ctx.refresh();
      return;
    }
    await refreshAdminData(ctx);
  } catch (error) {
    showToast(error.message, { error: true });
    await loadAdminMembers(ctx, true);
  } finally {
    roleChangesInFlight.delete(player.id);
    ctx.rerender();
  }
}

async function refreshAdminData(ctx) {
  await ctx.refresh();
  await Promise.all([
    loadAdminPlayers(ctx, true),
    loadAdminMembers(ctx, true),
    loadActiveInvites(ctx, true),
  ]);
}

export function registerInviteEventOptions() {
  const events = (state.managedEvents || []).filter(
    (event) => !event.isOutsideEvents && !event.isBase && !event.isEnded && event.status === 'published',
  );
  return eventSelectOptions(events, { allEntryLabel: 'Allgemein (kein zusätzliches Event)' });
}

function openRegisterInviteDialog(ctx) {
  const eventOptions = registerInviteEventOptions();
  const { el, close } = openModal(
    'Registrierungslink erstellen',
    `<form id="admin-register-invite-form" class="stack">
      <p class="muted admin-register-invite-note">Der Link kann innerhalb der gewählten Dauer von mehreren neuen Personen genutzt werden.</p>
      <div>
        <label for="admin-register-expires" class="field-label">Gültig für</label>
        <select id="admin-register-expires" required>
          ${REGISTER_INVITE_DURATION_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === DEFAULT_REGISTER_INVITE_DURATION_MS ? 'selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="admin-register-event-search" class="field-label">Direkte Event-Einladung (optional)</label>
        ${searchSelectHtml('admin-register-event', eventOptions, '', {
          placeholder: 'Event auswählen…',
          label: 'Events für die Einladung',
        })}
      </div>
      <button type="submit" class="btn btn-primary btn-block">Registrierungslink erstellen</button>
    </form>`,
  );
  wireSearchSelect(el, 'admin-register-event', eventOptions, {
    emptyText: 'Kein offenes Event gefunden.',
  });
  el.querySelector('#admin-register-invite-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const eventId = el.querySelector('#admin-register-event').value;
      const expiresInMs = Number(el.querySelector('#admin-register-expires').value);
      const created = await createLoginInvite('register', null, ctx, { expiresInMs, ...(eventId ? { eventId } : {}) });
      if (created) close();
    } finally {
      button.disabled = false;
    }
  });
}

async function createLoginInvite(purpose, player, ctx, options = {}) {
  try {
    const invite = await withStepUp(() =>
      api.auth.createInvite({ purpose, ...(player ? { playerId: player.id } : {}), ...options }),
    );
    if (invite === undefined) return false;
    const enriched = { ...invite, playerName: player?.name || null };
    showToast(purpose === 'register' ? 'Registrierungslink erstellt.' : 'Link erstellt.');
    openInviteModal(enriched);
    await loadActiveInvites(ctx, true);
    return true;
  } catch (error) {
    showToast(error.message, { error: true });
    return false;
  }
}

async function revokeLoginInvite(invite, ctx) {
  if (!(await confirmDialog('Diesen Einladungslink wirklich widerrufen?', {
    title: 'Link widerrufen',
    confirmText: 'Widerrufen',
    danger: true,
  }))) return;
  try {
    const result = await withStepUp(() => api.auth.revokeInvite(invite.code));
    if (result === undefined) return;
  showToast('Einladungslink widerrufen.');
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
    showToast(`${res.created.length} Test-Spieler sowie zwei Testevents angelegt.`);
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  } finally {
    seedBusy = false;
  }
}

async function cleanupTestUsers(ctx) {
  if (!(await confirmDialog('Alle markierten Testdaten löschen? Das entfernt Test-Spieler und Testevents mitsamt ihren Daten.', { confirmText: 'Löschen', danger: true }))) return;
  try {
    const res = await withStepUp(() => api.admin.cleanupTestUsers());
    if (res === undefined) return;
    const removed = (res.deletedPlayers ?? res.deleted ?? 0) + (res.deletedEvents ?? 0);
    showToast(
      removed > 0
        ? `${res.deletedPlayers ?? res.deleted ?? 0} Test-Spieler und ${res.deletedEvents ?? 0} Testevents entfernt.`
        : 'Keine Testdaten vorhanden.'
    );
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function deletePlayer(player, ctx) {
  if (!(await confirmDialog(`Spieler "${player.name}" wirklich löschen? Alle Tracking-Daten, Sitzungen und persönlichen Kontodaten werden unwiderruflich entfernt.`, { confirmText: 'Löschen', danger: true }))) return;
  try {
    const removed = await withStepUp(() => api.players.remove(player.id));
    if (removed === undefined) return;
    showToast('Spieler gelöscht.');
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function downloadBackup(ctx) {
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
    await loadReadiness(ctx, true);
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

function renderPanel(container, ctx) {
  if (adminPlayers === null && !adminPlayersLoading) loadAdminPlayers(ctx);
  if (adminMembers === null && !adminMembersLoading && !adminMembersError) loadAdminMembers(ctx);
  if (activeInvites === null && !activeInvitesLoading) loadActiveInvites(ctx);
  const adminModeActive = isAdmin();
  const trackingEnabled = eventHasFeature(state.activeEvent, 'tracking');
  const seatingEnabled = eventHasFeature(state.activeEvent, 'seating');
  const kioskEnabled = eventHasFeature(state.activeEvent, 'kiosk');
  const arcadeEnabled = eventHasFeature(state.activeEvent, 'arcade');
  const allPlayers = adminPlayers || [];
  const players = adminModeActive ? allPlayers : allPlayers.filter((player) => !player.is_test);
  const testCount = allPlayers.filter((player) => player.is_test).length;
  if (trackingEnabled && agentDiagnostics === null && !diagnosticsLoading) loadAgentDiagnostics(ctx);
  if (trackingEnabled && readiness === null && !readinessLoading && !readinessError) loadReadiness(ctx);
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
          ${roleControl(p)}
          ${!p.is_test || p.deactivated_at ? `<button type="button" class="btn btn-sm btn-danger" data-delete-player="${p.id}">${p.deactivated_at ? 'Dauerhaft löschen' : 'Löschen'}</button>` : ''}
          ${p.is_test && !p.deactivated_at ? `<button type="button" class="btn btn-sm" data-test-session="${p.id}">Testsitzung öffnen</button>` : ''}
          ${p.deactivated_at
            ? `<button type="button" class="btn btn-sm" data-reactivate-player="${p.id}">Reaktivieren</button>`
            : ''}
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
      (invite) => {
        const eventLabel = invite.eventSelectable === false
          ? 'Ziel-Event beendet oder abgesagt – Start in Allgemein'
          : invite.eventName
            ? escapeHtml(invite.eventName)
            : '';
        return `<div class="row-between" style="gap:var(--space-2);">
        <span>
          <strong>${escapeHtml(invite.playerName || invitePurposeLabel(invite.purpose))}</strong>
          <span class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(invitePurposeLabel(invite.purpose))}${eventLabel ? ` · ${eventLabel}` : ''} · ${invite.usageCount ?? 0}× genutzt · ${escapeHtml(inviteValidityLabel(invite.expiresAt))}</span>
        </span>
        <span class="row" style="gap:var(--space-2);">
          <button type="button" class="btn btn-sm" data-show-login-link="${invite.code}">Anzeigen</button>
          <button type="button" class="btn btn-sm btn-danger" data-revoke-login-link="${invite.code}">Widerrufen</button>
        </span>
      </div>`;
      },
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
              <span class="badge">${entry.agentVersion ? `v${escapeHtml(entry.agentVersion)}` : 'Version unbekannt'}</span>
            </span>
          </div>
          <div class="muted" style="font-size:var(--font-size-xs);">Letzter Report: ${escapeHtml(lastReport)}</div>
          <div class="chip-list">${processes}</div>
        </div>`;
    })
    .join('');

  const readinessChecks = (readiness?.checks || [])
    .map((check) => {
      const status = READINESS_STATUS[check.status] || READINESS_STATUS.warning;
      const details = check.details.length
        ? `<ul class="readiness-details">${check.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>`
        : '';
      return `<div class="card stack readiness-check">
        <div class="row-between" style="gap:var(--space-2);">
          <strong>${escapeHtml(check.label)}</strong>
          <span class="badge ${status.badge}">${status.label}</span>
        </div>
        <p class="readiness-check-summary">${escapeHtml(check.summary)}</p>
        ${details}
      </div>`;
    })
    .join('');
  const overallStatus = READINESS_STATUS[readiness?.overall] || READINESS_STATUS.warning;
  const readinessBody = readinessError
    ? `<div class="notice notice-warning row-between" style="gap:var(--space-2);">
        <span>Bereitschaft konnte nicht geladen werden.</span>
        <button type="button" class="btn btn-sm" id="admin-readiness-retry">Erneut versuchen</button>
      </div>`
    : readinessLoading && readiness === null
      ? '<div class="card muted">Bereitschaft wird geprüft…</div>'
      : `<div class="readiness-overview row-between">
          <span>
            <strong>Gesamtstatus</strong>
            <span class="muted">Stand ${formatDateTime(readiness?.generatedAt)} Uhr</span>
          </span>
          <span class="badge ${overallStatus.badge}">${overallStatus.label}</span>
        </div>
        <div class="two-column-card-grid">${readinessChecks}</div>`;

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
        <h1 class="view-title">Admin</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      ${adminModeActive ? '' : `<section class="card stack grouped-page-section" aria-labelledby="admin-mode-title">
        <div class="grouped-page-section-title"><h2 id="admin-mode-title">Admin-Modus</h2></div>
        <p class="muted">Aktiviere den Admin-Modus, um Test-Spieler in der App anzuzeigen${arcadeEnabled ? ' und im Arcade-Bereich gegen die KI zu spielen' : ''}.</p>
        <button type="button" class="btn btn-primary btn-block" id="admin-mode-activate">Admin-Modus aktivieren</button>
      </section>`}
      ${trackingEnabled ? `<section class="card stack grouped-page-section" aria-labelledby="admin-readiness-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-readiness-title">LAN-Bereitschaft</h2>
          <button type="button" class="btn btn-sm" id="admin-readiness-refresh" ${readinessLoading ? 'disabled' : ''}>Aktualisieren</button>
        </div>
        <div id="admin-readiness-status" class="stack" role="status" aria-live="polite" tabindex="-1">
          ${readinessBody}
        </div>
      </section>` : ''}
      <section class="card stack grouped-page-section" aria-labelledby="admin-onboarding-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-onboarding-title" class="title-with-info">
            <span>Onboarding &amp; Kontozugang</span>
            ${infoTooltipHtml('admin-onboarding-help', 'Onboarding und Kontozugang', ONBOARDING_HELP)}
          </h2>
        </div>
        <button type="button" class="btn btn-primary" id="admin-register-link">Link für neue Person erstellen</button>
        <div class="stack">${accountRows || '<span class="muted">Keine aktiven echten Konten vorhanden.</span>'}</div>
        <div class="section-title">Aktive Einladungslinks</div>
        <div class="stack">${activeInvitesLoading && activeInvites === null ? '<span class="muted">Links werden geladen…</span>' : inviteRows || '<span class="muted">Keine aktiven Links.</span>'}</div>
      </section>
      <section class="card stack grouped-page-section" aria-labelledby="admin-tools-title">
        <div class="grouped-page-section-title"><h2 id="admin-tools-title">Werkzeuge</h2></div>
        <div class="two-column-card-grid">
          ${trackingEnabled ? `<div class="card admin-tool-row">
            <strong>Auswertung</strong>
            <button type="button" class="btn btn-primary btn-sm" data-navigate="leaderboard">Öffnen</button>
          </div>` : ''}
          <div class="card admin-tool-row">
            <strong>Nutzungsauswertung</strong>
            <a href="#adminFeatureUsage" class="btn btn-primary btn-sm" data-navigate="adminFeatureUsage">Öffnen</a>
          </div>
          <div class="card admin-tool-row">
            <strong>Feedback</strong>
            <a href="#adminFeedback" class="btn btn-primary btn-sm" data-navigate="adminFeedback">Öffnen</a>
          </div>
          ${seatingEnabled ? `<div class="card admin-tool-row">
            <strong>Sitzplan</strong>
            <button type="button" class="btn btn-primary btn-sm" data-navigate="seating">Öffnen</button>
          </div>` : ''}
          <div class="card admin-tool-row">
            <strong>Backup</strong>
            <button type="button" class="btn btn-primary btn-sm" id="download-backup">Herunterladen</button>
          </div>
          <div class="card admin-tool-row">
            <strong>Eventverwaltung</strong>
            <button type="button" class="btn btn-primary btn-sm" data-navigate="events">Öffnen</button>
          </div>
          ${kioskEnabled ? `<div class="card admin-tool-row">
            <strong>Kioskverwaltung</strong>
            <button type="button" class="btn btn-primary btn-sm" data-navigate="kiosk">Öffnen</button>
          </div>` : ''}
        </div>
      </section>
      ${adminModeActive ? `<section class="card stack grouped-page-section" aria-labelledby="admin-test-players-title">
        <div class="grouped-page-section-title">
          <span class="title-with-info">
            <h2 id="admin-test-players-title">Testdaten</h2>
            ${infoTooltipHtml('admin-test-data-help', 'Testdaten', TEST_DATA_HELP)}
          </span>
        </div>
        <div class="title-with-info">
          <strong>Test-Spieler</strong>
          <span class="badge badge-neutral" aria-label="${testCount} Test-Spieler vorhanden">${testCount}</span>
        </div>
        <div class="admin-test-controls">
          <input type="number" id="admin-count" value="5" min="1" max="20" aria-label="Anzahl Test-Spieler" />
          <button type="button" class="btn btn-sm btn-danger" id="admin-cleanup">Test-Daten aufräumen</button>
          <button type="button" class="btn btn-primary btn-sm" id="admin-bulk" ${seedBusy ? 'disabled' : ''}>Test-Spieler anlegen</button>
        </div>
      </section>` : ''}
      <section class="card stack grouped-page-section" aria-labelledby="admin-players-title">
        <div class="grouped-page-section-title">
          <span class="title-with-info">
            <h2 id="admin-players-title">Benutzer (${players.length})</h2>
            ${infoTooltipHtml('admin-role-help', 'Rollen', ADMIN_ROLE_HELP)}
          </span>
        </div>
        ${
          adminMembersError
            ? `<div class="notice row-between" style="gap:var(--space-2);">
                <span>Rollen konnten nicht geladen werden.</span>
                <button type="button" class="btn btn-sm" id="admin-members-retry">Erneut versuchen</button>
              </div>`
            : adminMembersLoading
              ? '<div class="muted">Rollen werden geladen…</div>'
              : ''
        }
        <div class="card">${rows || '<span class="muted">Noch keine Spieler.</span>'}</div>
      </section>
      ${trackingEnabled ? `<section class="card stack grouped-page-section" aria-labelledby="admin-agent-title">
        <div class="grouped-page-section-title">
          <h2 id="admin-agent-title" class="title-with-info">
            <span>Agent-Diagnose</span>
            ${infoTooltipHtml('admin-agent-diagnostics-help', 'Agent-Diagnose', AGENT_DIAGNOSTICS_HELP)}
          </h2>
          <button type="button" class="btn btn-sm" id="agent-diagnostics-refresh">Aktualisieren</button>
        </div>
        <div class="card stack">
          ${diagnosticsLoading && agentDiagnostics === null ? '<div class="muted">Diagnose laden…</div>' : diagnosticRows || '<span class="muted">Noch keine Spieler.</span>'}
        </div>
      </section>` : ''}
    </div>
  `;

  container.querySelector('#admin-mode-activate')?.addEventListener('click', () => {
    adminPlayers = null;
    setAdmin(true);
  });
  container.querySelector('#admin-register-link')?.addEventListener('click', () => openRegisterInviteDialog(ctx));
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

  container.querySelector('#admin-bulk')?.addEventListener('click', () => {
    const count = Math.min(20, Math.max(1, parseInt(container.querySelector('#admin-count').value, 10) || 5));
    createTestUsers(count, ctx);
  });

  container.querySelector('#admin-cleanup')?.addEventListener('click', () => cleanupTestUsers(ctx));

  container.querySelector('#download-backup').addEventListener('click', () => downloadBackup(ctx));
  wireInfoTooltips(container);

  container.querySelector('#admin-readiness-refresh')?.addEventListener('click', (event) =>
    loadReadiness(ctx, true, event.currentTarget.id));
  container.querySelector('#admin-readiness-retry')?.addEventListener('click', (event) =>
    loadReadiness(ctx, true, event.currentTarget.id));
  container.querySelector('#agent-diagnostics-refresh')?.addEventListener('click', () => loadAgentDiagnostics(ctx, true));
  container.querySelector('#admin-members-retry')?.addEventListener('click', () => loadAdminMembers(ctx, true));

  container.querySelectorAll('[data-test-session]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = players.find((p) => p.id === btn.dataset.testSession);
      if (player) createLoginInvite('test_login', player, ctx);
    });
  });

  container.querySelectorAll('[data-player-role]').forEach((select) => {
    select.addEventListener('change', () => {
      const player = players.find((entry) => entry.id === select.dataset.playerRole);
      if (player) {
        select.disabled = true;
        changeRole(player, select.value, ctx);
      }
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
  const current = (state.players || []).find((player) => player.id === getMyId());
  if (!current?.is_admin) {
    if (isAdmin()) setAdmin(false);
    container.innerHTML = `
      <div class="more-subpage-header">
        <div class="more-subpage-title-row">
          <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
          <h1 class="view-title">Admin</h1>
        </div>
      </div>
      <div class="card"><p class="muted">Dieses Konto hat keine Admin-Rechte.</p></div>`;
    return;
  }
  renderPanel(container, ctx);
}
