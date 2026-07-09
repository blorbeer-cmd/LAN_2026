// Device-local admin state: a device becomes "admin" by unlocking with the
// admin PIN (or freely, when no PIN is configured — open/dev mode). Mirrors
// the whoami/token pattern: the flag lives in localStorage, and the PIN is
// stored so api.js can attach it as the x-admin-pin header on admin-gated
// writes (granting admin). Not a security boundary on its own — the server
// re-checks the PIN — just remembers "this phone is in admin mode".

const ADMIN_KEY = 'lan2026_admin';
const ADMIN_PIN_KEY = 'lan2026_admin_pin';

export function isAdmin() {
  return localStorage.getItem(ADMIN_KEY) === '1';
}

// The stored PIN (empty string in open mode). api.js reads this directly from
// localStorage to attach the header, so it isn't imported there (avoids a
// circular import); this getter is for view code.
export function getAdminPin() {
  return localStorage.getItem(ADMIN_PIN_KEY) || '';
}

export function setAdmin(unlocked, pin = '') {
  if (unlocked) {
    localStorage.setItem(ADMIN_KEY, '1');
    localStorage.setItem(ADMIN_PIN_KEY, pin);
  } else {
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ADMIN_PIN_KEY);
  }
}
