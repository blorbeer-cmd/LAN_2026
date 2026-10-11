// A phone that locks its screen or switches apps drops the connection and
// comes back on a new socket. The server keeps the match for its reconnect
// grace; this hands the match back to the new socket so pause, resume and
// input work again. A refusal means the match ended in the meantime, so the
// stale local match is dropped instead of answering every click with an error.

import { showToast } from '../toast.js';

export const MATCH_LOST_MESSAGE = 'Das Match ist nicht mehr verfügbar.';
export const OFFLINE_MESSAGE = 'Keine Verbindung zum Server.';

// `activeMatchId` returns the id of a running match the local player takes
// part in, or null. `onLost` clears the local match and leaves its view.
export function reclaimMatchOnReconnect(socket, { event, activeMatchId, playerId, onLost }) {
  socket.on('connect', () => {
    const matchId = activeMatchId();
    if (!matchId) return;
    socket.emit(event, { matchId, playerId: playerId() }, (result) => {
      if (result?.ok || activeMatchId() !== matchId) return;
      onLost();
      showToast(MATCH_LOST_MESSAGE, { error: true });
    });
  });
}

// Match controls only make sense on a live connection: a buffered pause or
// resume would reach the server before the new socket has taken the match back.
export function emitWhileConnected(socket, event, payload) {
  if (!socket?.connected) return Promise.resolve({ ok: false, error: OFFLINE_MESSAGE });
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}
