// Revanche after a finished match, built on the existing lobby events so the
// server needs no extra flow: the requester opens a lobby in the same mode,
// the former opponents see it as an offer on their result screen, accept by
// joining (and readying), and the requester's client starts the match once
// everyone is back.

import { escapeHtml } from '../format.js';

const BOT_ID = /(^|-)bot(-|$)/;

export function isArcadeBotId(id) {
  return BOT_ID.test(String(id ?? ''));
}

export function createRematch({ requireHostReady = false } = {}) {
  let snapshot = null; // { mode, humanIds, vsBot, knownLobbyIds }
  let requestedLobbyId = null;
  let starting = false;

  return {
    // Remember who played and which lobbies already existed when the match ended.
    capture({ mode, players, lobbies }) {
      snapshot = {
        mode: mode ?? null,
        humanIds: players.filter((p) => !isArcadeBotId(p.id)).map((p) => p.id),
        vsBot: players.some((p) => isArcadeBotId(p.id)),
        knownLobbyIds: new Set(lobbies.map((lobby) => lobby.id)),
      };
      requestedLobbyId = null;
      starting = false;
    },
    reset() {
      snapshot = null;
      requestedLobbyId = null;
      starting = false;
    },
    get vsBot() {
      return Boolean(snapshot?.vsBot);
    },
    get mode() {
      return snapshot?.mode ?? null;
    },
    wasPlayer(myId) {
      return Boolean(snapshot?.humanIds.includes(myId));
    },
    markRequested(lobbyId) {
      requestedLobbyId = lobbyId ?? null;
    },
    requestedLobby(lobbies) {
      return requestedLobbyId ? lobbies.find((lobby) => lobby.id === requestedLobbyId) ?? null : null;
    },
    // A new lobby by a former opponent in the same mode that I am not in yet.
    offer(lobbies, myId) {
      if (!snapshot) return null;
      return lobbies.find((lobby) =>
        !snapshot.knownLobbyIds.has(lobby.id) &&
        lobby.host.id !== myId &&
        snapshot.humanIds.includes(lobby.host.id) &&
        (snapshot.mode == null || lobby.mode == null || lobby.mode === snapshot.mode) &&
        !lobby.players.some((player) => player.id === myId),
      ) ?? null;
    },
    // Former opponents who have not joined the requested lobby yet.
    missing(lobbies, myId) {
      const lobby = this.requestedLobby(lobbies);
      if (!lobby || !snapshot) return [];
      return snapshot.humanIds.filter((id) => id !== myId && !lobby.players.some((player) => player.id === id));
    },
    // True exactly once, as soon as everyone is back and ready.
    shouldStart(lobbies, myId) {
      const lobby = this.requestedLobby(lobbies);
      if (!lobby || starting) return false;
      const everyoneBack = this.missing(lobbies, myId).length === 0 && lobby.players.length >= 2;
      const ready = lobby.players.every((player) => player.ready || (!requireHostReady && player.id === lobby.host.id));
      if (!everyoneBack || !ready) return false;
      starting = true;
      return true;
    },
  };
}

// One Revanche controller per game. The game passes its socket emit, its lobby
// events and how to read its state; the controller renders the action in the
// result card header and drives request, accept, withdraw and auto-start.
export function createRematchController({ prefix, emit, myId, lobbies, events, createPayload = () => ({}), startPayload = () => ({}), joinPayload = () => ({}), hostReady = false, playerName, rerender, onError }) {
  const rematch = createRematch({ requireHostReady: hostReady });

  async function start() {
    const lobby = rematch.requestedLobby(lobbies());
    if (!lobby) return;
    const res = await emit(events.start, { lobbyId: lobby.id, playerId: myId(), ...startPayload() });
    if (!res?.ok) onError(res?.error || 'Revanche konnte nicht starten.');
  }
  async function request() {
    const res = await emit(rematch.vsBot ? events.bot : events.create, { playerId: myId(), ...(rematch.mode ? { mode: rematch.mode } : {}), ...createPayload() });
    if (!res?.ok) return onError(res?.error || 'Revanche konnte nicht angefragt werden.');
    rematch.markRequested(res.lobbyId);
    // Some games (Battleship) also require the host to be ready.
    if (hostReady) await emit(events.ready, { lobbyId: res.lobbyId, playerId: myId(), ready: true });
    if (rematch.shouldStart(lobbies(), myId())) start();
    rerender();
  }
  async function accept(lobbyId) {
    const joined = await emit(events.join, { lobbyId, playerId: myId(), ...joinPayload() });
    if (!joined?.ok) return onError(joined?.error || 'Revanche konnte nicht angenommen werden.');
    await emit(events.ready, { lobbyId, playerId: myId(), ready: true });
  }
  async function withdraw() {
    const lobby = rematch.requestedLobby(lobbies());
    rematch.markRequested(null);
    if (lobby) await emit(events.leave, { lobbyId: lobby.id, playerId: myId() });
    rerender();
  }

  return {
    capture: (match) => rematch.capture({ mode: match.mode, players: match.players, lobbies: lobbies() }),
    reset: () => rematch.reset(),
    // Call from the game's lobby-list handler while its result screen is shown.
    onLobbies() {
      if (rematch.shouldStart(lobbies(), myId())) start();
    },
    actionHtml() {
      const me = myId();
      if (!rematch.wasPlayer(me)) return '';
      if (rematch.requestedLobby(lobbies())) {
        const missing = rematch.missing(lobbies(), me).map(playerName);
        return `<div class="arcade-rematch">
          <span class="arcade-rematch-note">${missing.length ? `Wartet auf ${escapeHtml(missing.join(', '))}` : 'Startet gleich'}</span>
          <button type="button" class="btn btn-sm" data-rematch-cancel="${prefix}">Zurückziehen</button>
        </div>`;
      }
      const offer = rematch.offer(lobbies(), me);
      if (offer) {
        return `<div class="arcade-rematch">
          <span class="arcade-rematch-note">${escapeHtml(offer.host.name)} will eine Revanche</span>
          <button type="button" class="btn btn-primary btn-sm" data-rematch-accept="${escapeHtml(offer.id)}">Annehmen</button>
        </div>`;
      }
      return `<button type="button" class="btn btn-primary btn-sm" data-rematch-request="${prefix}">Revanche</button>`;
    },
    wire(container) {
      container.querySelector(`[data-rematch-request="${prefix}"]`)?.addEventListener('click', request);
      container.querySelector(`[data-rematch-cancel="${prefix}"]`)?.addEventListener('click', withdraw);
      container.querySelector('[data-rematch-accept]')?.addEventListener('click', (event) => accept(event.currentTarget.dataset.rematchAccept));
    },
    // "Schließen" on the result screen also withdraws an open request.
    async close() {
      if (rematch.requestedLobby(lobbies())) await withdraw();
      rematch.reset();
    },
  };
}

