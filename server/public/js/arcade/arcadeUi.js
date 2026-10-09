import { escapeHtml, avatarHtml } from '../format.js';
import { arcadeMuteControlHtml, wireArcadeMuteControl } from './arcadeSound.js';
import { icon } from '../icons.js';
import { playerById } from '../state.js';

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
  // After the match the result card sits above the playfield; shrinking the
  // board to fit both would only make the final position unreadable.
  if (!shell.classList.contains('is-expanded') || shell.classList.contains('is-ended')) {
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
  return `<button type="button" class="btn btn-sm arcade-icon-btn" data-arcade-expand aria-pressed="false" aria-label="Spielfläche vergrößern" title="Spielfläche vergrößern">${icon('maximize')}</button>`;
}

// Combines the mute toggle with the expand control in one right-aligned row
// so every game exposes both from the same shell header instead of each view
// wiring its own placement.
export function arcadeToolbarHtml() {
  return `<div class="arcade-toolbar">${arcadeMuteControlHtml()}${arcadeExpandControlHtml()}</div>`;
}

// Shared page header of a running game: the title on the left, the match
// controls (pause, end, leave) and the mute/expand icons on the right. Games
// replace only `.arcade-match-controls` on pause or host changes.
// `titleInfoHtml` is an optional InfoTooltip directly right of the title.
export function arcadeGameHeaderHtml(title, controlsHtml = '', { expand = true, mute = true, titleInfoHtml = '' } = {}) {
  const heading = `<h1 class="view-title">${escapeHtml(title)}</h1>`;
  return `<div class="arcade-game-header">
    ${titleInfoHtml ? `<div class="title-with-info">${heading}${titleInfoHtml}</div>` : heading}
    <div class="arcade-game-header-actions">
      ${controlsHtml}
      ${mute ? arcadeMuteControlHtml() : ''}${expand ? arcadeExpandControlHtml() : ''}
    </div>
  </div>`;
}

export function arcadeMatchControlsHtml(buttons) {
  return `<div class="arcade-match-controls">${buttons}</div>`;
}

export function pointsLabel(points) {
  return `${points} ${points === 1 ? 'Punkt' : 'Punkte'}`;
}

// Final standings after a match: place, player and the score in a fixed right
// column. The winner's score is green, everyone else is muted. `me` marks the
// own row where a list has no winner (Chimp Test round ranking).
export function arcadeResultListHtml(rows) {
  const hasWinner = rows.some((row) => row.winner);
  return `<div class="arcade-result-list${hasWinner ? ' has-winner' : ''}">${rows
    .map((row, index) => {
      const player = { ...(playerById(row.player.id) ?? {}), ...row.player };
      return `<div class="arcade-result-row${row.winner ? ' is-winner' : ''}${row.me ? ' is-me' : ''}">
        <span class="arcade-result-rank">${row.place ?? index + 1}</span>
        <span class="arcade-result-player">${row.colorVar ? `<span class="arcade-result-swatch" style="background:${row.colorVar}" aria-hidden="true"></span>` : avatarHtml(player, 24)}<span class="arcade-result-text"><span class="player-name">${escapeHtml(row.player.name)}</span>${row.detail ? `<span class="arcade-result-detail">${escapeHtml(row.detail)}</span>` : ''}</span></span>
        <strong class="arcade-result-value">${escapeHtml(row.value ?? '')}${row.winner ? '<span class="visually-hidden"> · Sieg</span>' : ''}</strong>
      </div>`;
    })
    .join('')}</div>`;
}

export function wireArcadeToolbar(container) {
  wireArcadeMuteControl(container);
  wireArcadeExpandControl(container);
}

export function wireArcadeExpandControl(container) {
  const shell = container.querySelector('.arcade-game-shell');
  const button = container.querySelector('[data-arcade-expand]');
  if (!shell || !button) return;

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
    const label = expanded ? 'Spielfläche verkleinern' : 'Spielfläche vergrößern';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon(expanded ? 'minimize' : 'maximize');
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
// Guarded so DOM-free unit tests can import the view helpers.
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (resizeTrackedShell?.isConnected) syncExpandedPlayfieldHeight(resizeTrackedShell);
  });
}

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

// Score bar above a two-sided playfield (Pong, Blobby Volley): players of the
// left side, the score in the side colors with the target below, players of
// the right side. Side colors match the paddles/blobs on the canvas; the team
// name stays readable as text, so meaning never rests on color alone.
export function arcadeScoreboardHtml({ left, right, target = null, myId = null }) {
  const sideHtml = (side, align) => `<div class="arcade-scoreboard-side is-${align}">
    ${side.players
      .map((player) => {
        const profile = { ...(playerById(player.id) ?? {}), ...player };
        const marker = player.colorVar ? `<span class="arcade-scoreboard-swatch" style="background:${player.colorVar}" aria-hidden="true"></span>` : avatarHtml(profile, 20);
        return `<span class="arcade-scoreboard-player">${marker}<span class="player-name${player.id === myId ? ' is-me' : ''}">${escapeHtml(player.name)}</span>${player.detail ? `<span class="arcade-scoreboard-detail">${escapeHtml(player.detail)}</span>` : ''}</span>`;
      })
      .join('')}
    <span class="arcade-scoreboard-label">${escapeHtml(side.label)}</span>
  </div>`;
  return `<div class="arcade-scoreboard">
    ${sideHtml(left, 'left')}
    <div class="arcade-scoreboard-score" aria-label="${escapeHtml(`${left.label} ${left.score}, ${right.label} ${right.score}`)}">
      <span class="is-left">${left.score}</span><span class="arcade-scoreboard-sep">:</span><span class="is-right">${right.score}</span>
      ${target ? `<small>bis ${target}</small>` : ''}
    </div>
    ${sideHtml(right, 'right')}
  </div>`;
}

// Players of a free-for-all playfield (Snake): the color the player steers on
// the canvas, the name, a short status and the current score. The own entry
// is bold and says "Du"; eliminated players are muted.
export function arcadePlayerStripHtml(entries) {
  return `<div class="arcade-player-strip">${entries
    .map((entry) => `<div class="arcade-player-strip-item${entry.out ? ' is-out' : ''}">
      <span class="arcade-player-strip-color" style="background:${entry.colorVar}" aria-hidden="true"></span>
      <span class="arcade-player-strip-text">
        <span class="player-name${entry.me ? ' is-me' : ''}">${escapeHtml(entry.name)}${entry.me ? ' · Du' : ''}</span>
        ${entry.detail ? `<span class="arcade-player-strip-detail">${escapeHtml(entry.detail)}</span>` : ''}
      </span>
      <strong class="arcade-player-strip-value">${escapeHtml(entry.value ?? '')}</strong>
    </div>`)
    .join('')}</div>`;
}
