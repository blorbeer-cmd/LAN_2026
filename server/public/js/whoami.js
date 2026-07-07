// Shared "who am I" identity: the tool has no per-person login (just the
// shared access token), so each phone remembers locally which player it
// belongs to. Used by both the voting and live-status views.

import { state } from './state.js';
import { escapeHtml } from './format.js';

const MY_ID_KEY = 'lan2026_my_player_id';

export function getMyId() {
  return localStorage.getItem(MY_ID_KEY) || '';
}

export function setMyId(id) {
  localStorage.setItem(MY_ID_KEY, id);
  // Clears/sets the "you still need to set yourself up" dot on the profile
  // icon right away, without waiting for the next view switch to notice.
  document.getElementById('profile-btn')?.classList.toggle('needs-setup', !id);
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
        <button type="button" class="btn btn-sm" data-whoami-change>Nicht du?</button>
      </div>
    `;
  }

  return `
    <div class="card stack"${style}>
      <div class="row">
        <span style="flex:1;">Wer bist du?</span>
        <select id="${selectId}">
          <option value="">– wählen –</option>
          ${state.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row-between">
        <span class="muted" style="font-size:0.8rem;">Noch nicht dabei?</span>
        <button type="button" class="btn btn-sm" data-navigate="profile">+ Profil anlegen</button>
      </div>
    </div>
  `;
}

// Wires whichever half of whoAmICardHtml actually rendered (the picker or
// the "Nicht du?" button) — call once after setting a container's innerHTML.
export function wireWhoAmICard(container, selectId, ctx) {
  container.querySelector(`#${selectId}`)?.addEventListener('change', (e) => {
    setMyId(e.target.value);
    ctx.rerender();
  });
  container.querySelector('[data-whoami-change]')?.addEventListener('click', () => {
    setMyId('');
    ctx.rerender();
  });
}
