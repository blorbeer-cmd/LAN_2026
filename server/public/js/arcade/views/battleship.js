import { connectSocket } from '../../socket.js';
import { escapeHtml } from '../../format.js';
import { icon } from '../../icons.js';
import { showToast } from '../../toast.js';
import { confirmDialog } from '../../modal.js';
import { getMyId } from '../../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { arcadeLobbyEntryHtml, arcadeLobbyHostActionsHtml, arcadeLobbyGuestActionsHtml, arcadeLobbyJoinHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadeResultListHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { createRematchController } from '../rematch.js';
import { playArcadeSound } from '../arcadeSound.js';
import { emptyStateHtml } from '../../emptyState.js';

const SIZE = 10;
const SHIPS = [
  { id: 'carrier', name: 'Flugzeugträger', code: 'F', length: 5 },
  { id: 'battleship', name: 'Schlachtschiff', code: 'S', length: 4 },
  { id: 'cruiser', name: 'Kreuzer', code: 'K', length: 3 },
  { id: 'submarine', name: 'U-Boot', code: 'U', length: 3 },
  { id: 'destroyer', name: 'Zerstörer', code: 'Z', length: 2 },
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
let lastShotKey = null; // last seen `${playerId}-${coordinate}-${kind}`, to fire the hit/miss/sunk cue only once per shot

const myId = () => getMyId();
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const rerenderIfBattleshipVisible = () => {
  if (currentView() === 'battleship' || currentView() === 'arcade') rerender();
};
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

// Revanche emits bypass the single-action guard above: request, ready and
// start may follow each other while the result screen is shown.
const rematch = createRematchController({
  prefix: 'battleship',
  emit: (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve)),
  myId: () => getMyId(),
  lobbies: () => lobbies,
  events: { create: 'battleship:lobby:create', bot: 'battleship:lobby:bot', join: 'battleship:lobby:join', ready: 'battleship:lobby:ready', start: 'battleship:lobby:start', leave: 'battleship:lobby:leave' },
  hostReady: true,
  playerName: (id) => match?.players.find((player) => player.id === id)?.name ?? 'Spieler',
  rerender: () => rerender(),
  onError: (message) => showToast(message, { error: true }),
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
    rerenderIfBattleshipVisible();
  });
  socket.on('disconnect', () => { connectionState = 'offline'; rerenderIfBattleshipVisible(); });
  socket.on('connect_error', () => { connectionState = 'offline'; rerenderIfBattleshipVisible(); });
  socket.on('battleship:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match && currentView() === 'arcade') rerender();
    if (match?.ended && currentView() === 'battleship') {
      rematch.onLobbies();
      rerender();
    }
  });
  socket.on('battleship:match:start', (payload) => {
    match = { ...payload, phase: 'setup', paused: false, ended: false, players: payload.players ?? [] };
    rematch.reset();
    placements = [];
    selectedCoordinate = null;
    lastShotKey = null;
    navigate('battleship');
  });
  socket.on('battleship:state', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    if (payload.currentPlayerId !== match.currentPlayerId || payload.phase !== match.phase || payload.paused !== match.paused) selectedCoordinate = null;
    if (payload.lastShot) {
      const shotKey = `${payload.lastShot.playerId}-${payload.lastShot.coordinate}-${payload.lastShot.kind}`;
      if (shotKey !== lastShotKey) {
        lastShotKey = shotKey;
        playArcadeSound(payload.lastShot.kind === 'hit' ? 'battleship-hit' : payload.lastShot.kind === 'sunk' ? 'battleship-sunk' : 'battleship-miss');
      }
    }
    match = { ...match, ...payload, ended: payload.phase === 'ended' };
    if (payload.phase === 'countdown' && payload.beginsAt) showCountdown(payload.beginsAt);
    if (currentView() === 'battleship') rerender();
  });
  socket.on('battleship:match:end', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    cancelCountdown();
    match = { ...match, ...payload, phase: 'ended', ended: true };
    rematch.capture({ mode: 'duel', players: match.players });
    if (match.winnerId) playArcadeSound(match.winnerId === myId() ? 'battleship-win' : 'battleship-lose');
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
    const placedShip = { shipId: ship.id, name: ship.name, cells };
    cells.forEach((cell) => occupied.set(cell, placedShip));
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

function shipCellPresentation(ship, cell) {
  const definition = SHIPS.find((entry) => entry.id === ship?.shipId);
  const cells = Array.isArray(ship?.cells) ? ship.cells : [];
  const index = cells.indexOf(cell);
  if (!definition || index < 0) return null;
  const orientation = cells.length > 1 && Math.abs(cells[1] - cells[0]) === SIZE ? 'vertical' : 'horizontal';
  const className = [
    'is-ship',
    'battleship-ship-segment',
    `is-ship-${orientation}`,
    index === 0 ? 'is-ship-start' : '',
    index === cells.length - 1 ? 'is-ship-end' : '',
    index < cells.length - 1 ? 'has-next-segment' : '',
  ].filter(Boolean).join(' ');
  return {
    className,
    attributes: `data-ship-id="${escapeHtml(definition.id)}" data-ship-code="${escapeHtml(definition.code)}"`,
    name: definition.name,
  };
}

function placementGridHtml() {
  const occupied = placementCells();
  return `<div class="battleship-grid battleship-placement-grid" role="grid" aria-label="Eigenes Flottenraster">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const segment = shipCellPresentation(occupied.get(cell), cell);
      const row = Math.floor(cell / SIZE);
      const col = cell % SIZE;
      return `<button type="button" class="battleship-cell ${segment?.className ?? ''}" data-place-cell="${cell}" ${segment?.attributes ?? ''} role="gridcell" aria-label="${String.fromCharCode(65 + col)} ${row + 1}${segment ? `, ${escapeHtml(segment.name)}` : ''}"></button>`;
    }).join('')}
  </div>`;
}

function matchControlsHtml() {
  if (match.ended) return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="battleship-back">Schließen</button>');
  // During placement nobody can pause yet, but everyone needs a way out.
  if (match.phase !== 'playing') return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="battleship-leave">Verlassen</button>');
  if (match.host?.id === myId()) {
    const pause = match.paused
      ? '<button type="button" class="btn btn-primary btn-sm" id="battleship-pause">Fortsetzen</button>'
      : '<button type="button" class="btn btn-sm" id="battleship-pause">Pausieren</button>';
    return arcadeMatchControlsHtml(`${pause}<button type="button" class="btn btn-sm" id="battleship-finish">Beenden</button>`);
  }
  return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="battleship-leave">Verlassen</button>');
}

function shellHtml(body) {
  return `<div class="arcade-game-shell${match.ended ? ' is-ended' : ''}" data-battleship-match="${escapeHtml(match.matchId)}">
    ${arcadeGameHeaderHtml('Battleship', matchControlsHtml(), { fullscreen: false })}
    <div class="grouped-page-sections">${body}</div>
  </div>`;
}

function renderPlacement() {
  const me = match.players.find((player) => player.id === myId());
  const locked = match.phase !== 'setup' || Boolean(me?.placementReady) || pendingAction;
  const readyPlayers = (match.players ?? []).filter((player) => player.placementReady).length;
  const submitDisabled = locked || !placementValid(placements);
  const missing = SHIPS.length - placements.length;
  const submitHint = !locked && missing > 0 ? `Es fehlen noch ${missing} von ${SHIPS.length} Schiffen` : '';
  const placed = new Set(placements.map((placement) => placement.shipId));
  return shellHtml(`
    <section class="card stack grouped-page-section battleship-setup" aria-labelledby="battleship-setup-title">
      <div class="grouped-page-section-title">
        <div class="arcade-section-heading"><h2 id="battleship-setup-title">Flotte platzieren</h2><span class="arcade-section-meta" aria-live="polite">Bereit ${readyPlayers}/${match.players.length}${me?.placementReady ? ' · Deine Flotte steht' : ''}</span></div>
        <div class="battleship-setup-header-actions">
          <button type="button" class="btn btn-sm" id="battleship-random" ${locked ? 'disabled' : ''}>Zufällig</button>
          <button type="button" class="btn btn-sm" id="battleship-clear" ${locked ? 'disabled' : ''}>Zurücksetzen</button>
          <button type="button" class="btn btn-primary btn-sm" id="battleship-submit-setup" ${submitDisabled ? 'disabled' : ''}${submitHint ? ` title="${submitHint}"` : ''}>${me?.placementReady ? 'Bestätigt' : 'Flotte bereit'}</button>
        </div>
      </div>
      <div class="battleship-setup-column">
      <div class="battleship-ship-picker" role="list" aria-label="Schiffe">
        ${SHIPS.map((ship) => `<button type="button" class="battleship-ship-option${selectedShip === ship.id ? ' is-selected' : ''}${placed.has(ship.id) ? ' is-placed' : ''}" data-select-ship="${ship.id}" aria-pressed="${selectedShip === ship.id}" ${locked ? 'disabled' : ''}>
          <span class="battleship-ship-length" aria-hidden="true">${'<i></i>'.repeat(ship.length)}</span>
          <span>${escapeHtml(ship.name)}</span>
          ${placed.has(ship.id) ? `<span class="battleship-ship-check">${icon('check', { label: 'platziert' })}</span>` : ''}
        </button>`).join('')}
      </div>
      <div class="arcade-mode-toggle battleship-orientation" role="group" aria-label="Ausrichtung">
        <button type="button" class="arcade-mode-toggle-btn${orientation === 'horizontal' ? ' is-active' : ''}" data-orientation="horizontal" aria-pressed="${orientation === 'horizontal'}" ${locked ? 'disabled' : ''}>Waagerecht</button>
        <button type="button" class="arcade-mode-toggle-btn${orientation === 'vertical' ? ' is-active' : ''}" data-orientation="vertical" aria-pressed="${orientation === 'vertical'}" ${locked ? 'disabled' : ''}>Senkrecht</button>
      </div>
      <div class="${locked ? 'battleship-placement-locked' : ''}" data-countdown-anchor>${placementGridHtml()}</div>
      </div>
    </section>`);
}

// A sunk ship is intentionally displayed like a plain hit during active play:
// naming the exact moment a whole ship (not just one segment) went down
// leaks its length/boundaries to the shooter. The full picture is only
// revealed once the match has ended (see renderResult/revealGridHtml).
function hideSunkDuringPlay(kind) { return kind === 'sunk' ? 'hit' : kind; }

function targetGridHtml(target, ownShots, canFire) {
  const shots = new Map(ownShots.filter((shot) => shot.targetId === target.id).map((shot) => [shot.coordinate, hideSunkDuringPlay(shot.kind)]));
  return `<div class="battleship-grid" role="grid" aria-label="Zielraster von ${escapeHtml(target.name)}">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const row = Math.floor(cell / SIZE);
      const col = cell % SIZE;
      const shot = shots.get(cell);
      const coordinateName = `${String.fromCharCode(65 + col)}${row + 1}`;
      const selected = selectedCoordinate === cell;
      const label = shot === 'miss' ? 'Wasser' : shot === 'hit' ? 'Treffer' : selected ? 'ausgewählt' : 'unbeschossen';
      return `<button type="button" class="battleship-cell ${shot ? `is-${shot}` : ''} ${selected ? 'is-selected' : ''}" data-fire-cell="${cell}" ${!canFire || shot || pendingAction ? 'disabled' : ''} role="gridcell" aria-label="${coordinateName}, ${label}" aria-selected="${selected}"></button>`;
    }).join('')}
  </div>`;
}

function ownGridHtml(player) {
  const ships = new Map();
  for (const ship of player.fleet ?? []) for (const cell of ship.cells ?? []) ships.set(cell, ship);
  const hits = new Set((player.fleet ?? []).flatMap((ship) => ship.hits ?? []));
  const misses = new Set((player.incomingShots ?? []).filter((shot) => shot.kind === 'miss').map((shot) => shot.coordinate));
  return `<div class="battleship-grid battleship-own-grid" role="grid" aria-label="Eigenes Flottenraster">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const row = Math.floor(cell / SIZE);
      const col = cell % SIZE;
      const coordinateName = `${String.fromCharCode(65 + col)}${row + 1}`;
      const isHit = hits.has(cell);
      const isMiss = !isHit && misses.has(cell);
      const segment = shipCellPresentation(ships.get(cell), cell);
      const label = isHit ? `Treffer auf ${segment?.name ?? 'Schiff'}` : isMiss ? 'Wasser beschossen' : segment ? segment.name : 'Unbeschossen';
      return `<div class="battleship-cell ${segment?.className ?? ''} ${isHit ? 'is-hit' : ''} ${isMiss ? 'is-miss' : ''}" data-own-cell="${cell}" ${segment?.attributes ?? ''} role="gridcell" aria-label="${coordinateName}, ${escapeHtml(label)}"></div>`;
    }).join('')}
  </div>`;
}

function renderBattle() {
  const me = match.players.find((player) => player.id === myId());
  const target = match.players.find((player) => player.id !== myId());
  if (!me || !target) return emptyStateHtml('Gegner nicht gefunden.');
  const canFire = match.phase === 'playing' && !match.paused && match.currentPlayerId === myId();
  const status = connectionState === 'offline'
    ? 'Verbindung verloren, wird wiederhergestellt'
    : match.paused ? 'Pause' : canFire ? 'Du bist am Zug' : `${escapeHtml(match.players.find((player) => player.id === match.currentPlayerId)?.name ?? 'Gegner')} ist am Zug`;
  const resultLabels = { miss: 'Wasser', hit: 'Treffer' };
  const lastShot = match.lastShot ? `Letzter Schuss: ${resultLabels[hideSunkDuringPlay(match.lastShot.kind)] ?? 'Aufgelöst'}` : '';
  const coordinate = selectedCoordinate !== null ? `${String.fromCharCode(65 + (selectedCoordinate % SIZE))}${Math.floor(selectedCoordinate / SIZE) + 1}` : '';
  const fire = canFire ? `<button type="button" class="btn btn-primary btn-sm" id="battleship-fire" ${selectedCoordinate === null || pendingAction ? 'disabled' : ''}>${coordinate ? `Feuern auf ${coordinate}` : 'Feld wählen'}</button>` : '';
  return shellHtml(`
    <section class="card arcade-stage battleship-stage" aria-live="polite" data-countdown-anchor>
      <div class="battleship-status-line"><strong class="${canFire ? 'is-turn' : ''}">${status}</strong>${lastShot ? `<span class="arcade-section-meta">${lastShot}</span>` : ''}</div>
      <div class="battleship-board-layout">
        <div class="battleship-board">
          <div class="battleship-board-head">
            <div class="arcade-section-heading"><h2 id="battleship-target-title">Ziel · ${escapeHtml(target.name)}</h2><span class="arcade-section-meta">${17 - (target.segmentsRemaining ?? 17)} Treffer · ${target.segmentsRemaining ?? 17} Felder übrig</span></div>
            ${fire}
          </div>
          ${targetGridHtml(target, me.shots ?? [], canFire)}
        </div>
        <div class="battleship-board">
          <div class="battleship-board-head">
            <div class="arcade-section-heading"><h2 id="battleship-own-title">Deine Flotte</h2><span class="arcade-section-meta">${me.shipsRemaining ?? 5} Schiffe · ${me.segmentsRemaining ?? 17} Felder</span></div>
          </div>
          ${ownGridHtml(me)}
        </div>
      </div>
    </section>`);
}

function revealGridHtml(player, fleet, shotsAgainst) {
  const ships = new Map();
  for (const ship of fleet) for (const cell of ship.cells ?? []) ships.set(cell, ship);
  const sunkCells = new Set(fleet.filter((ship) => ship.sunk).flatMap((ship) => ship.cells ?? []));
  const hitCells = new Set(fleet.flatMap((ship) => ship.hits ?? []));
  const missCells = new Set(shotsAgainst.filter((shot) => shot.kind === 'miss').map((shot) => shot.coordinate));
  return `<div class="battleship-grid battleship-own-grid" role="grid" aria-label="Aufgedeckte Flotte von ${escapeHtml(player.name)}">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const row = Math.floor(cell / SIZE);
      const col = cell % SIZE;
      const coordinateName = `${String.fromCharCode(65 + col)}${row + 1}`;
      const isSunk = sunkCells.has(cell);
      const isHit = !isSunk && hitCells.has(cell);
      const isMiss = !isSunk && !isHit && missCells.has(cell);
      const segment = shipCellPresentation(ships.get(cell), cell);
      const label = isSunk ? `${segment?.name ?? 'Schiff'} versenkt` : isHit ? `Treffer auf ${segment?.name ?? 'Schiff'}` : isMiss ? 'Wasser' : segment ? segment.name : 'Unbeschossen';
      return `<div class="battleship-cell ${segment?.className ?? ''} ${isHit ? 'is-hit' : ''} ${isSunk ? 'is-sunk' : ''} ${isMiss ? 'is-miss' : ''}" data-reveal-cell="${cell}" ${segment?.attributes ?? ''} role="gridcell" aria-label="${coordinateName}, ${escapeHtml(label)}"></div>`;
    }).join('')}
  </div>`;
}

function renderResult() {
  // On "player-left" the server names the remaining player as winner, so the
  // other one is who left.
  const leaver = match.reason === 'player-left' ? match.players.find((player) => player.id !== match.winnerId) : null;
  const reason = match.reason === 'aborted'
    ? 'Match beendet'
    : leaver
      ? leaver.id === myId() ? 'Du hast das Match verlassen' : `${escapeHtml(leaver.name)} hat das Match verlassen`
      : '';
  const rows = match.players
    .map((player) => {
      const opponent = match.players.find((entry) => entry.id !== player.id);
      const opponentFleet = (match.fleets ?? []).find((entry) => entry.playerId === opponent?.id)?.fleet ?? [];
      const hits = opponentFleet.reduce((sum, ship) => sum + (ship.hits?.length ?? 0), 0);
      const sunk = opponentFleet.filter((ship) => ship.sunk).length;
      const shots = (match.shots ?? []).filter((shot) => shot.playerId === player.id).length;
      return { player, winner: player.id === match.winnerId, value: `${hits} Treffer`, detail: [`${sunk} ${sunk === 1 ? 'Schiff' : 'Schiffe'} versenkt`, shots ? `${shots} Schüsse` : ''].filter(Boolean).join(' · '), hits };
    })
    .sort((a, b) => Number(b.winner) - Number(a.winner) || b.hits - a.hits);
  rows.forEach((row, index) => { row.place = index + 1; });
  const boards = match.players.map((player) => {
    const fleet = (match.fleets ?? []).find((entry) => entry.playerId === player.id)?.fleet ?? [];
    const shotsAgainst = (match.shots ?? []).filter((shot) => shot.targetId === player.id);
    return `<div class="battleship-board" data-battleship-reveal="${escapeHtml(player.id)}">
      <div class="battleship-board-head"><h2 id="battleship-reveal-${escapeHtml(player.id)}">Flotte · ${escapeHtml(player.name)}</h2></div>
      ${revealGridHtml(player, fleet, shotsAgainst)}
    </div>`;
  }).join('');
  return shellHtml(`
    <section class="card stack grouped-page-section" aria-labelledby="battleship-result-title">
      <div class="grouped-page-section-title">
        <div class="arcade-section-heading"><h2 id="battleship-result-title">Ergebnis</h2>${reason ? `<span class="arcade-section-meta">${reason}</span>` : ''}</div>
        ${rematch.actionHtml()}
      </div>
      ${arcadeResultListHtml(rows)}
    </section>
    <section class="card arcade-stage"><div class="battleship-board-layout">${boards}</div></section>`);
}

export function renderBattleship(container) {
  ensureBattleshipSocket();
  if (!match) {
    // Lobbies live on the Arcade hub; a direct or expired match link goes there.
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }
  container.innerHTML = match.ended ? renderResult() : match.phase === 'setup' || match.phase === 'countdown' ? renderPlacement() : renderBattle();
  if (match.phase === 'setup' || match.phase === 'countdown') wirePlacement(container);
  if (!match.ended && match.phase === 'playing') wireBattle(container);
  wireBattleshipGridKeyboard(container);
  wireArcadeToolbar(container);
  rematch.wire(container);
  container.querySelector('#battleship-leave')?.addEventListener('click', async () => {
    if (await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true })) {
      const result = await emitAck('battleship:match:leave', { matchId: match.matchId, playerId: myId() });
      if (!result?.ok) showToast(result?.error || 'Match konnte nicht verlassen werden.', { error: true });
    }
  });
  container.querySelector('#battleship-back')?.addEventListener('click', async () => {
    await rematch.close();
    match = null;
    cancelCountdown();
    navigate('arcade');
  });
}

function wirePlacement(container) {
  const me = match.players.find((player) => player.id === myId());
  if (match.phase !== 'setup' || me?.placementReady || pendingAction) return;
  container.querySelectorAll('[data-select-ship]').forEach((button) => button.addEventListener('click', () => { selectedShip = button.dataset.selectShip; rerender(); }));
  container.querySelectorAll('[data-orientation]').forEach((button) => button.addEventListener('click', () => { orientation = button.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal'; rerender(); }));
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
    if (!ship || !placementValid(next, false)) return showToast('Dieses Schiff passt dort nicht hin.', { error: true });
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
}

function lobbyEntryHtml(lobby) {
  const joined = lobby.players.some((player) => player.id === myId());
  const isHost = lobby.host.id === myId();
  const capacity = lobby.capacity ?? 2;
  const full = lobby.players.length >= capacity && !joined;
  const startReady = lobby.players.length === 2 && lobby.players.every((player) => player.ready);
  const startHint = startReady ? '' : lobby.players.length < 2 ? 'Mindestens 2 Spieler' : 'Noch nicht alle bereit';
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: `data-battleship-start="${lobby.id}"`, startEnabled: startReady, startHint, closeAttrs: `data-battleship-close="${lobby.id}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(lobby, myId(), 'battleship-ready'), leaveAttrs: `data-battleship-leave="${lobby.id}"` })
      : '';
  const joinAction = !joined ? arcadeLobbyJoinHtml(`data-battleship-join="${lobby.id}"`, full) : '';
  return arcadeLobbyEntryHtml(lobby, { gameType: 'battleship', meta: `Duell · ${lobby.players.length}/${capacity}`, joinAction, footerActions, full, capacity });
}

export function renderBattleshipLobbyEntries() {
  return lobbies.map((lobby) => ({ id: lobby.id, html: lobbyEntryHtml(lobby) }));
}

export async function createBattleshipLobby({ opponent = 'human' } = {}) {
  const result = opponent === 'bot'
    ? await emitAck('battleship:lobby:bot', { playerId: myId() })
    : await emitAck('battleship:lobby:create', { playerId: myId(), mode: 'duel' });
  if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return result;
}

export function wireBattleshipLobbyCard(container, { beforeJoin } = {}) {
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

// ---------- Spectator view: both fleets as the players see the boards ----------

function spectatorGridHtml(player) {
  const shots = new Map((player.shots ?? []).map((shot) => [shot.coordinate, hideSunkDuringPlay(shot.kind)]));
  return `<div class="battleship-grid" role="grid" aria-label="Raster von ${escapeHtml(player.name)}">
    ${Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const shot = shots.get(cell);
      const coordinateName = `${String.fromCharCode(65 + (cell % SIZE))}${Math.floor(cell / SIZE) + 1}`;
      const label = shot === 'miss' ? 'Wasser' : shot === 'hit' ? 'Treffer' : 'unbeschossen';
      return `<div class="battleship-cell ${shot ? `is-${shot}` : ''}" role="gridcell" aria-label="${coordinateName}, ${label}"></div>`;
    }).join('')}
  </div>`;
}

export function battleshipSpectatorHtml(state) {
  const ended = state.phase === 'ended';
  const boards = (state.players ?? []).map((player) => {
    const grid = ended && player.fleet
      ? revealGridHtml(player, player.fleet, (player.shots ?? []).map((shot) => ({ ...shot, targetId: player.id })))
      : spectatorGridHtml(player);
    return `<div class="battleship-board">
      <div class="battleship-board-head">
        <div class="arcade-section-heading"><h2>Flotte · ${escapeHtml(player.name)}</h2><span class="arcade-section-meta">${player.shipsRemaining ?? 5} Schiffe · ${player.segmentsRemaining ?? 17} Felder</span></div>
      </div>
      ${grid}
    </div>`;
  }).join('');
  return `<div class="battleship-board-layout">${boards}</div>`;
}
