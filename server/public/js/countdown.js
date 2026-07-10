// A short, stylish "3 · 2 · 1 · Los!" countdown overlay shared by every arcade
// game. Server-authoritative: given the match's `beginsAt` timestamp it only
// visualises the wait. Each number pops in exactly once (the DOM changes only
// when the integer second changes, so it never flickers), and the overlay
// removes itself when the game begins.

let active = null;

export function cancelCountdown() {
  if (active) active.cancel();
}

export function showCountdown(beginsAt, onDone) {
  cancelCountdown();

  const overlay = document.createElement('div');
  overlay.className = 'countdown-overlay';
  const num = document.createElement('div');
  num.className = 'countdown-num';
  overlay.appendChild(num);
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
    // Restart the pop animation for the fresh value (only fires on change).
    num.classList.remove('countdown-pop');
    void num.offsetWidth;
    num.classList.add('countdown-pop');
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
