// Real per-user login gate (see docs/KONZEPT-USER-MANAGEMENT.md). Only ever
// runs once the server reports authMode: 'required' via /api/meta — while
// AUTH_MODE stays 'legacy' (the default), app.js never calls ensureLogin()
// at all, so nothing about today's whoami.js-based identity changes.
//
// Once logged in, bridges into that same whoami.js identity via setMyId()
// so the rest of the app keeps working unchanged — replacing whoami.js's
// client-picked identity with the session's is a separate, later change
// (Phase 2), not this one.

import { api } from './api.js';
import { setMyId } from './whoami.js';
import { escapeHtml } from './format.js';

function paramFromUrl(name) {
  return new URLSearchParams(location.search).get(name);
}

// Whether real per-user login is active for this session — true exactly
// when ensureLogin() below has run (app.js only calls it while the server
// reports authMode: 'required'). Read by profile.js to decide between the
// old "Nicht du?" identity switcher (meaningless once a real, password-
// backed session exists) and a real "Abmelden" that clears the session.
export let authRequired = false;

export async function logout() {
  try {
    await api.auth.logout();
  } finally {
    // Simplest correct reset: every piece of client state that assumed a
    // logged-in identity (whoami's stored id, in-memory view state, socket
    // subscriptions) goes away with a fresh load, which re-shows the gate.
    location.reload();
  }
}

function cardShell(title, subtitle, bodyHtml) {
  return `
    <form id="auth-form" class="login-card">
      <img class="login-logo" src="/img/logo.svg" alt="" width="72" height="72" />
      <h1 class="brand-title">${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(subtitle)}</p>
      ${bodyHtml}
      <p id="auth-error" class="error-text" hidden></p>
    </form>
  `;
}

function nameField() {
  return `
    <div>
      <label for="auth-name" class="field-label">Name</label>
      <input id="auth-name" type="text" autocomplete="username" required autofocus />
    </div>
  `;
}

function passwordField({ autofocus = false, autocomplete = 'current-password', label = 'Passwort' } = {}) {
  return `
    <div>
      <label for="auth-password" class="field-label">${escapeHtml(label)}</label>
      <input id="auth-password" type="password" autocomplete="${autocomplete}" required minlength="8" ${autofocus ? 'autofocus' : ''} />
    </div>
  `;
}

function renderLoginForm() {
  return cardShell(
    'RespawnHQ',
    'Melde dich mit Name und Passwort an.',
    `${nameField()}${passwordField()}<button type="submit" class="btn btn-primary">Anmelden</button>`
  );
}

function renderRegisterForm() {
  return cardShell(
    'RespawnHQ',
    'Willkommen! Leg dein Konto an.',
    `${nameField()}${passwordField({ autocomplete: 'new-password', label: 'Passwort (mind. 8 Zeichen)' })}<button type="submit" class="btn btn-primary">Konto anlegen</button>`
  );
}

function renderClaimForm() {
  return cardShell(
    'RespawnHQ',
    'Setze ein Passwort für dein bestehendes Konto.',
    `${passwordField({ autofocus: true, autocomplete: 'new-password', label: 'Passwort (mind. 8 Zeichen)' })}<button type="submit" class="btn btn-primary">Passwort setzen</button>`
  );
}

// Resolves once this device is logged in — either because a still-valid
// session already exists (GET /api/me succeeds), or after the visitor
// completes whichever form applies (login by default, or register/claim
// when the URL carries the matching invite code).
export async function ensureLogin() {
  authRequired = true;
  try {
    const me = await api.me();
    setMyId(me.id);
    return;
  } catch {
    // No valid session yet — fall through to the gate below.
  }

  const inviteCode = paramFromUrl('invite');
  const claimCode = paramFromUrl('claim');
  const mode = inviteCode ? 'register' : claimCode ? 'claim' : 'login';

  const screen = document.getElementById('auth-screen');
  screen.innerHTML = mode === 'register' ? renderRegisterForm() : mode === 'claim' ? renderClaimForm() : renderLoginForm();
  screen.hidden = false;

  return new Promise((resolve) => {
    const form = screen.querySelector('#auth-form');
    const errorEl = screen.querySelector('#auth-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const password = screen.querySelector('#auth-password').value;

      try {
        let me;
        if (mode === 'register') {
          const name = screen.querySelector('#auth-name').value.trim();
          me = await api.auth.register({ code: inviteCode, name, password });
        } else if (mode === 'claim') {
          me = await api.auth.claim({ code: claimCode, password });
        } else {
          const name = screen.querySelector('#auth-name').value.trim();
          me = await api.auth.login({ name, password });
        }
        setMyId(me.id);
        // Drop the invite/claim code from the URL once it's been used —
        // reloading the page must not re-attempt (and fail) the same
        // already-consumed code.
        history.replaceState(null, '', `${location.pathname}${location.hash}`);
        screen.hidden = true;
        resolve();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
    });
  });
}
