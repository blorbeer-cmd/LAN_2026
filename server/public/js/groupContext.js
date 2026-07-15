import { api, GROUP_KEY } from './api.js';
import { openModal } from './modal.js';
import { withStepUp } from './reauth.js';
import { showToast } from './toast.js';
import { escapeHtml } from './format.js';

const DEFAULT_GROUP_ID = 'default-group';
let groups = [];
let multiGroupsEnabled = false;

function selectedGroup() {
  const storedId = sessionStorage.getItem(GROUP_KEY);
  return groups.find((group) => group.id === storedId) ?? groups[0] ?? null;
}

function selectGroup(groupId) {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) return;
  sessionStorage.setItem(GROUP_KEY, group.id);
  updateButton();
  window.dispatchEvent(new CustomEvent('lan:group-changed', { detail: group }));
}

function mergeGroup(group) {
  groups = [...groups.filter((entry) => entry.id !== group.id), group];
}

function updateButton() {
  const button = document.getElementById('group-btn');
  const label = document.getElementById('group-btn-label');
  const group = selectedGroup();
  button.hidden = !group;
  if (!group) return;
  label.textContent = group.name;
  button.title = `Gruppe wechseln – aktuell ${group.name}`;
}

function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', member: 'Mitglied' }[role] ?? role;
}

function renderGroupPicker() {
  const current = selectedGroup();
  const rows = groups
    .map(
      (group) => `<button type="button" class="group-option${group.id === current?.id ? ' is-active' : ''}" data-group-id="${escapeHtml(group.id)}">
        <span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(roleLabel(group.role))}</small></span>
        ${group.id === current?.id ? '<span aria-hidden="true">✓</span>' : ''}
      </button>`,
    )
    .join('');
  const foundationNotice = current?.id !== DEFAULT_GROUP_ID
    ? '<p class="notice notice-warning">Gruppen-Vorschau: Fach- und Trackingdaten werden erst in den folgenden Phasen nach Gruppen getrennt.</p>'
    : '';
  const management = multiGroupsEnabled
    ? `<div class="group-actions">
        <button type="button" class="btn" id="group-create-btn">Gruppe anlegen</button>
        ${current && ['owner', 'admin'].includes(current.role) ? '<button type="button" class="btn" id="group-invite-btn">Einladungslink</button>' : ''}
      </div>`
    : '';
  const { close, el } = openModal(
    'Meine Gruppen',
    `<div class="stack">${foundationNotice}<div class="group-list">${rows}</div>${management}</div>`,
  );
  el.querySelectorAll('[data-group-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectGroup(button.dataset.groupId);
      close();
      showToast(`Gruppe „${selectedGroup().name}“ ausgewählt.`);
    });
  });
  el.querySelector('#group-create-btn')?.addEventListener('click', () => {
    close();
    openCreateGroup();
  });
  el.querySelector('#group-invite-btn')?.addEventListener('click', () => {
    close();
    createInviteLink(current);
  });
}

function openCreateGroup() {
  const { close, el } = openModal(
    'Gruppe anlegen',
    `<form id="group-create-form" class="stack">
      <label><span class="field-label">Name</span><input id="group-name" maxlength="80" required autofocus /></label>
      <label><span class="field-label">Beschreibung (optional)</span><textarea id="group-description" maxlength="500" rows="3"></textarea></label>
      <p class="notice notice-warning">Die Gruppe ist zunächst eine Vorschau. Fach- und Trackingdaten bleiben bis zum Abschluss der Mandantentrennung in der Startgruppe.</p>
      <button class="btn btn-primary" type="submit">Gruppe anlegen</button>
    </form>`,
  );
  el.querySelector('#group-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const created = await api.groups.create({
        name: el.querySelector('#group-name').value.trim(),
        description: el.querySelector('#group-description').value.trim() || null,
      });
      mergeGroup(created);
      selectGroup(created.id);
      close();
      showToast('Gruppe angelegt.');
    } catch (error) {
      showToast(error.message, { error: true });
    }
  });
}

async function createInviteLink(group) {
  try {
    const invite = await withStepUp(() => api.groups.createInvite(group.id));
    if (!invite) return;
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('groupInvite', invite.code);
    const { el } = openModal(
      'Gruppeneinladung',
      `<div class="stack"><p>Dieser Link kann einmalig bis zum Ablaufdatum verwendet werden.</p>
       <label><span class="field-label">Einladungslink</span><input id="group-invite-link" readonly value="${escapeHtml(url.toString())}" /></label>
       <button type="button" class="btn btn-primary" id="group-copy-invite">Link kopieren</button></div>`,
    );
    el.querySelector('#group-copy-invite').addEventListener('click', async () => {
      await navigator.clipboard.writeText(url.toString());
      showToast('Einladungslink kopiert.');
    });
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

async function handleInviteFromUrl() {
  const url = new URL(location.href);
  const code = url.searchParams.get('groupInvite');
  if (!code || !multiGroupsEnabled) return;
  try {
    const preview = await api.groups.invitePreview(code);
    const { close, el } = openModal(
      'Gruppeneinladung',
      `<div class="stack"><p>Du wurdest in die Gruppe <strong>${escapeHtml(preview.group.name)}</strong> eingeladen.</p>
       ${preview.invitedByName ? `<p class="muted">Eingeladen von ${escapeHtml(preview.invitedByName)}</p>` : ''}
       <button type="button" class="btn btn-primary" id="group-accept-invite" ${preview.alreadyMember ? 'disabled' : ''}>${preview.alreadyMember ? 'Bereits Mitglied' : 'Einladung annehmen'}</button></div>`,
    );
    el.querySelector('#group-accept-invite')?.addEventListener('click', async () => {
      try {
        const accepted = await api.groups.acceptInvite(code);
        mergeGroup(accepted);
        selectGroup(accepted.id);
        url.searchParams.delete('groupInvite');
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
        close();
        showToast(`Willkommen in „${accepted.name}“.`);
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
  } catch (error) {
    url.searchParams.delete('groupInvite');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    showToast(error.message, { error: true });
  }
}

export async function refreshGroupContext() {
  try {
    groups = await api.groups.list();
    const storedId = sessionStorage.getItem(GROUP_KEY);
    if (!groups.some((group) => group.id === storedId) && groups[0]) {
      sessionStorage.setItem(GROUP_KEY, groups[0].id);
    }
    updateButton();
  } catch (error) {
    if (error.status !== 401) showToast(error.message, { error: true });
  }
}

export async function initGroupContext(meta) {
  if (meta.authMode !== 'required') return;
  multiGroupsEnabled = meta.multiGroupsEnabled === true;
  await refreshGroupContext();
  document.getElementById('group-btn').addEventListener('click', renderGroupPicker);
  await handleInviteFromUrl();
}
