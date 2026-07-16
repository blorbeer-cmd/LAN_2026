// Players view (FR-05..08, FR-15): public roster with read-only profile
// details. Editing stays in "Mein Profil" so a device can only change the
// identity it currently represents.

import { state, playerById } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { openModal } from '../modal.js';
import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';
import { getMyId } from '../whoami.js';

export function renderPlayers(container) {
  const myId = getMyId();
  const rows = state.players
    .map(
      (p) => `
      <button type="button" class="card row list-row" data-player="${p.id}">
        ${avatarHtml(p, 36)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        ${p.id === myId ? '<span class="muted">Mein Profil</span>' : ''}
        <span class="muted">${icon('chevronRight')}</span>
      </button>`
    )
    .join('');

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">Spieler</h1>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-label="Spielerliste">
        ${
          state.players.length === 0
            ? `<div class="empty-state"><span class="empty-state-icon">${icon(domainIcon('players'))}</span>Noch keine Spieler.</div>`
            : `<div class="two-column-card-grid player-roster-grid">${rows}</div>`
        }
      </section>
    </div>
  `;

  // Player creation intentionally stays out of this public roster until the
  // future authenticated user-management flow owns identities and access.
  container.querySelectorAll('[data-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.player === getMyId()) {
        window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'profile' }));
        return;
      }
      openPlayerDetail(btn.dataset.player);
    });
  });
}

function openPlayerDetail(playerId) {
  const player = playerById(playerId);
  if (!player) return;

  const ratingRows = (kind) => state.games
    .map((g) => {
      const stored = kind === 'bock'
        ? state.preferences.find((entry) => entry.player_id === playerId && entry.game_id === g.id)
        : state.skills.find((entry) => entry.player_id === playerId && entry.game_id === g.id);
      return `
        <div class="skill-row">
          <span class="row" style="gap:var(--space-2);">${escapeHtml(g.name)}</span>
          <span class="skill-value">${stored?.rating ?? '–'}</span>
        </div>`;
    })
    .join('');

  openModal(
    escapeHtml(player.name),
    `
      <div class="stack">
        <div class="row">
          ${avatarHtml(player, 48)}
          <div class="stack" style="gap:var(--space-1);">
            <strong class="player-name">${escapeHtml(player.name)}</strong>
            ${player.real_name ? `<span class="muted">${escapeHtml(player.real_name)}</span>` : ''}
          </div>
        </div>
        <p class="muted" style="font-size:var(--font-size-xs);margin:0;">Dieses Profil kann nur von ${escapeHtml(player.name)} selbst bearbeitet werden.</p>
        ${state.games.length > 0 ? `<div class="section-title">Bock-o-Meter</div>${ratingRows('bock')}<div class="section-title">Skill-Ratings</div>${ratingRows('skill')}` : ''}
      </div>
    `
  );
}
