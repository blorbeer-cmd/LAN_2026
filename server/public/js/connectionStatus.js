import { icon } from './icons.js';

const INITIAL_CONNECT_DELAY_MS = 1200;

export function connectionStatusText(state) {
  if (state === 'offline') return 'Gerät offline – Änderungen werden nach der Verbindung wieder aktualisiert.';
  if (state === 'reconnecting') return 'Verbindung unterbrochen – Respawn verbindet sich automatisch neu …';
  if (state === 'connecting') return 'Serververbindung wird hergestellt …';
  return '';
}

export function initConnectionStatus() {
  const banner = document.getElementById('connection-status');
  if (!banner) return;

  let pendingTimer = null;
  const hide = () => {
    if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    pendingTimer = null;
    banner.hidden = true;
    banner.replaceChildren();
  };
  const show = (state) => {
    const text = connectionStatusText(state);
    if (!text) return hide();
    banner.innerHTML = `${icon('radioTower')}<span>${text}</span>`;
    banner.hidden = false;
  };
  const update = (state) => {
    if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    pendingTimer = null;
    if (state === 'connected') return hide();
    if (state === 'connecting') {
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null;
        show(state);
      }, INITIAL_CONNECT_DELAY_MS);
      return;
    }
    show(state);
  };

  window.addEventListener('respawn:connection-state', (event) => update(event.detail?.state));
  window.addEventListener('offline', () => update('offline'));
  window.addEventListener('online', () => update('reconnecting'));
  if (!navigator.onLine) update('offline');
}
