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
  // A browser socket names its group in every (re)connect handshake, so an
  // action pressed while still connecting already runs in that scope and
  // every feature's first snapshot arrives exactly once.
  const socket = io({
    auth: kiosk ? { token: getKioskToken(), kiosk: true } : (callback) => callback({ groupId: currentScope() }),
  });
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
              return socket.connected && generation === connectionGeneration;
            },
          },
        }),
      );
      // Transport connectivity is authoritative as soon as Socket.IO has
      // completed its handshake. The REST refresh above is a separate cache
      // recovery concern and must not keep the global banner stuck on
      // "connecting" when one of its endpoints is temporarily unavailable.
      publishConnectionState('connected');
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
    // Every (re)connect is scoped by the handshake above; only a group switch
    // on a live connection needs an explicit subscription.
    const subscribe = () => {
      const groupId = currentScope();
      if (groupId) socket.emit('scope:subscribe', { groupId });
      else socket.emit('scope:leave');
    };
    window.addEventListener('respawn:group-changed', subscribe);
  }
  return socket;
}
