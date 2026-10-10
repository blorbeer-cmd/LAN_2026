import { icon } from '../icons.js';

// Playfield sizing and the fullscreen mode shared by every Arcade game room.
//
// Every scalable playfield (`.arcade-game-shell ...` in arcade.css) derives
// its width from one `--arcade-h-budget` height budget. The CSS default is a
// fixed guess (`100dvh - 18rem`); fitArcadePlayfield() replaces it with the
// height that is actually left in the scrollable view, so the playfield is as
// large as the screen allows — larger on a tall monitor, smaller on a short
// laptop — while score bar, chat and match controls stay visible.
const ARCADE_PLAYFIELD_SELECTOR = '.scribble-canvas-wrap, .blobby-court, .pong-arena, .snake-game, .tetris-canvas-wrap';
// Below this the boards stop being playable; the view scrolls instead.
const MIN_HEIGHT_BUDGET = 160;
// Rounding headroom so the fitted layout never ends a pixel past the fold.
const FIT_SAFETY_MARGIN = 8;

export function fitArcadePlayfield(shell) {
  if (!shell?.isConnected) return;
  const viewContainer = shell.closest('.view-container');
  const playfield = shell.querySelector(ARCADE_PLAYFIELD_SELECTOR);
  // After the match the result card sits above the playfield; shrinking the
  // board to fit both would only make the final position unreadable.
  if (!viewContainer || !playfield || shell.classList.contains('is-ended')) {
    shell.style.removeProperty('--arcade-h-budget');
    return;
  }
  const containerStyle = getComputedStyle(viewContainer);
  const containerTop = viewContainer.getBoundingClientRect().top - viewContainer.scrollTop;
  const paddingBottom = Number.parseFloat(containerStyle.paddingBottom) || 0;
  const tetrisBoards = shell.querySelector('.tetris-boards.is-arena');
  const opponentGrid = tetrisBoards?.querySelector('.tetris-opponent-grid');
  const primaryBoard = tetrisBoards?.querySelector('.tetris-primary-board');
  // On phones the Arena stacks the own board above the opponents. Fitting the
  // whole stack would shrink the own board to a stamp, so only the own board
  // has to fit there; the opponents follow below the fold.
  const stackedArena = Boolean(primaryBoard && getComputedStyle(tetrisBoards).flexDirection === 'column');
  const fitAnchor = stackedArena ? primaryBoard : shell;
  const neededHeight = fitAnchor.getBoundingClientRect().bottom - containerTop + paddingBottom;
  // An overflowing view reports its exact excess through scrollHeight (which
  // also covers collapsed trailing margins); otherwise the free space below
  // the shell is what the playfield may still grow into.
  const overflow = viewContainer.scrollHeight - viewContainer.clientHeight;
  const delta = !stackedArena && overflow > 0 ? -overflow : viewContainer.clientHeight - neededHeight;
  // The playfield's own rendered height is the most reliable source for the
  // CSS budget: every formula in arcade.css makes it grow 1:1 with the budget
  // until the width caps it. Measuring it avoids reconstructing the CSS
  // default from window.innerHeight, which drifts with collapsing mobile
  // address bars.
  const currentHeight = playfield.getBoundingClientRect().height;
  // A spectator Tetris Arena has no primary board. Its first opponent board
  // is half as tall as the shared budget.
  const budgetScale = playfield.closest('.tetris-opponent-grid.is-spectator') ? 2 : 1;
  let target = (currentHeight + delta) * budgetScale - FIT_SAFETY_MARGIN;
  if (tetrisBoards && opponentGrid && !stackedArena) {
    // Side-by-side Arena opponents can span several grid rows. The first
    // canvas alone does not describe the layout height, so derive the budget
    // from the complete board group and its actual row count.
    const gridStyle = getComputedStyle(opponentGrid);
    const columns = gridStyle.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length || 1;
    const rows = Math.ceil(opponentGrid.children.length / columns);
    const rowGap = Number.parseFloat(gridStyle.rowGap) || 0;
    const currentBudget = currentHeight * budgetScale;
    const scalableBoardHeight = Math.max(1, tetrisBoards.getBoundingClientRect().height - rowGap * Math.max(0, rows - 1));
    const layoutScale = scalableBoardHeight / Math.max(1, currentBudget);
    target = (scalableBoardHeight + delta) / layoutScale - FIT_SAFETY_MARGIN;
  }
  target = Math.max(MIN_HEIGHT_BUDGET, Math.round(target));
  const applied = Number.parseFloat(shell.style.getPropertyValue('--arcade-h-budget'));
  // Re-measuring a fitted layout yields the same target; skipping that write
  // keeps the resize observer below from looping.
  if (Number.isFinite(applied) && Math.abs(applied - target) <= 1) return;
  shell.style.setProperty('--arcade-h-budget', `${target}px`);
}

// Game views replace their container's innerHTML (and thus the shell) on
// re-renders, so one shared observer always follows whichever shell was wired
// last instead of piling up observers over a three-day LAN. It reacts to the
// window, the connection strip and content that grows inside the shell (chat
// lines, a wrapping score bar) alike.
let fittedShell = null;
let fitFrame = 0;
let fitObserver = null;

function scheduleFit() {
  if (fitFrame || typeof requestAnimationFrame !== 'function') return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    if (fittedShell?.isConnected) fitArcadePlayfield(fittedShell);
  });
}

export function wireArcadePlayfieldFit(container) {
  const shell = container.querySelector('.arcade-game-shell');
  if (!shell) return;
  fittedShell = shell;
  if (typeof ResizeObserver === 'function') {
    fitObserver ??= new ResizeObserver(scheduleFit);
    fitObserver.disconnect();
    const viewContainer = shell.closest('.view-container');
    if (viewContainer) fitObserver.observe(viewContainer);
    fitObserver.observe(shell);
  }
  scheduleFit();
}

// Guarded so DOM-free unit tests can import the view helpers.
if (typeof window !== 'undefined' && typeof ResizeObserver !== 'function') {
  window.addEventListener('resize', scheduleFit);
}

// ---------- Fullscreen ----------
// Fullscreen hides the app chrome (topbar, navigation, banners) through the
// `arcade-fullscreen` class on <html> and additionally asks the browser for
// real fullscreen. The whole document goes fullscreen, not only the shell, so
// confirmation dialogs and toasts stay visible. Where the browser offers no
// element fullscreen (Safari on iPhone), the class alone still gives the
// playfield the whole window. The mode lasts while the current view offers
// the control: leaving the game room ends it.
const FULLSCREEN_CLASS = 'arcade-fullscreen';
let fullscreenActive = false;
let viewObserver = null;

export function arcadeFullscreenControlHtml() {
  return `<button type="button" class="btn btn-sm arcade-icon-btn" data-arcade-fullscreen aria-pressed="false" aria-label="Vollbild" title="Vollbild">${icon('maximize')}</button>`;
}

function syncFullscreenButtons() {
  document.querySelectorAll('[data-arcade-fullscreen]').forEach((button) => {
    const label = fullscreenActive ? 'Vollbild beenden' : 'Vollbild';
    button.setAttribute('aria-pressed', String(fullscreenActive));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon(fullscreenActive ? 'minimize' : 'maximize');
  });
}

function setFullscreen(active) {
  fullscreenActive = active;
  document.documentElement.classList.toggle(FULLSCREEN_CLASS, active);
  syncFullscreenButtons();
  // The class swap changes the available height without a window resize.
  scheduleFit();
}

function exitArcadeFullscreen() {
  if (!fullscreenActive) return;
  viewObserver?.disconnect();
  setFullscreen(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function enterArcadeFullscreen(container) {
  setFullscreen(true);
  viewObserver ??= new MutationObserver(() => {
    if (!document.querySelector('#view-container [data-arcade-fullscreen]')) exitArcadeFullscreen();
  });
  const viewContainer = container.closest('.view-container') ?? container;
  viewObserver.disconnect();
  viewObserver.observe(viewContainer, { childList: true });
  const root = document.documentElement;
  if (document.fullscreenEnabled && typeof root.requestFullscreen === 'function' && !document.fullscreenElement) {
    // A refused request (missing gesture, policy) keeps the chrome-free view.
    // A request still pending when the player already toggled back must not
    // leave the browser in fullscreen behind the restored app chrome.
    root.requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        if (!fullscreenActive && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      })
      .catch(() => {});
  }
}

if (typeof document !== 'undefined') {
  // Esc or the browser's own controls leave real fullscreen; the app chrome
  // returns with it instead of leaving a half-immersive view behind.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) exitArcadeFullscreen();
  });
  // Without real fullscreen (no browser support, or a refused request) Esc
  // never reaches fullscreenchange, so the chrome-free view handles it itself.
  // An Esc meant for an open dialog or an already handled one (a help panel)
  // stays with its owner.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!fullscreenActive || document.fullscreenElement) return;
    if (document.querySelector('.modal-backdrop')) return;
    exitArcadeFullscreen();
  });
}

export function wireArcadeFullscreenControl(container) {
  const button = container.querySelector('[data-arcade-fullscreen]');
  if (!button) return;
  syncFullscreenButtons();
  button.addEventListener('click', () => {
    if (fullscreenActive) exitArcadeFullscreen();
    else enterArcadeFullscreen(container);
  });
}
