import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Shared "Bereit" UI for all arcade lobby cards (quiz, tetris, scribble,
// blobby): player chips that turn green with a check once someone is ready,
// an "x/y bereit" summary for the host, and the guest's own ready toggle.
// The server marks the host as always ready (they decide when to start).

export function lobbyPlayerChipsHtml(lobby) {
  return lobby.players
    .map(
      (p) =>
        `<span class="chip${p.ready ? ' chip-ready' : ''}">${p.ready ? icon('check') : ''}${escapeHtml(p.name)}</span>`
    )
    .join('');
}

export function readySummaryText(lobby) {
  const ready = lobby.players.filter((p) => p.ready).length;
  return `${ready}/${lobby.players.length} bereit`;
}

export function allLobbyReady(lobby) {
  return lobby.players.every((p) => p.ready);
}

// Toggle button for the current player (guests only — the host has no ready
// state to manage). `dataAttr` keeps each game's buttons in its own namespace,
// e.g. 'quiz-ready' -> data-quiz-ready="<lobbyId>".
export function readyToggleHtml(lobby, myId, dataAttr) {
  const me = lobby.players.find((p) => p.id === myId);
  if (!me || lobby.host.id === myId) return '';
  return me.ready
    ? `<button type="button" class="btn btn-sm btn-equal btn-ready" data-${dataAttr}="${lobby.id}" data-ready="0">${icon('check')} Bereit</button>`
    : `<button type="button" class="btn btn-sm btn-equal btn-primary" data-${dataAttr}="${lobby.id}" data-ready="1">Bereit?</button>`;
}

// Wires the buttons rendered by readyToggleHtml. `send(lobbyId, ready)` does
// the actual socket emit (each game has its own namespace + error toast).
export function wireReadyToggle(container, dataAttr, send) {
  container.querySelectorAll(`[data-${dataAttr}]`).forEach((btn) => {
    btn.addEventListener('click', () => send(btn.getAttribute(`data-${dataAttr}`), btn.dataset.ready === '1'));
  });
}
