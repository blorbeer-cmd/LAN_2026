// Device-local admin state: a plain localStorage flag, toggled with one tap
// in the Admin view (the former PIN unlock is retired for now — see
// docs/KONZEPT-TEST-USER.md; the server-side gate still exists and can be
// re-enabled without touching this module's API). Not a security boundary —
// it just remembers "this phone is in admin mode" and controls whether test
// players are visible (see testFilter.js).
//
// Every toggle fires 'lan:admin-changed' on window so app.js can update the
// persistent admin banner and refetch data with the new visibility, without
// this leaf module having to import anything.

const ADMIN_KEY = 'lan2026_admin';
const ADMIN_PIN_KEY = 'lan2026_admin_pin';

export function isAdmin() {
  return localStorage.getItem(ADMIN_KEY) === '1';
}

// Still read by the arcade "Gegen KI" buttons, which pass it through to the
// server-side admin gate (a no-op in the default open/dev mode, see auth.ts).
// Nothing writes ADMIN_PIN_KEY anymore since the PIN-entry UI was retired,
// so this is normally empty — kept so those call sites don't have to special-case it.
export function getAdminPin() {
  return localStorage.getItem(ADMIN_PIN_KEY) ?? '';
}

export function setAdmin(unlocked) {
  if (unlocked) {
    localStorage.setItem(ADMIN_KEY, '1');
  } else {
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ADMIN_PIN_KEY);
  }
  window.dispatchEvent(new CustomEvent('lan:admin-changed'));
}
