// Device-local display state for the legacy one-tap Admin view. Required auth
// derives the real permission from the server-side session role. This flag is
// not a security boundary —
// it just remembers "this phone is in admin mode" and controls whether test
// players are visible (see testFilter.js).
//
// Every toggle fires 'lan:admin-changed' on window so app.js can update the
// persistent admin banner and refetch data with the new visibility, without
// this leaf module having to import anything.

const ADMIN_KEY = 'lan2026_admin';

export function isAdmin() {
  return localStorage.getItem(ADMIN_KEY) === '1';
}

export function setAdmin(unlocked) {
  if (unlocked) {
    localStorage.setItem(ADMIN_KEY, '1');
  } else {
    localStorage.removeItem(ADMIN_KEY);
  }
  window.dispatchEvent(new CustomEvent('lan:admin-changed'));
}
