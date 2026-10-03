import { avatarHtml, escapeHtml } from '../format.js';
import { currentPlayerMayUseArcadeAi } from './arcadeAdmin.js';
import { arcadeGame, arcadeGameIconHtml } from './arcadeGames.js';
import { getMyId } from '../whoami.js';
import { playerById } from '../state.js';

// Shared lobby UI for every arcade game. The Arcade hub lists all open
// lobbies of every game in one list: a lobby the current player belongs to
// renders as an expanded card with members, settings and its actions; every
// other lobby is one flat row with occupied seats and a join action. The
// server marks the host as always ready because they decide when to start.

const MAX_SEAT_MARKERS = 8;

function lobbyMemberRole(player, lobby) {
  if (player.id === lobby.host.id) return 'Host';
  return player.ready ? 'Bereit' : 'Wartet';
}

// Some lobby payloads carry only id and name; the roster supplies the color.
function withProfile(player) {
  const profile = playerById(player.id);
  return profile ? { ...profile, ...player, color: player.color ?? profile.color, avatar: player.avatar ?? profile.avatar } : player;
}

export function arcadeLobbyMemberRowHtml(player, lobby) {
  const me = player.id === getMyId();
  return `<div class="arcade-lobby-member-row">
    ${avatarHtml(withProfile(player), 24)}
    <span class="player-name${me ? ' is-me' : ''}">${escapeHtml(player.name)}</span>
    <span class="arcade-lobby-member-role">${lobbyMemberRole(player, lobby)}</span>
  </div>`;
}

export function arcadeLobbyFreeRowHtml(freeCount) {
  if (freeCount <= 0) return '';
  return `<div class="arcade-lobby-member-row arcade-lobby-free-row">
    <span class="arcade-lobby-avatar-slot" aria-hidden="true"></span>
    <span class="arcade-lobby-free-label">${freeCount === 1 ? 'Frei' : `${freeCount} Plätze frei`}</span>
  </div>`;
}

function lobbyCapacity(lobby, capacity) {
  return capacity ?? lobby.playerLimit ?? lobby.capacity ?? lobby.players.length;
}

// Occupied seats only; the free count already sits in the meta line (2/8).
function seatMarkersHtml(lobby) {
  const names = lobby.players.map((player) => player.name).join(', ');
  return `<span class="arcade-lobby-seats" role="img" aria-label="${escapeHtml(names)}">
    ${lobby.players.slice(0, MAX_SEAT_MARKERS).map((player) => avatarHtml(withProfile(player), 22)).join('')}
  </span>`;
}

export function arcadeLobbyEntryHtml(
  lobby,
  { gameType = '', meta = '', joinAction = '', settingsHtml = '', footerActions = '', full = false, capacity = null, membersHtml = '' } = {}
) {
  const game = arcadeGame(gameType);
  const seats = lobbyCapacity(lobby, capacity);
  const title = `${escapeHtml(lobby.host.name)}s Lobby`;
  const metaLine = [game?.name, meta || `${lobby.players.length}/${seats}`].filter(Boolean).map(escapeHtml).join(' · ');
  const mine = lobby.players.some((player) => player.id === getMyId());
  if (!mine) {
    return `<div class="arcade-lobby-row${joinAction.includes('-team="left"') ? ' has-team-join' : ''}">
      ${arcadeGameIconHtml(gameType)}
      <span class="arcade-lobby-row-text"><strong>${title}</strong><span class="arcade-lobby-meta">${metaLine}</span></span>
      ${seatMarkersHtml(lobby)}
      <span class="arcade-lobby-row-action">${joinAction || (full ? '<span class="arcade-lobby-meta">Voll</span>' : '')}</span>
    </div>`;
  }
  const members = membersHtml || `${lobby.players.map((player) => arcadeLobbyMemberRowHtml(player, lobby)).join('')}${arcadeLobbyFreeRowHtml(seats - lobby.players.length)}`;
  return `<div class="card arcade-lobby-entry">
    <div class="arcade-lobby-entry-head">
      ${arcadeGameIconHtml(gameType)}
      <span class="arcade-lobby-row-text"><strong>${title}</strong><span class="arcade-lobby-meta">${metaLine}</span></span>
      ${footerActions ? `<div class="arcade-lobby-entry-actions">${footerActions}</div>` : ''}
    </div>
    <div class="arcade-lobby-member-list">${members}</div>
    ${settingsHtml ? `<div class="arcade-lobby-settings">${settingsHtml}</div>` : ''}
  </div>`;
}

// Host: compact gradient "Starten" plus a neutral "Schließen". Guest: the
// ready toggle plus a neutral "Verlassen". `attrs` strings carry each game's
// own data attributes / ids so its existing wiring keeps working.
export function arcadeLobbyHostActionsHtml({ startAttrs, startEnabled, startHint = '', closeAttrs }) {
  return `<button type="button" class="btn btn-primary btn-sm" ${startAttrs} ${startEnabled ? '' : 'disabled'}${startHint ? ` title="${escapeHtml(startHint)}"` : ''}>Starten</button>
    <button type="button" class="btn btn-sm" ${closeAttrs}>Schließen</button>`;
}

export function arcadeLobbyGuestActionsHtml({ readyHtml = '', leaveAttrs }) {
  return `${readyHtml}<button type="button" class="btn btn-sm" ${leaveAttrs}>Verlassen</button>`;
}

export function arcadeLobbyJoinHtml(attrs, disabled = false) {
  return `<button type="button" class="btn btn-sm" ${attrs} ${disabled ? 'disabled' : ''}>Beitreten</button>`;
}

// Doubles lobbies (Pong, Blobby Volley): joining picks the team directly.
// A full team disables its button; the label names the team in text.
export function arcadeLobbyTeamJoinHtml(prefix, lobby, perTeam) {
  return [
    { team: 'left', label: 'Blau' },
    { team: 'right', label: 'Pink' },
  ]
    .map(({ team, label }) => {
      const full = lobby.players.filter((player) => player.team === team).length >= perTeam;
      return `<button type="button" class="btn btn-sm" data-${prefix}-join="${escapeHtml(lobby.id)}" data-${prefix}-team="${team}" aria-label="Team ${label} beitreten" ${full ? 'disabled' : ''}>${label}</button>`;
    })
    .join('');
}

// Every mode-capable arcade lobby uses the same compact segmented switch so
// the two choices read as one grouped control (not two more action buttons
// competing with "Lobby öffnen") while the active one stays announced beyond
// color via aria-pressed.
function segmentedToggleHtml(id, ariaLabel, options, selected, disabled, dataAttr) {
  const buttonHtml = options
    .map(({ value, label }) => {
      const active = value === selected;
      return `<button type="button" class="arcade-mode-toggle-btn${active ? ' is-active' : ''}" data-${dataAttr}="${escapeHtml(value)}" aria-pressed="${active}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
    })
    .join('');
  return `<div id="${escapeHtml(id)}" class="arcade-mode-toggle" role="group" aria-label="${escapeHtml(ariaLabel)}">${buttonHtml}</div>`;
}

export function arcadeLobbyModeButtonsHtml(id, ariaLabel, options, selected, disabled = false) {
  return segmentedToggleHtml(id, ariaLabel, options, selected, disabled, 'arcade-mode');
}

// The opponent choice mirrors the mode switch so "Lobby öffnen" keeps exactly
// one primary action beside it instead of a second, competing "Gegen KI"
// button. It selects only; the create action then opens a human or an AI
// lobby. Its own data attribute keeps it from colliding with the mode switch
// when both sit in the same row.
export function arcadeLobbyOpponentToggleHtml(id, opponent, disabled = false) {
  return segmentedToggleHtml(
    id,
    'Gegner',
    [
      { value: 'human', label: 'Mensch' },
      { value: 'bot', label: 'KI' },
    ],
    opponent === 'bot' ? 'bot' : 'human',
    disabled,
    'arcade-opponent'
  );
}

// Wires the segments rendered by arcadeLobbyOpponentToggleHtml. `select`
// receives 'human' or 'bot'.
export function wireArcadeOpponentToggle(container, id, select) {
  container.querySelectorAll(`#${id} [data-arcade-opponent]`).forEach((button) => {
    button.addEventListener('click', () => select(button.dataset.arcadeOpponent === 'bot' ? 'bot' : 'human'));
  });
}

// The opponent choice is admin-gated, so it must not outlive the privilege:
// once the switch stops rendering while the stored value stays 'bot',
// "Lobby öffnen" would emit a bot event that the server rejects as admin-only,
// with no visible control left to undo it. Both routes that can take the
// privilege away have to clear it — `currentPlayerMayUseArcadeAi()` reads
// `isAdmin() && currentPlayerHasAdminRole()`, so leaving Admin mode
// ('respawn:admin-changed') locks AI just as surely as switching to a
// non-admin identity ('respawn:identity-changed'). Each game registers its own
// reset once, mirroring how challengeRush.js clears its challenge selection.
export function resetArcadeOpponentWhenAiUnavailable(reset) {
  const clearWhenLocked = () => {
    if (!currentPlayerMayUseArcadeAi()) reset();
  };
  window.addEventListener('respawn:identity-changed', clearWhenLocked);
  window.addEventListener('respawn:admin-changed', clearWhenLocked);
}

// Toggle button for the current player (guests only — the host has no ready
// state to manage). `dataAttr` keeps each game's buttons in its own namespace,
// e.g. 'quiz-ready' -> data-quiz-ready="<lobbyId>".
export function readyToggleHtml(lobby, myId, dataAttr) {
  const me = lobby.players.find((p) => p.id === myId);
  if (!me || lobby.host.id === myId) return '';
  return me.ready
    ? `<button type="button" class="btn btn-sm btn-ready" data-${dataAttr}="${lobby.id}" data-ready="0" aria-pressed="true">Bereit</button>`
    : `<button type="button" class="btn btn-sm btn-primary" data-${dataAttr}="${lobby.id}" data-ready="1">Bereit?</button>`;
}

// Wires the buttons rendered by readyToggleHtml. `send(lobbyId, ready)` does
// the actual socket emit (each game has its own namespace + error toast).
export function wireReadyToggle(container, dataAttr, send) {
  container.querySelectorAll(`[data-${dataAttr}]`).forEach((btn) => {
    btn.addEventListener('click', () => send(btn.getAttribute(`data-${dataAttr}`), btn.dataset.ready === '1'));
  });
}

// Doubles lobbies (Pong, Blobby Volley) group their members per team. Both
// teams sit side by side with the same member/free rows as a plain lobby.
export function arcadeTeamMembersHtml(lobby, perTeam) {
  const teams = [
    { key: 'left', label: 'Team Blau' },
    { key: 'right', label: 'Team Pink' },
  ];
  return `<div class="arcade-lobby-teams">${teams
    .map(({ key, label }) => {
      const players = lobby.players.filter((player) => player.team === key);
      return `<div class="arcade-lobby-team">
        <span class="arcade-lobby-team-label">${label}</span>
        ${players.map((player) => arcadeLobbyMemberRowHtml(player, lobby)).join('')}
        ${arcadeLobbyFreeRowHtml(perTeam - players.length)}
      </div>`;
    })
    .join('')}</div>`;
}
