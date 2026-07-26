import { api, GROUP_KEY } from './api.js';
import { showToast } from './toast.js';

let groups = [];

function selectedGroup() {
  const storedId = sessionStorage.getItem(GROUP_KEY);
  return groups.find((group) => group.id === storedId) ?? groups[0] ?? null;
}

// The server still uses the migrated start group as its internal access
// boundary. The UI no longer exposes it as a separate user-facing object.
export function currentGroup() {
  return selectedGroup();
}

// Returns true when the current user holds at least the 'admin' role in the
// internal access context. Views use this so their controls match the
// server-side authorization check.
export function isGroupAdmin() {
  const group = selectedGroup();
  return group ? ['owner', 'admin'].includes(group.role) : false;
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
}
