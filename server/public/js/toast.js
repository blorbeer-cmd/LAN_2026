// Minimal toast notifications for errors/confirmations. Auto-dismisses. Caps
// how many stack up at once so a burst of quick actions doesn't bury the
// screen in old messages — only the most recent few stay visible.

const MAX_VISIBLE = 2;

export function showToast(message, { error = false, duration = 2600, onClick } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  while (container.children.length >= MAX_VISIBLE) {
    container.firstElementChild.remove();
  }

  const el = document.createElement('div');
  el.className = `toast${error ? ' toast-error' : ''}${onClick ? ' toast-clickable' : ''}`;
  el.textContent = message;
  if (onClick) {
    // Toasts aren't interactive by default (pointer-events: none on the
    // container, so a burst of them never blocks taps on the page below) —
    // opt this one back in since it's meant to be tapped.
    el.style.pointerEvents = 'auto';
    el.addEventListener('click', () => {
      onClick();
      el.remove();
    });
  }
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
