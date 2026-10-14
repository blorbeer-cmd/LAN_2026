// A short, stylish "3 · 2 · 1 · Los!" countdown overlay shared by every arcade
// game. Server-authoritative: given the match's `beginsAt` timestamp it only
// visualises the wait. Each number pops in exactly once (the DOM changes only
// when the integer second changes, so it never flickers), and the overlay
// removes itself when the game begins.

let active = null;
// How long the countdown waits for the game view to mount its playfield
// before falling back to the window center.
const ANCHOR_WAIT_MS = 400;

export function cancelCountdown() {
  if (active) active.cancel();
}

export function showCountdown(beginsAt, onDone) {
  cancelCountdown();

  const overlay = document.createElement('div');
  overlay.className = 'countdown-overlay';
  const content = document.createElement('div');
  content.className = 'countdown-content';
  // Two stacked, identically-positioned text nodes instead of one element
  // trying to be both glowing AND gradient-filled: combining `filter`/
  // `text-shadow` with `background-clip: text` on the *same* element gets
  // clipped to a hard box in Chromium (and apparently other engines too) —
  // any shape more complex than a plain rectangle around the glyphs breaks.
  // A plain solid-colour blurred copy behind a crisp gradient-clipped copy
  // on top has no such interaction and glows cleanly everywhere.
  const wrap = document.createElement('div');
  wrap.className = 'countdown-num-wrap';
  const glow = document.createElement('div');
  glow.className = 'countdown-num countdown-num-glow';
  glow.setAttribute('aria-hidden', 'true');
  const num = document.createElement('div');
  num.className = 'countdown-num countdown-num-fill';
  wrap.appendChild(glow);
  wrap.appendChild(num);
  content.appendChild(wrap);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  let shown = null;
  let finished = false;
  let timer = null;

  // A game that rebuilds or resizes its playfield mid-countdown (Battleship
  // switching to the battle view, Tetris fitting expanded boards) is followed
  // before the browser paints, not one frame later.
  const view = document.getElementById('view-container') ?? document.body;
  const mutations = new MutationObserver(() => place());
  mutations.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  resizes?.observe(view);
  let frame = null;
  const follow = () => {
    place();
    frame = requestAnimationFrame(follow);
  };
  const cleanup = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    mutations.disconnect();
    resizes?.disconnect();
    overlay.remove();
    if (active === controller) active = null;
  };
  const controller = { cancel: cleanup };

  const setValue = (v) => {
    if (v === shown) return;
    shown = v;
    num.textContent = v;
    glow.textContent = v;
    // Restart the pop animation for the fresh value (only fires on change).
    wrap.classList.remove('countdown-pop');
    void wrap.offsetWidth;
    wrap.classList.add('countdown-pop');
  };

  // Center the number on the playfield, not on the window: the side rail and
  // header would otherwise shift it. Each game marks its playfield with
  // data-countdown-anchor; the position is re-measured on every tick so a
  // late mount, the expand toggle or scrolling never leaves it off-center.
  // While the game view is still mounting the number stays invisible instead
  // of flashing at the window center, and when the view swaps its playfield
  // (Battleship: placement -> battle at "Los!") it keeps the last position.
  const shownAt = Date.now();
  let anchoredOnce = false;
  const place = () => {
    const anchor = document.querySelector('[data-countdown-anchor]');
    const rect = anchor?.getBoundingClientRect();
    if (rect && rect.width && rect.height) {
      anchoredOnce = true;
      content.classList.add('is-anchored');
      content.style.removeProperty('visibility');
      content.style.setProperty('--countdown-x', `${rect.left + rect.width / 2}px`);
      content.style.setProperty('--countdown-y', `${rect.top + rect.height / 2}px`);
      return;
    }
    if (anchoredOnce) return;
    if (Date.now() - shownAt < ANCHOR_WAIT_MS) {
      content.style.visibility = 'hidden';
      return;
    }
    content.style.removeProperty('visibility');
  };

  const tick = () => {
    place();
    const remaining = beginsAt - Date.now();
    if (remaining > 0) {
      setValue(String(Math.ceil(remaining / 1000)));
    } else if (!finished) {
      finished = true;
      setValue('Los!');
      setTimeout(() => {
        cleanup();
        if (onDone) onDone();
      }, 650);
    }
  };

  active = controller;
  timer = setInterval(tick, 80);
  tick();
  // Follow the playfield every frame so a resizing board never drags behind.
  frame = requestAnimationFrame(follow);
  return controller;
}
