import { api } from './api.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

function requestReauthentication() {
  return new Promise((resolve) => {
    let submitted = false;
    const { close } = openModal(
      'Passwort bestätigen',
      `<form id="reauth-form" class="stack">
        <p class="muted" style="margin:0;">Diese sicherheitskritische Aktion wird für fünf Minuten freigeschaltet.</p>
        <div class="row">
          <input id="reauth-password" type="password" autocomplete="current-password" required autofocus style="flex:1;" placeholder="Dein Passwort" />
          <button type="button" class="icon-btn" id="reauth-toggle" aria-label="Passwort anzeigen" title="Passwort anzeigen">${icon('eye')}</button>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Bestätigen</button>
      </form>`,
      {
        onClose: () => {
          if (!submitted) resolve(false);
        },
        onMount: (el) => {
          const input = el.querySelector('#reauth-password');
          const toggle = el.querySelector('#reauth-toggle');
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

export async function withStepUp(action) {
  try {
    return await action();
  } catch (error) {
    if (error.code !== 'reauth_required') throw error;
    if (!(await requestReauthentication())) return undefined;
    return action();
  }
}
