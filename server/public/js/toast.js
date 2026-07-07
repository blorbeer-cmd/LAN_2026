// Minimal toast notifications for errors/confirmations. Auto-dismisses.

export function showToast(message, { error = false, duration = 3200 } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast${error ? ' toast-error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
