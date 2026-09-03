import { escapeHtml, avatarHtml } from '../format.js';
import { arcadeMuteControlHtml, wireArcadeMuteControl } from './arcadeSound.js';

const ARCADE_EXPANDED_KEY = 'lan-arcade-expanded';

// Every expanded playfield (`.arcade-game-shell.is-expanded ...`) sizes its
// width off a shared `--arcade-h-budget` height budget (default: a fixed
// `100dvh - 18rem` guess in style.css). That guess works for the game with
// the least surrounding UI but clips the score/chat/controls of games with
// more of it. This measures the *actual* leftover space in the scrollable
// view and, only when the guess overflows it, shrinks the shared budget by
// exactly the overflow amount so every game's formula stays correct.
const ARCADE_PLAYFIELD_SELECTOR = '.scribble-canvas-wrap, .blobby-court, .pong-arena, .snake-game, .tetris-canvas-wrap';

function syncExpandedPlayfieldHeight(shell) {
  if (!shell.classList.contains('is-expanded')) {
    shell.style.removeProperty('--arcade-h-budget');
    return;
  }
  const viewContainer = shell.closest('.view-container');
  const playfield = shell.querySelector(ARCADE_PLAYFIELD_SELECTOR);
  if (!viewContainer || !playfield) return;
  // Reset to the CSS default before measuring so repeated calls (resize,
  // re-render) converge instead of ratcheting the height down each time.
  shell.style.removeProperty('--arcade-h-budget');
  requestAnimationFrame(() => {
    if (!shell.isConnected || !shell.classList.contains('is-expanded')) return;
    const overflow = viewContainer.scrollHeight - viewContainer.clientHeight;
    if (overflow <= 0) return;
    // The playfield's own current rendered height is the most reliable source
    // for the CSS budget. Measuring it directly instead of reconstructing
    // "100dvh - 18rem" from window.innerHeight avoids a second hardcoded 18rem
    // and sidesteps dvh/innerHeight drift on mobile browsers with a collapsing
    // address bar.
    const currentHeight = playfield.getBoundingClientRect().height;
    // A spectator Tetris Arena has no primary board. Its first opponent board
    // is half as tall as the shared budget, so convert the measured height back
    // to that budget before shrinking it.
    const budgetScale = playfield.closest('.tetris-opponent-grid.is-spectator') ? 2 : 1;
    const tetrisBoards = shell.querySelector('.tetris-boards.is-arena');
    const opponentGrid = tetrisBoards?.querySelector('.tetris-opponent-grid');
    if (tetrisBoards && opponentGrid) {
      // Arena opponents can span multiple grid rows. The first canvas alone
      // does not describe the layout height, so derive the budget from the
      // complete board group and its actual row count before applying the
      // overflow correction.
      const columns = getComputedStyle(opponentGrid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length || 1;
      const rows = Math.ceil(opponentGrid.children.length / columns);
      const rowGap = Number.parseFloat(getComputedStyle(opponentGrid).rowGap) || 0;
      const currentBudget = currentHeight * budgetScale;
      const currentBoardHeight = tetrisBoards.getBoundingClientRect().height;
      const scalableBoardHeight = Math.max(1, currentBoardHeight - rowGap * Math.max(0, rows - 1));
      const layoutScale = scalableBoardHeight / Math.max(1, currentBudget);
      const target = Math.max(160, (scalableBoardHeight - overflow) / layoutScale - 8);
      shell.style.setProperty('--arcade-h-budget', `${target}px`);
      return;
    }
    const target = Math.max(160, (currentHeight - overflow) * budgetScale - 8);
    shell.style.setProperty('--arcade-h-budget', `${target}px`);
  });
}

export function arcadeExpandControlHtml() {
  return `
    <div class="arcade-expand-control">
      <button type="button" class="btn btn-sm" data-arcade-expand aria-pressed="false">
        <span data-arcade-expand-label>Spielfläche vergrößern</span>
      </button>
    </div>`;
}

// Combines the mute toggle with the expand control in one right-aligned row
// so every game exposes both from the same shell header instead of each view
// wiring its own placement.
export function arcadeToolbarHtml() {
  return `<div class="arcade-toolbar">${arcadeMuteControlHtml()}${arcadeExpandControlHtml()}</div>`;
}

export function wireArcadeToolbar(container) {
  wireArcadeMuteControl(container);
  wireArcadeExpandControl(container);
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
    syncExpandedPlayfieldHeight(shell);
  };

  apply(expanded);
  button.addEventListener('click', () => apply(!expanded));
  resizeTrackedShell = shell;
}

// Every game view replaces its container's innerHTML (and thus `shell`) on
// each re-render, so a per-call `resize` listener would pile up detached
// listeners over a long-running session. One shared listener always reads
// whichever shell was wired most recently instead.
let resizeTrackedShell = null;
window.addEventListener('resize', () => {
  if (resizeTrackedShell?.isConnected) syncExpandedPlayfieldHeight(resizeTrackedShell);
});

export function matchRosterHtml(players, { winnerId = null, winnerIds = [], scoreFor = null, detailFor = null } = {}) {
  const winners = new Set(winnerIds);
  return `
    <div class="arcade-roster">
      ${players
        .map((player, index) => {
          const score = scoreFor ? scoreFor(player, index) : null;
          const detail = detailFor ? detailFor(player, index) : '';
          const classes = ['arcade-player-tile'];
          if ((winnerId && winnerId === player.id) || winners.has(player.id)) classes.push('is-winner');
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
