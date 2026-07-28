import { connectSocket } from '../socket.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { showToast } from '../toast.js';
import { confirmDialog } from '../modal.js';
import { getMyId } from '../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeExpandControlHtml, wireArcadeExpandControl } from './arcadeUi.js';
import { currentPlayerMayUseArcadeAi } from './arcadeAdmin.js';

const SIZE = 10;
const SHIPS = [
  { id: 'carrier', name: 'Flugzeugträger', length: 5 },
  { id: 'battleship', name: 'Schlachtschiff', length: 4 },
  { id: 'cruiser', name: 'Kreuzer', length: 3 },
  { id: 'submarine', name: 'U-Boot', length: 3 },
  { id: 'destroyer', name: 'Zerstörer', length: 2 },
];

let socket = null;
let lobbies = [];
let match = null;
let placements = [];
let selectedShip = SHIPS[0].id;
let orientation = 'horizontal';
let selectedCoordinate = null;
let pendingAction = null;
let connectionState = 'connecting';

const myId = () => getMyId();
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => {
  if (pendingAction) return resolve({ ok: false, error: 'Eine Aktion wird noch verarbeitet.' });
  pendingAction = event;
  rerender();
  const timer = setTimeout(() => {
    pendingAction = null;
    rerender();
    resolve({ ok: false, error: 'Keine Antwort vom Server erhalten.' });
  }, 8000);
  socket.emit(event, payload, (result) => {
    clearTimeout(timer);
    pendingAction = null;
    rerender();
    resolve(result);
  });
});

export function battleshipLobbies() { return lobbies; }
export function myBattleshipLobby() { return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())) ?? null; }
export function hasBattleshipMatch() { return Boolean(match); }

export function ensureBattleshipSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('connect', () => {
    const returningAfterDisconnect = connectionState === 'offline';
    connectionState = 'connected';
    if (returningAfterDisconnect && match && !match.ended) {
      match = {
        ...match,
        phase: 'ended',
        ended: true,
        reason: 'player-left',
        winnerId: match.players.find((player) => player.id !== myId())?.id ?? null,
      };
      cancelCountdown();
    }
    rerender();
  });
  socket.on('disconnect', () => { connectionState = 'offline'; rerender(); });
  socket.on('connect_error', () => { connectionState = 'offline'; rerender(); });
  socket.on('battleship:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match && currentView() === 'arcade') rerender();
  });
  socket.on('battleship:match:start', (payload) => {
    match = { ...payload, phase: 'setup', paused: false, ended: false, players: payload.players ?? [] };
    placements = [];
    selectedCoordinate = null;
    navigate('battleship');
  });
  socket.on('battleship:state', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    if (payload.currentPlayerId !== match.currentPlayerId || payload.phase !== match.phase || payload.paused !== match.paused) selectedCoordinate = null;
    match = { ...match, ...payload, ended: payload.phase === 'ended' };
    if (payload.phase === 'countdown' && payload.beginsAt) showCountdown(payload.beginsAt);
    if (currentView() === 'battleship') rerender();
  });
  socket.on('battleship:match:end', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    cancelCountdown();
    match = { ...match, ...payload, phase: 'ended', ended: true };
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    if (currentView() === 'battleship' || currentView() === 'arcade') rerender();
  });
  return socket;
}

function cellsForPlacement(placement, length) {
  const cells = [];
  for (let offset = 0; offset < length; offset += 1) {
    const row = placement.row + (placement.orientation === 'vertical' ? offset : 0);
    const col = placement.col + (placement.orientation === 'horizontal' ? offset : 0);
    if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return null;
    cells.push(row * SIZE + col);
  }
  return cells;
}

function placementCells() {
  const occupied = new Map();
  for (const placement of placements) {
    const ship = SHIPS.find((entry) => entry.id === placement.shipId);
    const cells = ship ? cellsForPlacement(placement, ship.length) : null;
    if (!cells) continue;
    cells.forEach((cell) => occupied.set(cell, placement.shipId));
  }
  return occupied;
}

function placementValid(next, complete = true) {
  const occupied = new Set();
  for (const placement of next) {
    const ship = SHIPS.find((entry) => entry.id === placement.shipId);
    const cells = ship && cellsForPlacement(placement, ship.length);
    if (!cells || cells.some((cell) => occupied.has(cell))) return false;
    cells.forEach((cell) => occupied.add(cell));
  }
  return complete ? next.length === SHIPS.length : true;
}

function placementGridHtml() {
  const occupied = placementCells();
  return `<div class="battleship-grid battleship-placement-grid" role="grid" aria-label="Eigenes Flottenraster">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const shipId = occupied.get(cell);
      const row = Math.floor(cell / SIZE);
      const col = cell % SIZE;
      return `<button type="button" class="battleship-cell ${shipId ? 'is-ship' : ''}" data-place-cell="${cell}" role="gridcell" aria-label="${String.fromCharCode(65 + col)} ${row + 1}${shipId ? `, ${escapeHtml(SHIPS.find((ship) => ship.id === shipId).name)}` : ''}">${shipId ? '■' : ''}</button>`;
    }).join('')}
  </div>`;
}

function renderPlacement() {
  const me = match.players.find((player) => player.id === myId());
  const locked = match.phase !== 'setup' || Boolean(me?.placementReady) || pendingAction;
  const readyPlayers = (match.players ?? []).filter((player) => player.placementReady).length;
  return `<div class="arcade-game-shell" data-battleship-match="${escapeHtml(match.matchId)}">
    <h1 class="view-title">Schiffe versenken</h1>
    ${arcadeExpandControlHtml()}
    <section class="card stack battleship-setup" aria-labelledby="battleship-setup-title">
      <div class="grouped-page-section-title"><h2 id="battleship-setup-title">Flotte platzieren</h2></div>
      <p class="muted">Wähle ein Schiff und tippe auf das Startfeld. Berührungen zwischen Schiffen sind erlaubt.</p>
      <div class="battleship-ship-picker" role="list" aria-label="Schiffe">
        ${SHIPS.map((ship) => `<button type="button" class="btn btn-sm ${selectedShip === ship.id ? 'btn-primary' : ''}" data-select-ship="${ship.id}" aria-pressed="${selectedShip === ship.id}" ${locked ? 'disabled' : ''}>${escapeHtml(ship.name)} · ${ship.length}</button>`).join('')}
      </div>
      <div class="row battleship-setup-actions">
        <button type="button" class="btn btn-sm" id="battleship-rotate" ${locked ? 'disabled' : ''}>Drehen</button>
        <button type="button" class="btn btn-sm" id="battleship-random" ${locked ? 'disabled' : ''}>Zufällig platzieren</button>
        <button type="button" class="btn btn-sm" id="battleship-clear" ${locked ? 'disabled' : ''}>Zurücksetzen</button>
      </div>
      <div class="${locked ? 'battleship-placement-locked' : ''}">${placementGridHtml()}</div>
      <div class="muted" aria-live="polite">Bereit: ${readyPlayers}/${match.players.length}${locked ? ' · Deine Flotte ist bestätigt.' : ''}</div>
      <button type="button" class="btn btn-primary btn-block" id="battleship-submit-setup" ${locked || !placementValid(placements) ? 'disabled' : ''}>${locked ? 'Flotte bestätigt' : 'Flotte bereit'}</button>
    </section>
  </div>`;
}

function targetGridHtml(target, ownShots, canFire) {
  const shots = new Map(ownShots.filter((shot) => shot.targetId === target.id).map((shot) => [shot.coordinate, shot.kind]));
  return `<div class="battleship-grid" role="grid" aria-label="Zielraster von ${escapeHtml(target.name)}">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const row = Math.floor(cell / SIZE);
      const col = cell % SIZE;
      const shot = shots.get(cell);
      const coordinateName = `${String.fromCharCode(65 + col)}${row + 1}`;
      const selected = selectedCoordinate === cell;
      const label = shot === 'miss' ? 'Wasser' : shot === 'hit' ? 'Treffer' : shot === 'sunk' ? 'Versenkt' : selected ? 'ausgewählt' : 'unbeschossen';
      return `<button type="button" class="battleship-cell ${shot ? `is-${shot}` : ''} ${selected ? 'is-selected' : ''}" data-fire-cell="${cell}" ${!canFire || shot || pendingAction ? 'disabled' : ''} role="gridcell" aria-label="${coordinateName}, ${label}" aria-selected="${selected}">${shot === 'miss' ? '·' : shot ? '×' : selected ? '•' : ''}</button>`;
    }).join('')}
  </div>`;
}

function ownGridHtml(player) {
  const ships = new Map();
  for (const ship of player.fleet ?? []) for (const cell of ship.cells ?? []) ships.set(cell, ship);
  const hits = new Set((player.fleet ?? []).flatMap((ship) => ship.hits ?? []));
  return `<div class="battleship-grid battleship-own-grid" role="grid" aria-label="Eigenes Flottenraster">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => { const row = Math.floor(cell / SIZE); const col = cell % SIZE; const coordinateName = `${String.fromCharCode(65 + col)}${row + 1}`; const label = hits.has(cell) ? 'Treffer' : ships.has(cell) ? 'Schiff' : 'Wasser'; return `<div class="battleship-cell ${ships.has(cell) ? 'is-ship' : ''} ${hits.has(cell) ? 'is-hit' : ''}" role="gridcell" aria-label="${coordinateName}, ${label}">${hits.has(cell) ? '×' : ships.has(cell) ? '■' : ''}</div>`; }).join('')}
  </div>`;
}

function renderBattle() {
  const me = match.players.find((player) => player.id === myId());
  const target = match.players.find((player) => player.id !== myId());
  if (!me || !target) return '<div class="empty-state">Gegner nicht gefunden.</div>';
  const canFire = match.phase === 'playing' && !match.paused && match.currentPlayerId === myId();
  const status = match.paused ? 'Pause' : canFire ? 'Du bist am Zug' : `Warte auf ${escapeHtml(match.players.find((player) => player.id === match.currentPlayerId)?.name ?? 'Gegner')}`;
  const resultLabels = { miss: 'Wasser', hit: 'Treffer', sunk: 'Versenkt' };
  const result = match.lastShot ? `<div class="badge badge-playing" aria-live="polite">Letzter Schuss: ${resultLabels[match.lastShot.kind] ?? 'Aufgelöst'}</div>` : '';
  return `<div class="arcade-game-shell" data-battleship-match="${escapeHtml(match.matchId)}">
    <h1 class="view-title">Schiffe versenken</h1>
    ${arcadeExpandControlHtml()}
    <div class="battleship-status card" aria-live="polite"><strong>${connectionState === 'offline' ? 'Verbindung verloren' : status}</strong>${result}${connectionState === 'offline' ? '<span class="muted">Verbindung wird wiederhergestellt …</span>' : ''}</div>
    <div class="battleship-board-layout">
      <section class="card stack" aria-labelledby="battleship-target-title"><h2 id="battleship-target-title">Zielraster · ${escapeHtml(target.name)}</h2>${targetGridHtml(target, me.shots ?? [], canFire)}<p class="muted">Treffer: ${17 - (target.segmentsRemaining ?? 17)} · Verbleibend: ${target.segmentsRemaining ?? 17}</p>${canFire && selectedCoordinate !== null ? `<button type="button" class="btn btn-primary btn-block" id="battleship-fire" ${pendingAction ? 'disabled' : ''}>Feuern (${String.fromCharCode(65 + (selectedCoordinate % SIZE))}${Math.floor(selectedCoordinate / SIZE) + 1})</button>` : ''}</section>
      <section class="card stack" aria-labelledby="battleship-own-title"><h2 id="battleship-own-title">Deine Flotte</h2>${ownGridHtml(me)}<p class="muted">Eigene Schiffe: ${me.shipsRemaining ?? 5} · Felder: ${me.segmentsRemaining ?? 17}</p></section>
    </div>
    ${match.host?.id === myId() ? `<div class="arcade-match-controls"><button type="button" class="btn btn-sm" id="battleship-pause">${match.paused ? 'Fortsetzen' : 'Pausieren'}</button><button type="button" class="btn btn-sm btn-danger" id="battleship-finish">Beenden</button></div>` : `<div class="arcade-match-controls"><button type="button" class="btn btn-sm btn-danger" id="battleship-leave">Verlassen</button></div>`}
  </div>`;
}

function renderResult() {
  const winner = match.winnerId ? match.players.find((player) => player.id === match.winnerId) : null;
  return `<div class="arcade-game-shell"><h1 class="view-title">Schiffe versenken</h1><section class="card arcade-winner-card stack"><h2>${winner ? `${escapeHtml(winner.name)} gewinnt!` : 'Match beendet'}</h2><p class="muted">${match.reason === 'aborted' ? 'Das Match wurde beendet.' : match.reason === 'player-left' ? 'Ein Spieler hat das Match verlassen.' : 'Alle gegnerischen Schiffe wurden versenkt.'}</p><button type="button" class="btn btn-primary" id="battleship-back">Zur Arcade</button></section></div>`;
}

export function renderBattleship(container) {
  ensureBattleshipSocket();
  if (!match) {
    container.innerHTML = `<button type="button" class="btn btn-sm" data-navigate="arcade">${icon('chevronLeft')} Zurück</button><h1 class="view-title">Schiffe versenken</h1>${renderBattleshipLobbyCard()}`;
    wireBattleshipLobbyCard(container);
    return;
  }
  container.innerHTML = match.ended ? renderResult() : match.phase === 'setup' || match.phase === 'countdown' ? renderPlacement() : renderBattle();
  if (match.phase === 'setup' || match.phase === 'countdown') wirePlacement(container);
  if (!match.ended && match.phase === 'playing') wireBattle(container);
  wireBattleshipGridKeyboard(container);
  if (!match.ended) wireArcadeExpandControl(container);
  container.querySelector('#battleship-back')?.addEventListener('click', () => {
    match = null;
    cancelCountdown();
    navigate('arcade');
  });
}

function wirePlacement(container) {
  const me = match.players.find((player) => player.id === myId());
  if (match.phase !== 'setup' || me?.placementReady || pendingAction) return;
  container.querySelectorAll('[data-select-ship]').forEach((button) => button.addEventListener('click', () => { selectedShip = button.dataset.selectShip; rerender(); }));
  container.querySelector('#battleship-rotate')?.addEventListener('click', () => { orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal'; });
  container.querySelector('#battleship-clear')?.addEventListener('click', () => { placements = []; rerender(); });
  container.querySelector('#battleship-random')?.addEventListener('click', () => {
    const next = [];
    for (const ship of SHIPS) {
      let candidate = null;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        candidate = { shipId: ship.id, row: Math.floor(Math.random() * SIZE), col: Math.floor(Math.random() * SIZE), orientation: Math.random() > 0.5 ? 'horizontal' : 'vertical' };
        if (placementValid([...next, candidate], false)) break;
        candidate = null;
      }
      if (!candidate) return showToast('Zufällige Platzierung ist fehlgeschlagen. Bitte erneut versuchen.', { error: true });
      next.push(candidate);
    }
    placements = next;
    rerender();
  });
  container.querySelectorAll('[data-place-cell]').forEach((button) => button.addEventListener('click', () => {
    const cell = Number(button.dataset.placeCell);
    const ship = SHIPS.find((entry) => entry.id === selectedShip);
    const nextPlacement = { shipId: selectedShip, row: Math.floor(cell / SIZE), col: cell % SIZE, orientation };
    const next = [...placements.filter((placement) => placement.shipId !== selectedShip), nextPlacement];
    if (!ship || !placementValid(next)) return showToast('Dieses Schiff passt dort nicht hin.', { error: true });
    placements = next;
    const nextShip = SHIPS.find((entry) => !placements.some((placement) => placement.shipId === entry.id));
    if (nextShip) selectedShip = nextShip.id;
    rerender();
  }));
  container.querySelector('#battleship-submit-setup')?.addEventListener('click', async () => {
    const result = await emitAck('battleship:setup:submit', { matchId: match.matchId, playerId: myId(), placements });
    if (!result?.ok) showToast(result?.error || 'Flotte konnte nicht bestätigt werden.', { error: true });
    else rerender();
  });
}

function wireBattleshipGridKeyboard(container) {
  container.querySelectorAll('[role="grid"]').forEach((grid) => {
    const cells = [...grid.querySelectorAll('[role="gridcell"]')];
    if (!cells.length) return;
    cells.forEach((cell, index) => { cell.setAttribute('tabindex', index === 0 ? '0' : '-1'); });
    grid.addEventListener('keydown', (event) => {
      const current = cells.indexOf(document.activeElement);
      if (current < 0) return;
      let next = current;
      if (event.key === 'ArrowRight') next = Math.min(cells.length - 1, current + 1);
      else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
      else if (event.key === 'ArrowDown') next = Math.min(cells.length - 1, current + SIZE);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - SIZE);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = cells.length - 1;
      else if ((event.key === 'Enter' || event.key === ' ') && typeof cells[current].click === 'function') { event.preventDefault(); cells[current].click(); return; }
      else return;
      event.preventDefault();
      cells[current].setAttribute('tabindex', '-1');
      cells[next].setAttribute('tabindex', '0');
      cells[next].focus();
    });
  });
}

function wireBattle(container) {
  container.querySelectorAll('[data-fire-cell]').forEach((button) => button.addEventListener('click', () => {
    selectedCoordinate = Number(button.dataset.fireCell);
    rerender();
  }));
  container.querySelector('#battleship-fire')?.addEventListener('click', async () => {
    if (selectedCoordinate === null) return;
    const cell = selectedCoordinate;
    const result = await emitAck('battleship:shot:fire', { matchId: match.matchId, playerId: myId(), row: Math.floor(cell / SIZE), col: cell % SIZE });
    if (!result?.ok) showToast(result?.error || 'Schuss wurde nicht angenommen.', { error: true });
    else selectedCoordinate = null;
    rerender();
  });
  container.querySelector('#battleship-pause')?.addEventListener('click', async () => {
    const result = await emitAck(match.paused ? 'battleship:match:resume' : 'battleship:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Aktion konnte nicht ausgeführt werden.', { error: true });
  });
  container.querySelector('#battleship-finish')?.addEventListener('click', async () => {
    if (await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true })) {
      const result = await emitAck('battleship:match:finish', { matchId: match.matchId, playerId: myId() });
      if (!result?.ok) showToast(result?.error || 'Match konnte nicht beendet werden.', { error: true });
    }
  });
  container.querySelector('#battleship-leave')?.addEventListener('click', async () => {
    if (await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true })) {
      const result = await emitAck('battleship:match:leave', { matchId: match.matchId, playerId: myId() });
      if (!result?.ok) showToast(result?.error || 'Match konnte nicht verlassen werden.', { error: true });
    }
  });
}

function lobbyList() {
  if (!lobbies.length) return '<div class="empty-state" style="padding:var(--space-4);">Keine offene Lobby.</div>';
  return lobbies.map((lobby) => {
    const joined = lobby.players.some((player) => player.id === myId());
    const isHost = lobby.host.id === myId();
    const full = lobby.players.length >= (lobby.capacity ?? 2) && !joined;
    const footerActions = isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-battleship-close="${lobby.id}">Schließen</button><button type="button" class="btn btn-sm btn-equal btn-primary" data-battleship-start="${lobby.id}" ${lobby.players.length === 2 && lobby.players.every((player) => player.ready) ? '' : 'disabled'}>Start</button>`
      : joined
        ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-battleship-leave="${lobby.id}">Verlassen</button>${readyToggleHtml(lobby, myId(), 'battleship-ready')}`
        : '';
    const joinAction = !joined && !isHost ? `<button type="button" class="btn btn-sm btn-primary" data-battleship-join="${lobby.id}" ${full ? 'disabled' : ''}>Beitreten</button>` : '';
    return arcadeLobbyEntryHtml(lobby, { joinAction, footerActions, full });
  }).join('');
}

export function renderBattleshipLobbyCard() {
  const unavailable = myBattleshipLobby() || !myId();
  return `<div class="card stack arcade-lobby-card">${lobbyList()}<div class="arcade-lobby-create-actions"><button type="button" class="btn btn-primary btn-sm" id="battleship-create" ${unavailable ? 'disabled' : ''}>Lobby öffnen</button>${currentPlayerMayUseArcadeAi() ? `<button type="button" class="btn btn-sm" id="battleship-bot" ${unavailable ? 'disabled' : ''}>Gegen KI</button>` : ''}</div></div>`;
}

export function wireBattleshipLobbyCard(container, { beforeCreate, beforeJoin } = {}) {
  container.querySelector('#battleship-create')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const result = await emitAck('battleship:lobby:create', { playerId: myId(), mode: 'duel' });
    if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelector('#battleship-bot')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const result = await emitAck('battleship:lobby:bot', { playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelectorAll('[data-battleship-join]').forEach((button) => button.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const result = await emitAck('battleship:lobby:join', { lobbyId: button.dataset.battleshipJoin, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  container.querySelectorAll('[data-battleship-close], [data-battleship-leave]').forEach((button) => button.addEventListener('click', () => emitAck('battleship:lobby:leave', { lobbyId: button.dataset.battleshipClose || button.dataset.battleshipLeave, playerId: myId() })));
  wireReadyToggle(container, 'battleship-ready', async (lobbyId, ready) => {
    const result = await emitAck('battleship:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });
  container.querySelectorAll('[data-battleship-start]').forEach((button) => button.addEventListener('click', async () => {
    const result = await emitAck('battleship:lobby:start', { lobbyId: button.dataset.battleshipStart, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true });
  }));
}
