import { escapeHtml, avatarHtml } from '../format.js';

const ARCADE_EXPANDED_KEY = 'lan-arcade-expanded';

export function arcadeExpandControlHtml() {
  return `
    <div class="arcade-expand-control">
      <button type="button" class="btn btn-sm" data-arcade-expand aria-pressed="false">
        <span data-arcade-expand-label>Spielfläche vergrößern</span>
      </button>
    </div>`;
}

export function wireArcadeExpandControl(container) {
  const shell = container.querySelector('.arcade-game-shell');
  const button = container.querySelector('[data-arcade-expand]');
  const label = container.querySelector('[data-arcade-expand-label]');
  if (!shell || !button || !label) return;

  let expanded = false;
  try {
    expanded = window.localStorage.getItem(ARCADE_EXPANDED_KEY) === 'true';
  } catch {
    // Private browsing modes may deny localStorage; the toggle still works.
  }

  const apply = (value) => {
    expanded = value;
    shell.classList.toggle('is-expanded', expanded);
    button.setAttribute('aria-pressed', String(expanded));
    label.textContent = expanded ? 'Spielfläche verkleinern' : 'Spielfläche vergrößern';
    try {
      window.localStorage.setItem(ARCADE_EXPANDED_KEY, String(expanded));
    } catch {
      // The preference is optional and must not block playing.
    }
  };

  apply(expanded);
  button.addEventListener('click', () => apply(!expanded));
}

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
