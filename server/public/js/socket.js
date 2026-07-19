// Socket.IO client setup. Authenticates with the same shared access token as
// the REST API (server-side enforced in index.ts's io.use()).

import { getToken, GROUP_KEY } from './api.js';

function currentScope() {
  return sessionStorage.getItem(GROUP_KEY);
}

export function connectSocket({ kiosk = false } = {}) {
  const socket = io({ auth: { token: getToken(), kiosk } });
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
