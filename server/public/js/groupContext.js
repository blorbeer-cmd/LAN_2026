import { api, GROUP_KEY } from './api.js';
import { confirmDialog, openModal } from './modal.js';
import { withStepUp } from './reauth.js';
import { showToast } from './toast.js';
import { escapeHtml } from './format.js';
import { getMyId } from './whoami.js';

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
      (
        group,
      ) => `<button type="button" class="group-option${group.id === current?.id ? ' is-active' : ''}" data-group-id="${escapeHtml(group.id)}">
        <span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(roleLabel(group.role))}</small></span>
        ${group.id === current?.id ? '<span aria-hidden="true">✓</span>' : ''}
      </button>`,
    )
    .join('');
  const foundationNotice =
    current?.id !== DEFAULT_GROUP_ID
      ? '<p class="notice notice-warning">Gruppen-Vorschau: Fach- und Trackingdaten werden erst in den folgenden Phasen nach Gruppen getrennt.</p>'
      : '';
  const canManage = current && ['owner', 'admin'].includes(current.role);
  const management = `<div class="group-actions">
      ${multiGroupsEnabled ? '<button type="button" class="btn" id="group-create-btn">Gruppe anlegen</button>' : ''}
      ${current ? '<button type="button" class="btn" id="group-manage-btn">Gruppendetails</button>' : ''}
      ${multiGroupsEnabled && canManage ? '<button type="button" class="btn" id="group-invite-btn">Einladungslink</button>' : ''}
    </div>`;
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
  el.querySelector('#group-manage-btn')?.addEventListener('click', () => {
    close();
    openManageGroup(current);
  });
}

function roleControl(group, member) {
  const me = getMyId();
  const canChangeOwner = group.role === 'owner';
  const canChangeMember = group.role === 'admin' && member.role !== 'owner';
  if ((!canChangeOwner && !canChangeMember) || member.isTest) {
    return `<span class="badge">${escapeHtml(roleLabel(member.role))}</span>`;
  }
  const roles = canChangeOwner ? ['member', 'admin', 'owner'] : ['member', 'admin'];
  return `<select class="group-role-select" data-member-role="${escapeHtml(member.playerId)}" aria-label="Rolle von ${escapeHtml(member.name)}">
    ${roles.map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${escapeHtml(roleLabel(role))}</option>`).join('')}
  </select>${member.playerId === me ? '<small class="muted">Du</small>' : ''}`;
}

async function openManageGroup(group) {
  try {
    const [freshGroup, members, audit] = await Promise.all([
      api.groups.get(group.id),
      api.groups.members(group.id),
      ['owner', 'admin'].includes(group.role) ? api.groups.audit(group.id, 20) : Promise.resolve([]),
    ]);
    mergeGroup(freshGroup);
    const me = getMyId();
    const memberRows = members
      .map((member) => {
        const canRemove =
          member.playerId !== me &&
          (freshGroup.role === 'owner' || (freshGroup.role === 'admin' && member.role !== 'owner'));
        return `<div class="group-member-row">
          <span><strong>${escapeHtml(member.name)}</strong>${member.isTest ? '<small>Test-Spieler</small>' : ''}</span>
          <span class="group-member-actions">${roleControl(freshGroup, member)}
            ${canRemove ? `<button type="button" class="btn btn-sm" data-remove-member="${escapeHtml(member.playerId)}">Entfernen</button>` : ''}
          </span>
        </div>`;
      })
      .join('');
    const auditRows = audit.length
      ? audit
          .slice(0, 8)
          .map(
            (entry) =>
              `<li><strong>${escapeHtml(entry.actor_name ?? 'System')}</strong>: ${escapeHtml(entry.action)}</li>`,
          )
          .join('')
      : '<li class="muted">Noch keine Gruppenaktionen protokolliert.</li>';
    const destructiveActions = `<div class="group-actions">
      ${multiGroupsEnabled && freshGroup.id !== DEFAULT_GROUP_ID ? '<button type="button" class="btn" id="group-leave-btn">Gruppe verlassen</button>' : ''}
      ${multiGroupsEnabled && freshGroup.role === 'owner' && freshGroup.id !== DEFAULT_GROUP_ID ? '<button type="button" class="btn btn-danger" id="group-archive-btn">Gruppe archivieren</button>' : ''}
    </div>`;
    const groupDetails = ['owner', 'admin'].includes(freshGroup.role)
      ? `<form id="group-edit-form" class="stack">
          <label><span class="field-label">Name</span><input id="group-edit-name" maxlength="80" required value="${escapeHtml(freshGroup.name)}" /></label>
          <label><span class="field-label">Beschreibung</span><textarea id="group-edit-description" maxlength="500" rows="3">${escapeHtml(freshGroup.description ?? '')}</textarea></label>
          <button type="submit" class="btn">Grunddaten speichern</button>
        </form>`
      : `<div><h3>${escapeHtml(freshGroup.name)}</h3>${freshGroup.description ? `<p class="muted">${escapeHtml(freshGroup.description)}</p>` : ''}</div>`;
    const adminSections = ['owner', 'admin'].includes(freshGroup.role)
      ? `<details><summary>Test-Spieler</summary>
          <form id="group-test-users-form" class="row group-test-users-form">
            <input id="group-test-users-count" type="number" min="1" max="20" value="5" aria-label="Anzahl Test-Spieler" />
            <button type="submit" class="btn">Anlegen</button>
            <button type="button" class="btn" id="group-test-users-cleanup">Alle löschen</button>
          </form>
        </details>
        <details><summary>Letzte Gruppenaktionen</summary><ul class="group-audit-list">${auditRows}</ul></details>`
      : '';
    const { close, el } = openModal(
      'Gruppendetails',
      `<div class="stack">
        ${groupDetails}
        <div><h3>Mitglieder</h3><div class="group-member-list">${memberRows}</div></div>
        ${adminSections}
        ${destructiveActions}
      </div>`,
    );

    el.querySelector('#group-edit-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const updated = await api.groups.update(freshGroup.id, {
          name: el.querySelector('#group-edit-name').value.trim(),
          description: el.querySelector('#group-edit-description').value.trim() || null,
        });
        mergeGroup(updated);
        updateButton();
        showToast('Gruppendaten gespeichert.');
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
    el.querySelectorAll('[data-member-role]').forEach((select) => {
      select.addEventListener('change', async () => {
        try {
          const result = await withStepUp(() =>
            api.groups.updateMember(freshGroup.id, select.dataset.memberRole, select.value),
          );
          if (result === undefined) return;
          close();
          await refreshGroupContext();
          openManageGroup(selectedGroup());
        } catch (error) {
          showToast(error.message, { error: true });
          close();
          openManageGroup(freshGroup);
        }
      });
    });
    el.querySelectorAll('[data-remove-member]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (
          !(await confirmDialog('Die Person verliert sofort den Zugriff auf diese Gruppe.', {
            title: 'Mitglied entfernen?',
            confirmText: 'Entfernen',
            danger: true,
          }))
        )
          return;
        try {
          const result = await withStepUp(() => api.groups.removeMember(freshGroup.id, button.dataset.removeMember));
          if (result === undefined) return;
          close();
          openManageGroup(freshGroup);
        } catch (error) {
          showToast(error.message, { error: true });
        }
      });
    });
    el.querySelector('#group-test-users-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const count = Number(el.querySelector('#group-test-users-count').value);
        await api.groups.createTestUsers(freshGroup.id, count);
        close();
        openManageGroup(freshGroup);
        showToast('Test-Spieler angelegt.');
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
    el.querySelector('#group-test-users-cleanup')?.addEventListener('click', async () => {
      if (
        !(await confirmDialog('Alle Test-Spieler dieser Gruppe werden mit ihren Testdaten gelöscht.', {
          title: 'Test-Spieler löschen?',
          confirmText: 'Alle löschen',
          danger: true,
        }))
      )
        return;
      try {
        const result = await withStepUp(() => api.groups.cleanupTestUsers(freshGroup.id));
        if (result === undefined) return;
        close();
        openManageGroup(freshGroup);
        showToast('Test-Spieler gelöscht.');
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
    el.querySelector('#group-leave-btn')?.addEventListener('click', async () => {
      if (
        !(await confirmDialog('Du verlierst sofort den Zugriff auf alle Gruppeninhalte.', {
          title: 'Gruppe verlassen?',
          confirmText: 'Verlassen',
          danger: true,
        }))
      )
        return;
      try {
        const result = await withStepUp(() => api.groups.leave(freshGroup.id));
        if (result === undefined) return;
        close();
        await refreshGroupContext();
        showToast('Gruppe verlassen.');
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
    el.querySelector('#group-archive-btn')?.addEventListener('click', async () => {
      if (
        !(await confirmDialog('Alle Mitglieder verlieren den Zugriff. Die historischen Daten bleiben erhalten.', {
          title: 'Gruppe archivieren?',
          confirmText: 'Archivieren',
          danger: true,
        }))
      )
        return;
      try {
        const result = await withStepUp(() => api.groups.archive(freshGroup.id));
        if (result === undefined) return;
        close();
        await refreshGroupContext();
        showToast('Gruppe archiviert.');
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
  } catch (error) {
    showToast(error.message, { error: true });
  }
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
    let selectionChanged = false;
    if (!groups.some((group) => group.id === storedId) && groups[0]) {
      sessionStorage.setItem(GROUP_KEY, groups[0].id);
      selectionChanged = storedId !== groups[0].id;
    } else if (groups.length === 0 && storedId) {
      sessionStorage.removeItem(GROUP_KEY);
      selectionChanged = true;
    }
    updateButton();
    if (selectionChanged) {
      window.dispatchEvent(new CustomEvent('lan:group-changed', { detail: selectedGroup() }));
    }
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
