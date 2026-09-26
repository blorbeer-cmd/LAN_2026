import { api } from './api.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

function requestReauthentication(title) {
  return new Promise((resolve) => {
    let submitted = false;
    const { close } = openModal(
      title || 'Passwort bestätigen',
      `<form id="reauth-form" class="stack">
        <div>
          <label for="reauth-password" class="field-label">Passwort</label>
          <div class="row">
            <input id="reauth-password" type="password" autocomplete="current-password" required autofocus style="flex:1;" />
            <button type="button" class="icon-btn" id="reauth-toggle" aria-label="Passwort anzeigen" title="Passwort anzeigen">${icon('eye')}</button>
          </div>
          <p class="profile-note reauth-note">Die Freigabe gilt fünf Minuten</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-sm" data-reauth-cancel>Abbrechen</button>
          <button type="submit" class="btn btn-primary btn-sm">Bestätigen</button>
        </div>
      </form>`,
      {
        onClose: () => {
          if (!submitted) resolve(false);
        },
        onMount: (el) => {
          const input = el.querySelector('#reauth-password');
          const toggle = el.querySelector('#reauth-toggle');
          el.querySelector('[data-reauth-cancel]').addEventListener('click', () => el.querySelector('[data-close]')?.click());
          toggle.addEventListener('click', () => {
            const visible = input.type === 'password';
            input.type = visible ? 'text' : 'password';
            toggle.innerHTML = icon(visible ? 'eyeOff' : 'eye');
            toggle.setAttribute('aria-label', visible ? 'Passwort verbergen' : 'Passwort anzeigen');
            toggle.title = toggle.getAttribute('aria-label');
          });
          el.querySelector('#reauth-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
              await api.auth.reauth(input.value);
              submitted = true;
              close();
              resolve(true);
            } catch (error) {
              showToast(error.message, { error: true });
              input.select();
            }
          });
        },
      }
    );
  });
}

// `title` names the protected action in the dialog header, e.g. "Backup herunterladen".
export async function withStepUp(action, { title = '' } = {}) {
  try {
    return await action();
  } catch (error) {
    if (error.code !== 'reauth_required') throw error;
    if (!(await requestReauthentication(title))) return undefined;
    return action();
  }
}
