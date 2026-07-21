import { api, GROUP_KEY } from './api.js';
import { confirmDialog, openModal } from './modal.js';
import { withStepUp } from './reauth.js';
import { showToast } from './toast.js';
import { escapeHtml } from './format.js';
import { getMyId } from './whoami.js';

let groups = [];

function selectedGroup() {
  const storedId = sessionStorage.getItem(GROUP_KEY);
  return groups.find((group) => group.id === storedId) ?? groups[0] ?? null;
}

function mergeGroup(group) {
  groups = [...groups.filter((entry) => entry.id !== group.id), group];
}

// One instance, one group: this button is a context display ("which group
// room am I in"), not a switcher — there is nothing left to switch to.
function updateButton() {
  const button = document.getElementById('group-btn');
  const label = document.getElementById('group-btn-label');
  const group = selectedGroup();
  button.hidden = !group;
  if (!group) return;
  label.textContent = group.name;
  button.title = `Gruppendetails – ${group.name}`;
}

function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', member: 'Mitglied' }[role] ?? role;
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
      </div>`,
      {
        confirmClose: () => {
          if (!el) return null;
          const nameInput = el.querySelector('#group-edit-name');
          const descriptionInput = el.querySelector('#group-edit-description');
          if (!nameInput || !descriptionInput) return null;
          const dirty =
            nameInput.value.trim() !== (freshGroup.name ?? '') ||
            descriptionInput.value.trim() !== (freshGroup.description ?? '');
          return dirty ? 'Änderungen an Gruppenname und Beschreibung wurden nicht gespeichert.' : null;
        },
      },
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
  } catch (error) {
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
      window.dispatchEvent(new CustomEvent('respawn:group-changed', { detail: selectedGroup() }));
    }
  } catch (error) {
    if (error.status !== 401) showToast(error.message, { error: true });
  }
}

export async function initGroupContext(meta) {
  if (meta.authMode !== 'required') return;
  await refreshGroupContext();
  document.getElementById('group-btn').addEventListener('click', () => {
    const group = selectedGroup();
    if (group) openManageGroup(group);
  });
}
