// Real per-user login gate (see docs/KONZEPT-USER-MANAGEMENT.md). Only ever
// runs once the server reports authMode: 'required' via /api/meta — while
// AUTH_MODE stays 'legacy' (the default), app.js never calls ensureLogin()
// at all, so legacy deployments keep today's whoami.js-based identity.
// Required mode locks the compatibility adapter to /api/me; feature routes
// independently bind every actor playerId to that verified server session.

import { api } from './api.js';
import { lockMyIdToSession } from './whoami.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { detachPushSubscription, rebindExistingPushSubscription } from './push.js';
import { setAdmin } from './admin.js';

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
    await detachPushSubscription().catch(() => {});
    await api.auth.logout();
    setAdmin(false);
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

function passwordField({ autofocus = false, autocomplete = 'current-password', label = 'Passwort', passphraseHint = false } = {}) {
  return `
    <div>
      <label for="auth-password" class="field-label">${escapeHtml(label)}</label>
      <div class="row">
        <input id="auth-password" style="flex:1;min-width:0;" type="password" autocomplete="${autocomplete}" required minlength="15" ${autofocus ? 'autofocus' : ''} />
        <button type="button" class="btn btn-sm" data-password-toggle aria-label="Passwort anzeigen" title="Passwort anzeigen">${icon('eye')}</button>
      </div>
      ${passphraseHint ? '<p class="muted" style="font-size:var(--font-size-xs);">Drei Wörter reichen – eine lange Passphrase ist besser als Zeichensalat.</p>' : ''}
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
    `${nameField()}${passwordField({ autocomplete: 'new-password', label: 'Passwort (mind. 15 Zeichen)', passphraseHint: true })}<button type="submit" class="btn btn-primary">Konto anlegen</button>`
  );
}

function renderClaimForm() {
  return cardShell(
    'RespawnHQ',
    'Setze ein Passwort für dein bestehendes Konto.',
    `${passwordField({ autofocus: true, autocomplete: 'new-password', label: 'Passwort (mind. 15 Zeichen)', passphraseHint: true })}<button type="submit" class="btn btn-primary">Passwort setzen</button>`
  );
}

function renderResetForm() {
  return cardShell(
    'RespawnHQ',
    'Lege ein neues Passwort für dein Konto fest.',
    `${passwordField({ autofocus: true, autocomplete: 'new-password', label: 'Neues Passwort (mind. 15 Zeichen)', passphraseHint: true })}<button type="submit" class="btn btn-primary">Passwort zurücksetzen</button>`
  );
}

// Resolves once this device is logged in — either because a still-valid
// session already exists (GET /api/me succeeds), or after the visitor
// completes whichever form applies (login by default, or register/claim
// when the URL carries the matching invite/reset code).
export async function ensureLogin() {
  authRequired = true;
  const inviteCode = paramFromUrl('invite');
  const claimCode = paramFromUrl('claim');
  const resetCode = paramFromUrl('reset');
  const mode = inviteCode ? 'register' : claimCode ? 'claim' : resetCode ? 'reset' : 'login';

  // Process action links even when this browser already holds a session.
  // Shared party devices commonly still have somebody else logged in.
  if (mode === 'login') {
    try {
      const me = await api.me();
      lockMyIdToSession(me.id);
      setAdmin(Boolean(me.isAdmin));
      await rebindExistingPushSubscription(me.id).catch(() => {});
      return;
    } catch {
      // No valid session yet; fall through to the login gate below.
    }
  }

  const screen = document.getElementById('auth-screen');
  screen.innerHTML =
    mode === 'register'
      ? renderRegisterForm()
      : mode === 'claim'
        ? renderClaimForm()
        : mode === 'reset'
          ? renderResetForm()
          : renderLoginForm();
  screen.hidden = false;

  screen.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = screen.querySelector('#auth-password');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      const label = show ? 'Passwort verbergen' : 'Passwort anzeigen';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.innerHTML = icon(show ? 'eyeOff' : 'eye');
    });
  });

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
        } else if (mode === 'reset') {
          me = await api.auth.reset({ code: resetCode, newPassword: password });
        } else {
          const name = screen.querySelector('#auth-name').value.trim();
          me = await api.auth.login({ name, password });
        }
        lockMyIdToSession(me.id);
        setAdmin(Boolean(me.isAdmin));
        await rebindExistingPushSubscription(me.id).catch(() => {});
        // Drop the invite/claim/reset code from the URL once it's been used —
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
