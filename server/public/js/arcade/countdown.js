// A short, stylish "3 · 2 · 1 · Los!" countdown overlay shared by every arcade
// game. Server-authoritative: given the match's `beginsAt` timestamp it only
// visualises the wait. Each number pops in exactly once (the DOM changes only
// when the integer second changes, so it never flickers), and the overlay
// removes itself when the game begins.

let active = null;

export function cancelCountdown() {
  if (active) active.cancel();
}

export function showCountdown(beginsAt, onDone, options = {}) {
  cancelCountdown();

  const overlay = document.createElement('div');
  overlay.className = 'countdown-overlay';
  const content = document.createElement('div');
  content.className = 'countdown-content';
  const announcement = options.announcement;
  if (announcement?.label && announcement?.color) {
    const identity = document.createElement('div');
    identity.className = 'countdown-player-identity';
    identity.setAttribute('role', 'status');
    identity.style.setProperty('--countdown-player-color', announcement.color);

    const swatch = document.createElement('span');
    swatch.className = 'countdown-player-color';
    swatch.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'countdown-player-identity-copy';
    const prompt = document.createElement('span');
    prompt.className = 'countdown-player-identity-prompt';
    prompt.textContent = announcement.prompt || 'Du bist';
    const label = document.createElement('strong');
    label.textContent = announcement.label;
    copy.appendChild(prompt);
    copy.appendChild(label);
    if (announcement.detail) {
      const detail = document.createElement('span');
      detail.className = 'countdown-player-identity-detail';
      detail.textContent = announcement.detail;
      copy.appendChild(detail);
    }
    identity.appendChild(swatch);
    identity.appendChild(copy);
    content.appendChild(identity);
  }
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

  const cleanup = () => {
    if (timer) clearInterval(timer);
    timer = null;
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

  const tick = () => {
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
  return controller;
}
