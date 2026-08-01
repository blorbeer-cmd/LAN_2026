// Socket.IO client setup. Browser sessions use their HttpOnly cookie; only the
// read-only kiosk sends its dedicated token in the handshake.

import { getKioskToken, GROUP_KEY } from './api.js';

function currentScope() {
  return sessionStorage.getItem(GROUP_KEY) || 'default-group';
}

export function connectionStateAfterFailure({ hasConnected, online }) {
  if (!online) return 'offline';
  return hasConnected ? 'reconnecting' : 'connecting';
}

export function isPermanentConnectionFailure({ reason, error }) {
  return reason === 'io server disconnect' || error?.message === 'unauthorized';
}

export function connectSocket({ kiosk = false, reportConnectionState = false } = {}) {
  const socket = io({ auth: kiosk ? { token: getKioskToken(), kiosk: true } : {} });
  if (reportConnectionState) {
    let hasConnected = false;
    let connectionGeneration = 0;
    const publishConnectionState = (state) => {
      window.dispatchEvent(new CustomEvent('respawn:connection-state', { detail: { state } }));
    };
    publishConnectionState('connecting');
    socket.on('connect', () => {
      const reconnected = hasConnected;
      hasConnected = true;
      const generation = ++connectionGeneration;
      if (reconnected) publishConnectionState('reconnecting');
      window.dispatchEvent(
        new CustomEvent('respawn:connection-restored', {
          detail: {
            generation,
            complete: () => {
              if (!socket.connected || generation !== connectionGeneration) return false;
              publishConnectionState('connected');
              return true;
            },
          },
        }),
      );
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
      connectionGeneration += 1;
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
