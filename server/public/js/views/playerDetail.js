// Read-only profile details for another participant. This used to be the
// payload of a separate "Spieler" area; the roster itself was removed because
// Home's Live-Status already lists everyone. The detail dialog stays, opened
// straight from a live card or from a global-search hit, so looking somebody
// up costs one tap instead of a detour through an extra area.
//
// Editing deliberately stays in "Mein Profil": a device may only change the
// identity it currently represents.

import { state, playerById } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { openModal } from '../modal.js';
import { icon } from '../icons.js';

export function openPlayerDetail(playerId) {
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
        ${
          state.games.length > 0
            ? `<details class="collapsible-section">
                 <summary class="collapsible-section-header">
                   <h2>Bock &amp; Skill</h2>
                   <span class="collapsible-section-summary-end">
                     <span class="badge badge-offline">${state.games.length}</span>
                     <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                   </span>
                 </summary>
                 <div class="collapsible-section-content">
                   <div class="section-title">Bock-o-Meter</div>${ratingRows('bock')}<div class="section-title">Skill-Ratings</div>${ratingRows('skill')}
                 </div>
               </details>`
            : ''
        }
      </div>
    `
  );
}
