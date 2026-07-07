// Minimal toast notifications for errors/confirmations. Auto-dismisses. Caps
// how many stack up at once so a burst of quick actions doesn't bury the
// screen in old messages — only the most recent few stay visible.

const MAX_VISIBLE = 2;

export function showToast(message, { error = false, duration = 2600 } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  while (container.children.length >= MAX_VISIBLE) {
    container.firstElementChild.remove();
  }

  const el = document.createElement('div');
  el.className = `toast${error ? ' toast-error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
