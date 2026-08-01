// Device-local display state for the Admin view. Real permission always comes
// from the server-side session role; this flag is not a security boundary. It
// only controls whether test players are visible on this device (see
// testFilter.js).
//
// Every toggle fires 'respawn:admin-changed' on window so app.js can update the
// persistent admin banner and refetch data with the new visibility, without
// this leaf module having to import anything.

const ADMIN_KEY = 'respawn_admin';
// The former PIN unlock is retired; devices may still carry its stored value.
const ADMIN_PIN_KEY = 'respawn_admin_pin';

export function isAdmin() {
  return localStorage.getItem(ADMIN_KEY) === '1';
}

export function setAdmin(unlocked) {
  if (unlocked) {
    localStorage.setItem(ADMIN_KEY, '1');
  } else {
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ADMIN_PIN_KEY);
  }
  window.dispatchEvent(new CustomEvent('respawn:admin-changed'));
}
