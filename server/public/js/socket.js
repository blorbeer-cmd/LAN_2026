// Socket.IO client setup. Authenticates with the same shared access token as
// the REST API (server-side enforced in index.ts's io.use()).

import { getToken, GROUP_KEY } from './api.js';

function currentScope() {
  return sessionStorage.getItem(GROUP_KEY);
}

export function connectionStateAfterFailure({ hasConnected, online }) {
  if (!online) return 'offline';
  return hasConnected ? 'reconnecting' : 'connecting';
}

export function isPermanentConnectionFailure({ reason, error }) {
  return reason === 'io server disconnect' || error?.message === 'unauthorized';
}

export function connectSocket({ kiosk = false, reportConnectionState = false } = {}) {
  const socket = io({ auth: { token: getToken(), kiosk } });
  if (reportConnectionState) {
    let hasConnected = false;
    const publishConnectionState = (state) => {
      window.dispatchEvent(new CustomEvent('respawn:connection-state', { detail: { state } }));
    };
    publishConnectionState('connecting');
    socket.on('connect', () => {
      const reconnected = hasConnected;
      hasConnected = true;
      publishConnectionState('connected');
      if (reconnected) window.dispatchEvent(new CustomEvent('respawn:connection-restored'));
    });
    socket.on('connect_error', (error) => {
      if (isPermanentConnectionFailure({ error })) {
        publishConnectionState('offline');
        window.dispatchEvent(new CustomEvent('respawn:connection-recovery-required'));
        return;
      }
      publishConnectionState(connectionStateAfterFailure({ hasConnected, online: navigator.onLine }));
    });
    socket.on('disconnect', (reason) => {
      if (isPermanentConnectionFailure({ reason })) {
        publishConnectionState('offline');
        window.dispatchEvent(new CustomEvent('respawn:connection-recovery-required'));
        return;
      }
      publishConnectionState(connectionStateAfterFailure({ hasConnected: true, online: navigator.onLine }));
    });
  }
  if (!kiosk) {
    const subscribe = () => {
      const groupId = currentScope();
      if (groupId) socket.emit('scope:subscribe', { groupId });
      else socket.emit('scope:leave');
    };
    socket.on('connect', subscribe);
    window.addEventListener('respawn:group-changed', subscribe);
  }
  return socket;
}
