import { escapeHtml, avatarHtml } from '../format.js';

export function matchRosterHtml(players, { winnerId = null, scoreFor = null, detailFor = null } = {}) {
  return `
    <div class="arcade-roster">
      ${players
        .map((player, index) => {
          const score = scoreFor ? scoreFor(player, index) : null;
          const detail = detailFor ? detailFor(player, index) : '';
          const classes = ['arcade-player-tile'];
          if (winnerId && winnerId === player.id) classes.push('is-winner');
          return `
            <div class="${classes.join(' ')}">
              ${avatarHtml(player, 34)}
              <div class="arcade-player-tile-body">
                <strong>${escapeHtml(player.name)}</strong>
                ${score !== null && score !== undefined && score !== '' ? `<span class="arcade-player-tile-score">${escapeHtml(score)}</span>` : ''}
                ${detail ? `<span class="arcade-player-tile-detail">${escapeHtml(detail)}</span>` : ''}
              </div>
            </div>`;
        })
        .join('')}
    </div>`;
}

export function arcadeInfoGridHtml(items) {
  return `
    <div class="arcade-info-grid">
      ${items
        .map(
          (item) => `
            <div class="arcade-info-card">
              <div class="field-label">${escapeHtml(item.label)}</div>
              <div class="arcade-info-text">${escapeHtml(item.text)}</div>
            </div>`
        )
        .join('')}
    </div>`;
}
