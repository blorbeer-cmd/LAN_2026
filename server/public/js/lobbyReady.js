import { avatarHtml, escapeHtml } from './format.js';
import { icon } from './icons.js';

// Shared lobby UI for every arcade game: stable player rows, the lobby card
// shell, readiness summaries and the guest's own ready toggle. The server
// marks the host as always ready because they decide when to start.

function lobbyPlayerRowsHtml(lobby) {
  return lobby.players
    .map((player) => {
      const role = player.id === lobby.host.id ? 'Host' : player.ready ? `${icon('check')} Bereit` : 'Mitspieler';
      return `<div class="arcade-lobby-member-row">
        ${avatarHtml(player, 24)}
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="arcade-lobby-member-role">${role}</span>
      </div>`;
    })
    .join('');
}

export function arcadeLobbyEntryHtml(
  lobby,
  { playerLimit = null, joinAction = '', footerActions = '', full = false } = {}
) {
  const countText = `${lobby.players.length}${playerLimit ? `/${playerLimit}` : ''} Spieler`;
  const availableRow = joinAction
    ? `<div class="arcade-lobby-member-row arcade-lobby-free-row">
        <span class="muted arcade-lobby-free-label">${full ? 'Voll' : 'Frei'}</span>
        ${joinAction}
      </div>`
    : '';
  return `<div class="card stack arcade-lobby-entry">
    <div class="arcade-lobby-entry-head">
      <strong>${escapeHtml(lobby.host.name)}s Lobby</strong>
      <span class="badge arcade-lobby-player-count">${escapeHtml(countText)}</span>
    </div>
    <div class="arcade-lobby-member-list">${lobbyPlayerRowsHtml(lobby)}${availableRow}</div>
    ${footerActions ? `<div class="arcade-lobby-entry-actions">${footerActions}</div>` : ''}
  </div>`;
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
