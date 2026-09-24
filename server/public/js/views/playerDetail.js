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

// Bock and Skill share one row per game instead of two stacked lists: a
// person's profile reads as "what do they like and how good are they" at a
// glance. Sorting starts on Bock (the order carries meaning here); games
// without any value are left out.
const SORT_LABELS = { name: 'Spiel', bock: 'Bock', skill: 'Skill' };

function ratingTableRows(playerId) {
  return state.games
    .map((game) => ({
      name: game.name,
      bock: state.preferences.find((entry) => entry.player_id === playerId && entry.game_id === game.id)?.rating ?? null,
      skill: state.skills.find((entry) => entry.player_id === playerId && entry.game_id === game.id)?.rating ?? null,
    }))
    .filter((row) => row.bock !== null || row.skill !== null);
}

function sortRows(rows, key, direction) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    if (key === 'name') return direction === 'asc' ? byName(a, b) : byName(b, a);
    if (a[key] === null && b[key] === null) return byName(a, b);
    if (a[key] === null) return 1;
    if (b[key] === null) return -1;
    const difference = a[key] - b[key] || byName(a, b);
    return direction === 'asc' ? difference : -difference;
  });
}

function sortButtonHtml(key, sort) {
  const isActive = sort.key === key;
  const directionLabel = sort.direction === 'asc' ? 'aufsteigend' : 'absteigend';
  return `<button type="button" class="player-detail-sort-button${isActive ? ' is-active' : ''}" data-player-detail-sort="${key}"
    aria-pressed="${isActive}" aria-label="${SORT_LABELS[key]}: ${isActive ? directionLabel : 'nicht sortiert'}">
    <span>${SORT_LABELS[key]}</span>${isActive ? icon(sort.direction === 'asc' ? 'arrowUp' : 'arrowDown') : ''}
  </button>`;
}

export function openPlayerDetail(playerId) {
  const player = playerById(playerId);
  if (!player) return;

  const rows = ratingTableRows(playerId);
  const sort = { key: 'bock', direction: 'desc' };
  let bodyEl;

  function render() {
    const sorted = sortRows(rows, sort.key, sort.direction);
    bodyEl.innerHTML = `
      <div class="stack">
        <div class="row player-detail-head">
          ${avatarHtml(player, 48)}
          <div class="stack" style="gap:var(--space-1);min-width:0;">
            ${player.real_name ? `<span>${escapeHtml(player.real_name)}</span>` : ''}
            <span class="muted">${rows.length ? `${rows.length} ${rows.length === 1 ? 'Spiel' : 'Spiele'} bewertet` : 'Noch nichts bewertet'}</span>
          </div>
        </div>
        ${
          rows.length
            ? `<table class="player-detail-ratings">
                 <colgroup><col /><col class="player-detail-rating-col" /><col class="player-detail-rating-col" /></colgroup>
                 <thead><tr>
                   <th scope="col">${sortButtonHtml('name', sort)}</th>
                   <th scope="col">${sortButtonHtml('bock', sort)}</th>
                   <th scope="col">${sortButtonHtml('skill', sort)}</th>
                 </tr></thead>
                 <tbody>${sorted
                   .map((row) => `<tr>
                     <th scope="row">${escapeHtml(row.name)}</th>
                     <td>${row.bock ?? '<span class="muted">–</span>'}</td>
                     <td>${row.skill ?? '<span class="muted">–</span>'}</td>
                   </tr>`)
                   .join('')}</tbody>
               </table>`
            : ''
        }
      </div>`;
    bodyEl.querySelectorAll('[data-player-detail-sort]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.playerDetailSort;
        if (sort.key === key) sort.direction = sort.direction === 'asc' ? 'desc' : 'asc';
        else {
          sort.key = key;
          sort.direction = key === 'name' ? 'asc' : 'desc';
        }
        render();
        bodyEl.querySelector(`[data-player-detail-sort="${key}"]`)?.focus();
      });
    });
  }

  openModal(player.name, '<div data-player-detail-body></div>', {
    onMount: (el) => {
      bodyEl = el.querySelector('[data-player-detail-body]');
      render();
    },
  });
}
