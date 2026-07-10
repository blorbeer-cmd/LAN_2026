// Seating overview (FR-18 extension): a shared picture of everyone's
// self-declared "who sits next to me" (Profil → Sitznachbarn), grouped into
// physical clusters ("Sitzgruppen") — helps newcomers find their friends in
// the room. Reached from a button on the Profil view.

import { api } from '../api.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { showToast } from '../toast.js';

let cache = null;
let loading = false;

async function load(ctx) {
  loading = true;
  try {
    cache = await api.seating.get();
  } catch (err) {
    showToast(err.message, { error: true });
    cache = { groups: [], unplacedPlayers: [] };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

export function renderSeating(container, ctx) {
  if (cache === null && !loading) load(ctx);

  const body =
    loading || cache === null
      ? `<div class="empty-state">Lädt…</div>`
      : `
      ${
        cache.groups.length === 0
          ? `<div class="empty-state"><span class="emoji">🪑</span>Noch niemand hat Sitznachbarn eingetragen.</div>`
          : cache.groups
              .map(
                (group, i) => `
              <div class="card" style="margin-bottom:var(--space-3);">
                <div class="section-title" style="margin-top:0;">Sitzgruppe ${i + 1}</div>
                <div class="stack" style="gap:var(--space-2);">
                  ${group.map((p) => `<div class="row">${avatarHtml(p, 26)} <span class="player-name">${escapeHtml(p.name)}</span></div>`).join('')}
                </div>
              </div>`
              )
              .join('')
      }
      ${
        cache.unplacedPlayers.length > 0
          ? `
        <div class="section-title">Noch keine Angabe</div>
        <div class="card chip-list">
          ${cache.unplacedPlayers.map((p) => `<span class="chip">${avatarHtml(p, 18)} ${escapeHtml(p.name)}</span>`).join('')}
        </div>`
          : ''
      }
    `;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="profile">‹ Zurück zum Profil</button>
    <h1 class="view-title">🪑 Sitzplan</h1>
    <p class="muted" style="margin-top:calc(var(--space-3) * -1);">
      Wer neben wem sitzt, so wie es alle selbst in ihrem Profil unter „Sitznachbarn" eingetragen haben.
    </p>
    ${body}
  `;
}
