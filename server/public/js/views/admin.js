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
import { emptyStateHtml } from '../emptyState.js';
import { columnRowClass, profileRow } from '../profileRow.js';
import { actionMenuHtml, wireActionMenus } from '../actionMenu.js';
import { getMyId } from '../whoami.js';
import { currentGroup, refreshGroupContext } from '../groupContext.js';
import { eventSelectOptions } from '../eventStatus.js';

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
const adminSectionOpen = { readiness: false, invites: false, accounts: false, test: false };

const READINESS_STATUS = {
  ready: { label: 'Bereit', icon: 'circleCheck' },
  warning: { label: 'Prüfen', icon: 'info' },
  error: { label: 'Fehler', icon: 'x' },
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

function openInviteModal(invite, ctx = null) {
  const url = inviteUrl(invite);
  const usageCount = Number.isInteger(invite.usageCount) ? invite.usageCount : 0;
  const reusable = invite.reusable || (invite.purpose === 'register' && invite.expiresAt == null);
  const note = [
    invite.playerName ? invitePurposeLabel(invite.purpose) : '',
    invite.eventSelectable === false
      ? `${invite.eventName || 'Ziel-Event'} beendet, neue Konten starten in Allgemein`
      : invite.eventName || '',
    inviteValidityLabel(invite.expiresAt),
    reusable ? 'mehrfach nutzbar' : 'einmal nutzbar',
    usageCount > 0 ? `${usageCount}× genutzt` : '',
  ].filter(Boolean).map(escapeHtml).join(' · ');
  const { el, close } = openModal(
    invite.playerName || invitePurposeLabel(invite.purpose),
    `<div class="stack">
      <p class="profile-note muted">${note}</p>
      <div class="profile-rows">
        <div class="profile-row">
          <div class="profile-row-main">
            <input type="text" id="admin-invite-link" class="invite-link-field" readonly value="${escapeHtml(url)}" aria-label="Link" />
          </div>
          <div class="profile-row-action"><button type="button" class="btn btn-sm" id="admin-invite-copy">Kopieren</button></div>
        </div>
        ${profileRow({
          title: 'QR-Code',
          meta: 'Zum Scannen mit dem Handy',
          action: '<button type="button" class="btn btn-sm" id="admin-invite-qr-toggle" aria-pressed="false" aria-controls="admin-invite-qr">Anzeigen</button>',
        })}
        <div id="admin-invite-qr" class="admin-invite-qr" hidden></div>
        ${ctx ? profileRow({
          title: 'Widerrufen',
          meta: 'Der Link funktioniert danach nicht mehr',
          action: '<button type="button" class="btn btn-sm" id="admin-invite-revoke">Widerrufen</button>',
        }) : ''}
      </div>
    </div>`
  );
  el.querySelector('#admin-invite-revoke')?.addEventListener('click', async () => {
    if (await revokeLoginInvite(invite, ctx)) close();
  });
  el.querySelector('#admin-invite-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link kopiert.');
    } catch {
      showToast('Kopieren nicht möglich. Bitte manuell markieren.', { error: true });
    }
  });
  el.querySelector('#admin-invite-qr-toggle').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const qr = el.querySelector('#admin-invite-qr');
    qr.hidden = !qr.hidden;
    button.textContent = qr.hidden ? 'Anzeigen' : 'Ausblenden';
    button.setAttribute('aria-pressed', String(!qr.hidden));
    if (qr.hidden || qr.dataset.loaded) return;
    try {
      qr.innerHTML = await api.qrcode.svg(url);
      qr.dataset.loaded = '1';
    } catch (error) {
      qr.textContent = 'QR-Code konnte nicht geladen werden';
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
    const result = await withStepUp(() => api.groups.updateMember(group.id, player.id, role), { title: 'Rolle ändern' });
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
  return eventSelectOptions(events, { allEntryLabel: 'Kein Event' });
}

function registerValidityMeta(durationMs) {
  return `Bis ${formatDateTime(Date.now() + durationMs)} Uhr · mehrfach nutzbar`;
}

function openRegisterInviteDialog(ctx) {
  const eventOptions = registerInviteEventOptions();
  const { el, close } = openModal(
    'Registrierungslink',
    `<form id="admin-register-invite-form" class="stack">
      <div class="profile-rows">
        ${profileRow({
          title: '<label for="admin-register-expires">Gültig für</label>',
          meta: `<span id="admin-register-validity">${escapeHtml(registerValidityMeta(DEFAULT_REGISTER_INVITE_DURATION_MS))}</span>`,
          action: `<select id="admin-register-expires" required>
            ${REGISTER_INVITE_DURATION_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === DEFAULT_REGISTER_INVITE_DURATION_MS ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>`,
        })}
        ${profileRow({
          title: '<label for="admin-register-event">Event</label>',
          meta: 'Neue Konten treten direkt bei',
          action: `<select id="admin-register-event">
            ${eventOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}
          </select>`,
        })}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-sm" data-register-cancel>Abbrechen</button>
        <button type="submit" class="btn btn-primary btn-sm">Erstellen</button>
      </div>
    </form>`,
  );
  el.querySelector('[data-register-cancel]').addEventListener('click', () => el.querySelector('[data-close]')?.click());
  el.querySelector('#admin-register-expires').addEventListener('change', (event) => {
    el.querySelector('#admin-register-validity').textContent = registerValidityMeta(Number(event.currentTarget.value));
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
    const invite = await withStepUp(
      () => api.auth.createInvite({ purpose, ...(player ? { playerId: player.id } : {}), ...options }),
      { title: 'Link erstellen' },
    );
    if (invite === undefined) return false;
    const enriched = { ...invite, playerName: player?.name || null };
    showToast(purpose === 'register' ? 'Registrierungslink erstellt.' : 'Link erstellt.');
    openInviteModal(enriched, ctx);
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
  }))) return false;
  try {
    const result = await withStepUp(() => api.auth.revokeInvite(invite.code), { title: 'Link widerrufen' });
    if (result === undefined) return false;
    showToast('Einladungslink widerrufen.');
    await loadActiveInvites(ctx, true);
    return true;
  } catch (error) {
    showToast(error.message, { error: true });
    return false;
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
  if (!(await confirmDialog('Alle Test-Spieler und Testevents mit ihren Daten löschen?', {
    title: 'Testdaten aufräumen',
    confirmText: 'Aufräumen',
    danger: true,
  }))) return;
  try {
    const res = await withStepUp(() => api.admin.cleanupTestUsers(), { title: 'Testdaten aufräumen' });
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
    const removed = await withStepUp(() => api.players.remove(player.id), { title: 'Konto löschen' });
    if (removed === undefined) return;
    showToast('Spieler gelöscht.');
    await refreshAdminData(ctx);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function downloadBackup(ctx) {
  try {
    const result = await withStepUp(() => api.backup.download(), { title: 'Backup herunterladen' });
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
    const result = await withStepUp(() => api.players.deactivate(player.id), { title: 'Konto deaktivieren' });
    if (result === undefined) return;
    showToast('Konto deaktiviert.');
    await refreshAdminData(ctx);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

async function reactivatePlayer(player, ctx) {
  try {
    const result = await withStepUp(() => api.players.reactivate(player.id), { title: 'Konto reaktivieren' });
    if (result === undefined) return;
    showToast('Konto reaktiviert. Die Admin-Rolle bleibt aus Sicherheitsgründen entzogen.');
    await refreshAdminData(ctx);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

function inviteMeta(invite) {
  const event = invite.eventSelectable === false
    ? 'Ziel-Event beendet, Start in Allgemein'
    : invite.eventName || '';
  const usage = invite.usageCount > 0 ? `${invite.usageCount}× genutzt` : '';
  return [
    invite.playerName ? invitePurposeLabel(invite.purpose) : '',
    event,
    usage,
    formatInviteRemaining(invite.expiresAt),
  ].filter(Boolean).map(escapeHtml).join(' · ');
}

// Roles this admin may switch the account to (never the current one).
function roleTargets(player) {
  const membership = adminMembers?.find((member) => member.playerId === player.id);
  if (!membership || player.deactivated_at || player.is_test) return [];
  const myRole = currentGroup()?.role;
  const roles = myRole === 'owner'
    ? ['member', 'admin', 'owner']
    : myRole === 'admin' && membership.role !== 'owner' ? ['member', 'admin'] : [];
  return roles.filter((role) => role !== membership.role);
}

// One row per account: name, role and state on the left, every change in
// the row's "Aktion" menu (role, login link, (re)activation, delete). A row
// left with a single change shows it as a direct button instead.
function accountRowHtml(player, index, count) {
  const id = escapeHtml(player.id);
  // Your own account is deactivated or deleted from Mein Profil, never here.
  const isSelf = player.id === getMyId();
  const busy = roleChangesInFlight.has(player.id) ? ' disabled' : '';
  const actions = [
    ...roleTargets(player).map((role) =>
      `<button type="button" class="btn btn-sm" data-set-role="${role}" data-player-id="${id}"${busy}>Zum ${roleLabel(role)} machen</button>`),
    player.deactivated_at
      ? ''
      : player.is_test
        ? `<button type="button" class="btn btn-sm" data-test-session="${id}">Testsitzung öffnen</button>`
        : `<button type="button" class="btn btn-sm" data-create-login-link="${player.is_claimed ? 'reset' : 'claim'}" data-player-id="${id}">${player.is_claimed ? 'Reset-Link erstellen' : 'Claim-Link erstellen'}</button>`,
    isSelf || player.is_test
      ? ''
      : player.deactivated_at
        ? `<button type="button" class="btn btn-sm" data-reactivate-player="${id}">Reaktivieren</button>`
        : `<button type="button" class="btn btn-sm" data-deactivate-player="${id}">Deaktivieren</button>`,
    isSelf ? '' : `<button type="button" class="btn btn-sm btn-danger" data-delete-player="${id}">Löschen</button>`,
  ];
  const meta = [
    isSelf ? 'Du' : '',
    player.is_test ? 'Test-Spieler' : '',
    player.deactivated_at ? 'Deaktiviert' : !player.is_test && !player.is_claimed ? 'Noch nicht übernommen' : '',
  ].filter(Boolean).join(' · ');
  return profileRow({
    title: `<span class="player-name">${escapeHtml(player.name)}</span>`,
    meta: escapeHtml(meta),
    action: actionMenuHtml(actions, `Aktion für ${player.name}`, { key: `admin-account-${player.id}` }),
    className: columnRowClass(index, count),
  });
}

function openAgentDiagnosticsDialog(ctx) {
  const rowsHtml = () => {
    if (diagnosticsLoading && agentDiagnostics === null) return emptyStateHtml('Lädt');
    if (!agentDiagnostics?.length) return emptyStateHtml('Noch keine Spieler');
    return [...agentDiagnostics]
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'de', { numeric: true }))
      .map((entry) => profileRow({
        title: `<span class="player-name">${escapeHtml(entry.name)}</span>`,
        meta: [
          entry.online ? 'Online' : 'Offline',
          entry.agentVersion ? `v${entry.agentVersion}` : '',
          entry.lastReportAt ? `Report ${formatDateTime(entry.lastReportAt)} Uhr` : 'Noch kein Report',
          entry.processNames.length ? entry.processNames.join(', ') : '',
        ].filter(Boolean).map(escapeHtml).join(' · '),
      }))
      .join('');
  };
  const { el } = openModal(
    'Agent-Diagnose',
    `<div class="stack">
      <p class="profile-note">Der Agent meldet nur Prozesse der Spiele im Katalog · <button type="button" class="profile-link-btn" id="agent-diagnostics-refresh">Aktualisieren</button></p>
      <div class="profile-rows" id="agent-diagnostics-rows">${rowsHtml()}</div>
    </div>`,
  );
  el.querySelector('#agent-diagnostics-refresh').addEventListener('click', async () => {
    await loadAgentDiagnostics(ctx, true);
    const target = el.querySelector('#agent-diagnostics-rows');
    if (target) target.innerHTML = rowsHtml();
  });
  if (agentDiagnostics === null) {
    loadAgentDiagnostics(ctx).then(() => {
      const target = el.querySelector('#agent-diagnostics-rows');
      if (target) target.innerHTML = rowsHtml();
    });
  }
}

function openReadinessDetails(check) {
  openModal(
    check.label,
    `<div class="stack"><p class="profile-note">${escapeHtml(check.summary)}</p>
    <ul class="readiness-details">${check.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul></div>`,
  );
}

function openTestPlayersDialog(ctx) {
  const { el, close } = openModal(
    'Test-Spieler anlegen',
    `<form id="admin-test-form" class="stack">
      <div class="profile-rows">
        ${profileRow({
          title: '<label for="admin-count">Anzahl</label>',
          meta: '1 bis 20 · mit Sitzplatz, Bewertungen und Spielzeit',
          action: '<input type="number" id="admin-count" value="5" min="1" max="20" required />',
        })}
        ${profileRow({
          title: 'Testevents',
          meta: 'Dazu ein Test-LAN und ein allgemeines Testevent',
        })}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-sm" data-test-cancel>Abbrechen</button>
        <button type="submit" class="btn btn-primary btn-sm" id="admin-bulk">Anlegen</button>
      </div>
    </form>`,
  );
  el.querySelector('[data-test-cancel]').addEventListener('click', () => el.querySelector('[data-close]')?.click());
  el.querySelector('#admin-test-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const count = Math.min(20, Math.max(1, parseInt(el.querySelector('#admin-count').value, 10) || 5));
    close();
    createTestUsers(count, ctx);
  });
}

// Status as icon plus text; the icon carries the state color, the text keeps
// the meaning readable without color.
function readinessStatusHtml(key) {
  const status = READINESS_STATUS[key] || READINESS_STATUS.warning;
  return `<span class="readiness-status" data-readiness-state="${escapeHtml(key)}">${icon(status.icon)}${status.label}</span>`;
}

function readinessRows() {
  if (readinessError) {
    return profileRow({
      title: 'Bereitschaft',
      meta: 'Konnte nicht geladen werden',
      action: '<button type="button" class="btn btn-sm" id="admin-readiness-retry">Erneut versuchen</button>',
    });
  }
  if (readiness === null) return emptyStateHtml('Lädt');
  // Two columns on wide screens, filled column by column like the tools.
  const columnRows = Math.ceil(readiness.checks.length / 2);
  return `<div class="profile-rows profile-rows-columns" style="--profile-rows-count:${columnRows};">${readiness.checks
    .map((check, index) => {
      const links = [
        check.details.length
          ? `<button type="button" class="profile-link-btn" data-readiness-details="${escapeHtml(check.id)}">Details</button>`
          : '',
        check.id === 'agents' ? '<button type="button" class="profile-link-btn" id="agent-diagnostics-open">Diagnose</button>' : '',
        check.id === 'backup' ? '<button type="button" class="profile-link-btn" id="download-backup">Herunterladen</button>' : '',
      ].filter(Boolean);
      return profileRow({
        title: escapeHtml(check.label),
        meta: [escapeHtml(check.summary.replace(/\.$/, '')), ...links].join(' · '),
        action: readinessStatusHtml(check.status),
        className: `is-status ${columnRowClass(index, readiness.checks.length)}`,
      });
    })
    .join('')}</div>`;
}

function renderPanel(container, ctx) {
  if (adminPlayers === null && !adminPlayersLoading) loadAdminPlayers(ctx);
  if (adminMembers === null && !adminMembersLoading && !adminMembersError) loadAdminMembers(ctx);
  if (activeInvites === null && !activeInvitesLoading) loadActiveInvites(ctx);
  const adminModeActive = isAdmin();
  const trackingEnabled = eventHasFeature(state.activeEvent, 'tracking');
  const seatingEnabled = eventHasFeature(state.activeEvent, 'seating');
  const kioskEnabled = eventHasFeature(state.activeEvent, 'kiosk');
  const allPlayers = adminPlayers || [];
  const players = (adminModeActive ? allPlayers : allPlayers.filter((player) => !player.is_test))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }));
  const testCount = allPlayers.filter((player) => player.is_test).length;
  if (trackingEnabled && readiness === null && !readinessLoading && !readinessError) loadReadiness(ctx);

  const openTool = (title, meta, view) => ({
    title,
    meta,
    action: `<button type="button" class="btn btn-sm" data-navigate="${view}">Öffnen</button>`,
  });
  const tools = [
    trackingEnabled ? openTool('Auswertung', 'Rangliste, Statistiken und Hall of Fame', 'leaderboard') : null,
    openTool('Feedback', 'Rückmeldungen aus der App', 'adminFeedback'),
    openTool('Nutzungsauswertung', 'Welche Bereiche genutzt werden', 'adminFeatureUsage'),
    seatingEnabled ? openTool('Sitzplan', 'Plätze und sichtbare Monitore', 'seating') : null,
    kioskEnabled ? openTool('TV-Kiosk', 'Kiosk-Zugänge und Anzeige', 'kiosk') : null,
    trackingEnabled ? null : {
      title: 'Backup',
      meta: 'Datenbank als Datei',
      action: '<button type="button" class="btn btn-sm" id="download-backup">Herunterladen</button>',
    },
  ].filter(Boolean);
  // Two columns on wide screens, filled column by column like a RankedList.
  const toolColumnRows = Math.ceil(tools.length / 2);
  const toolRows = tools.map((tool, index) => profileRow({ ...tool, className: columnRowClass(index, tools.length) }));

  // Owners first, then admins, then everyone else (members, test players,
  // deactivated accounts); each group keeps the alphabetical order and gets
  // its own two-column list below a full hairline.
  const accountGroup = (player) => {
    const role = player.deactivated_at ? null : adminMembers?.find((member) => member.playerId === player.id)?.role;
    return role === 'owner' ? 0 : role === 'admin' ? 1 : 2;
  };
  const accountGroupTitles = ['Owner', 'Admins', 'Mitglieder'];
  const accountRows = [0, 1, 2]
    .map((group) => ({ group, members: players.filter((player) => accountGroup(player) === group) }))
    .filter(({ members }) => members.length > 0)
    .map(({ group, members }, groupIndex) => `<section class="admin-account-group${groupIndex > 0 ? ' profile-rows-separate' : ''}" aria-labelledby="admin-account-group-${group}">
      <h3 class="profile-group-title" id="admin-account-group-${group}">${accountGroupTitles[group]}</h3>
      <div class="profile-rows profile-rows-columns" style="--profile-rows-count:${Math.ceil(members.length / 2)};">${
        members.map((player, index) => accountRowHtml(player, index, members.length)).join('')
      }</div>
    </section>`)
    .join('');

  // Not a ranking: alphabetical by the shown title, then the one that
  // expires first.
  const inviteTitle = (invite) => invite.playerName || invitePurposeLabel(invite.purpose);
  const invites = (activeInvites || []).slice().sort((a, b) =>
    inviteTitle(a).localeCompare(inviteTitle(b), 'de', { numeric: true, sensitivity: 'base' })
    || (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  const inviteRows = invites.map((invite, index) => profileRow({
    title: escapeHtml(inviteTitle(invite)),
    meta: inviteMeta(invite),
    action: `<button type="button" class="btn btn-sm" data-show-login-link="${escapeHtml(invite.code)}">Anzeigen</button>`,
    className: columnRowClass(index, invites.length),
  })).join('');

  const testSectionHtml = adminModeActive ? `<details class="card grouped-page-section collapsible-section" data-admin-section="test" aria-labelledby="admin-test-players-title" ${adminSectionOpen.test ? 'open' : ''}>
      <summary class="collapsible-section-header"><h2 id="admin-test-players-title">Testdaten</h2><span class="collapsible-section-chevron">${icon('chevronRight')}</span></summary>
      <div class="collapsible-section-content profile-rows profile-rows-columns" style="--profile-rows-count:1;">
        ${profileRow({
          title: 'Test-Spieler',
          meta: `${testCount} vorhanden · mit Sitzplatz, Bewertungen und Spielzeit`,
          action: `<button type="button" class="btn btn-sm" id="admin-test-open" ${seedBusy ? 'disabled' : ''}>Anlegen</button>`,
          className: columnRowClass(0, 2),
        })}
        ${profileRow({
          title: 'Aufräumen',
          meta: 'Entfernt Test-Spieler und Testevents mit ihren Daten',
          action: '<button type="button" class="btn btn-sm" id="admin-cleanup">Aufräumen</button>',
          className: columnRowClass(1, 2),
        })}
      </div>
    </details>` : '';

  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Admin</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card grouped-page-section" aria-label="Werkzeuge">
        <div class="profile-rows profile-rows-columns" style="--profile-rows-count:${toolColumnRows};">${toolRows.join('')}</div>
      </section>
      ${trackingEnabled ? `<details class="card grouped-page-section collapsible-section" data-admin-section="readiness" aria-labelledby="admin-readiness-title" ${adminSectionOpen.readiness ? 'open' : ''}>
        <summary class="collapsible-section-header">
          <h2 id="admin-readiness-title">LAN-Bereitschaft</h2>
          <span class="collapsible-section-summary-end">
            ${readiness ? readinessStatusHtml(readiness.overall) : ''}
            <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
          </span>
        </summary>
        <div class="collapsible-section-content stack">
          <p class="profile-note">${readiness ? `Stand ${formatDateTime(readiness.generatedAt)} Uhr · ` : ''}<button type="button" class="profile-link-btn" id="admin-readiness-refresh" ${readinessLoading ? 'disabled' : ''}>Aktualisieren</button></p>
          <div id="admin-readiness-status" role="status" aria-live="polite" tabindex="-1">
            ${readinessRows()}
          </div>
        </div>
      </details>` : ''}
      <details class="card grouped-page-section collapsible-section" data-admin-section="invites" aria-labelledby="admin-invites-title" ${adminSectionOpen.invites ? 'open' : ''}>
        <summary class="collapsible-section-header">
          <h2 id="admin-invites-title">Einladungslinks</h2>
          <span class="collapsible-section-summary-end">
            ${activeInvites?.length ? `<span class="badge badge-offline">${activeInvites.length}</span>` : ''}
            <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
          </span>
        </summary>
        <div class="collapsible-section-content">
          <div class="profile-rows">${profileRow({
            title: 'Neuer Link',
            meta: 'Registrierung für neue Personen',
            action: '<button type="button" class="btn btn-primary btn-sm" id="admin-register-link">Link erstellen</button>',
          })}</div>
          ${activeInvites === null
            ? `<div class="profile-rows profile-rows-divided">${profileRow({ title: 'Aktive Links', meta: 'Lädt' })}</div>`
            : inviteRows
              ? `<div class="profile-rows profile-rows-columns profile-rows-divided" style="--profile-rows-count:${Math.ceil(invites.length / 2)};">${inviteRows}</div>`
              : ''}
        </div>
      </details>
      <details class="card grouped-page-section collapsible-section" data-admin-section="accounts" aria-labelledby="admin-players-title" ${adminSectionOpen.accounts ? 'open' : ''}>
        <summary class="collapsible-section-header">
          <h2 id="admin-players-title">Konten</h2>
          <span class="collapsible-section-summary-end">
            ${players.length ? `<span class="badge badge-offline">${players.length}</span>` : ''}
            <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
          </span>
        </summary>
        <div class="collapsible-section-content stack">
          ${adminMembersError ? profileRow({
            title: 'Rollen',
            meta: 'Konnten nicht geladen werden',
            action: '<button type="button" class="btn btn-sm" id="admin-members-retry">Erneut versuchen</button>',
          }) : ''}
          ${adminPlayers === null ? emptyStateHtml('Lädt') : accountRows ? `<div class="admin-account-groups">${accountRows}</div>` : emptyStateHtml('Noch keine Spieler')}
        </div>
      </details>
      ${testSectionHtml}
    </div>
  `;

  container.querySelectorAll('[data-admin-section]').forEach((section) => {
    section.addEventListener('toggle', () => {
      adminSectionOpen[section.dataset.adminSection] = section.open;
    });
  });
  container.querySelector('#admin-register-link')?.addEventListener('click', () => openRegisterInviteDialog(ctx));
  container.querySelectorAll('[data-show-login-link]').forEach((button) => {
    button.addEventListener('click', () => {
      const invite = (activeInvites || []).find((entry) => entry.code === button.dataset.showLoginLink);
      if (invite) openInviteModal(invite, ctx);
    });
  });
  const playerFor = (id) => players.find((entry) => entry.id === id);
  const wireAccount = (selector, key, action) => container.querySelectorAll(selector).forEach((button) => {
    button.addEventListener('click', () => {
      const player = playerFor(button.dataset[key]);
      if (player) action(player, button);
    });
  });
  wireAccount('[data-test-session]', 'testSession', (player) => createLoginInvite('test_login', player, ctx));
  wireAccount('[data-create-login-link]', 'playerId', (player, button) => createLoginInvite(button.dataset.createLoginLink, player, ctx));
  wireAccount('[data-reactivate-player]', 'reactivatePlayer', (player) => reactivatePlayer(player, ctx));
  wireAccount('[data-deactivate-player]', 'deactivatePlayer', (player) => deactivatePlayer(player, ctx));
  wireAccount('[data-delete-player]', 'deletePlayer', (player) => deletePlayer(player, ctx));
  wireAccount('[data-set-role]', 'playerId', (player, button) => changeRole(player, button.dataset.setRole, ctx));
  wireActionMenus(container);
  container.querySelectorAll('[data-readiness-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const check = readiness?.checks?.find((entry) => entry.id === button.dataset.readinessDetails);
      if (check) openReadinessDetails(check);
    });
  });
  container.querySelector('#admin-test-open')?.addEventListener('click', () => openTestPlayersDialog(ctx));
  container.querySelector('#admin-cleanup')?.addEventListener('click', () => cleanupTestUsers(ctx));
  container.querySelector('#download-backup')?.addEventListener('click', () => downloadBackup(ctx));
  container.querySelector('#agent-diagnostics-open')?.addEventListener('click', () => openAgentDiagnosticsDialog(ctx));
  container.querySelector('#admin-readiness-refresh')?.addEventListener('click', (event) =>
    loadReadiness(ctx, true, event.currentTarget.id));
  container.querySelector('#admin-readiness-retry')?.addEventListener('click', (event) =>
    loadReadiness(ctx, true, event.currentTarget.id));
  container.querySelector('#admin-members-retry')?.addEventListener('click', () => loadAdminMembers(ctx, true));
}

export function renderAdmin(container, ctx) {
  const current = (state.players || []).find((player) => player.id === getMyId());
  // Right after a reload the player list may not be loaded yet; only a loaded
  // non-admin account may switch the device-local admin mode off.
  if (!current) {
    container.innerHTML = `
      <div class="more-subpage-header">
        <div class="more-subpage-title-row">
          <h1 class="view-title">Admin</h1>
        </div>
      </div>
      ${emptyStateHtml('Lädt')}`;
    return;
  }
  if (!current.is_admin) {
    if (isAdmin()) setAdmin(false);
    container.innerHTML = `
      <div class="more-subpage-header">
        <div class="more-subpage-title-row">
          <h1 class="view-title">Admin</h1>
        </div>
      </div>
      <div class="card"><p class="muted">Dieses Konto hat keine Admin-Rechte.</p></div>`;
    return;
  }
  renderPanel(container, ctx);
}
