// Identity compatibility adapter. Legacy mode still remembers a locally
// selected player; AUTH_MODE=required locks this module to the account from
// /api/me so the many existing views can share one API without treating
// localStorage as an authority.

import { state } from './state.js';
import { escapeHtml } from './format.js';

const MY_ID_KEY = 'lan2026_my_player_id';
let sessionPlayerId = '';

export function getMyId() {
  return sessionPlayerId || localStorage.getItem(MY_ID_KEY) || '';
}

export function lockMyIdToSession(id) {
  sessionPlayerId = id;
  localStorage.removeItem(MY_ID_KEY);
  signalIdentityChanged(id);
}

export function setMyId(id) {
  if (sessionPlayerId) return;
  localStorage.setItem(MY_ID_KEY, id);
  signalIdentityChanged(id);
}

function signalIdentityChanged(id) {
  // Clears/sets the "you still need to set yourself up" dot on the profile
  // icon right away, without waiting for the next view switch to notice.
  document.getElementById('profile-btn')?.classList.toggle('needs-setup', !id);
  // Global signal for modules outside the per-view render cycle (the header
  // notification banner) that need to refetch "for the current identity"
  // data right away instead of only picking up the change whenever some
  // view next happens to render.
  window.dispatchEvent(new CustomEvent('lan:identity-changed'));
}

// Compact "who's acting here" card reused by every view that needs an
// identity before it lets you do something (vote, pause). Once this device
// has a known identity, it just states it — no need to re-pick it on every
// screen — with a "Nicht du?" escape hatch for a shared/borrowed device;
// only asks via a <select> while nobody's set up yet.
export function whoAmICardHtml(selectId, { marginBottom } = {}) {
  const me = state.players.find((p) => p.id === getMyId());
  const style = marginBottom ? ` style="margin-bottom:${marginBottom};"` : '';

  if (me) {
    return `
      <div class="card row-between"${style}>
        <span>Du bist <strong>${escapeHtml(me.name)}</strong></span>
        ${sessionPlayerId ? '' : '<button type="button" class="btn btn-sm" data-whoami-change>Nicht du?</button>'}
      </div>
    `;
  }

  return `
    <div class="card stack"${style}>
      <div class="row">
        <span style="flex-shrink:0;">Wer bist du?</span>
        <select id="${selectId}" style="flex:1;">
          <option value="">– wählen –</option>
          ${state.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row-between">
        <span class="muted" style="font-size:var(--font-size-xs);">Noch nicht dabei?</span>
        <button type="button" class="btn btn-sm" data-navigate="profile">+ Profil anlegen</button>
      </div>
    </div>
  `;
}

// Wires whichever half of whoAmICardHtml actually rendered (the picker or
// the "Nicht du?" button) — call once after setting a container's innerHTML.
export function wireWhoAmICard(container, selectId, ctx) {
  if (sessionPlayerId) return;
  container.querySelector(`#${selectId}`)?.addEventListener('change', (e) => {
    setMyId(e.target.value);
    ctx.rerender();
  });
  container.querySelector('[data-whoami-change]')?.addEventListener('click', () => {
    setMyId('');
    ctx.rerender();
  });
}
