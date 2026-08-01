// Socket.IO client setup. Browser sessions use their HttpOnly cookie; only the
// read-only kiosk sends its dedicated token in the handshake.

import { getKioskToken, GROUP_KEY } from './api.js';

function currentScope() {
  return sessionStorage.getItem(GROUP_KEY) || 'default-group';
}

export function connectSocket({ kiosk = false } = {}) {
  const socket = io({ auth: kiosk ? { token: getKioskToken(), kiosk: true } : {} });
  if (!kiosk) {
    const subscribe = () => {
      const groupId = currentScope();
      if (groupId) socket.emit('scope:subscribe', { groupId });
      else socket.emit('scope:leave');
    };
    socket.on('connect', subscribe);
    window.addEventListener('respawn:group-changed', subscribe);
    socket.on('disconnect', () => {
      // Socket.IO reconnects automatically; the connect handler deliberately
      // re-subscribes so stale rooms never survive a reconnect.
    });
  }
  return socket;
}
