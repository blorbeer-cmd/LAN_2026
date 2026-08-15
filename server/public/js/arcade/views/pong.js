import { connectSocket } from '../../socket.js';
import { avatarHtml, escapeHtml } from '../../format.js';
import { icon } from '../../icons.js';
import { showToast } from '../../toast.js';
import { getMyId } from '../../whoami.js';
import { currentPlayerMayUseArcadeAi } from '../arcadeAdmin.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../../modal.js';
import { arcadeLobbyEntryHtml, arcadeLobbyModeButtonsHtml, arcadeLobbyOpponentToggleHtml, readyToggleHtml, resetArcadeOpponentOnIdentityChange, wireArcadeOpponentToggle, wireReadyToggle } from '../lobbyReady.js';
import { arcadeToolbarHtml, matchRosterHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { playArcadeSound } from '../arcadeSound.js';
import { infoTooltipHtml } from '../../infoTooltip.js';
import { emptyStateHtml } from '../../emptyState.js';

const W = 960;
const H = 540;
const PADDLE_WIDTH = 16;
const PADDLE_HEIGHT = 112;
const BALL_RADIUS = 12;
const PLAYER_COLORS = ['#5b8cff', '#ef5da8']; // design-token-ok: canvas paddles use the two platform accents.

let socket = null;
let lobbies = [];
let match = null;
let previous = null;
let latest = null;
let latestAt = 0;
let animation = null;
let keyboardBound = false;
let keys = { up: false, down: false };
let targetScore = 7;
let lobbyMode = 'duel';
let pongOpponent = 'human';
let impact = null;
const trail = [];

const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const currentView = () => document.getElementById('view-container')?.dataset.view;

export function myPongLobby() {
  return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())) ?? null;
}

export function hasPongMatch() {
  return Boolean(match);
}

export function pongLobbies() {
  return lobbies;
}

export function ensurePongSocket() {
  if (socket) return socket;
  resetArcadeOpponentOnIdentityChange(() => { pongOpponent = 'human'; });
  socket = connectSocket();
  socket.on('pong:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match && currentView() === 'arcade') rerender();
  });
  socket.on('pong:match:start', (payload) => {
    match = { ...payload, ended: false, winner: null, paused: false, running: false };
    previous = latest = null;
    trail.length = 0;
    impact = null;
    navigate('pong');
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('pong:state', (payload) => {
    if (latest?.world?.ball && payload?.world?.ball && latest.world.ball.vx * payload.world.ball.vx < 0) {
      impact = { x: payload.world.ball.x, y: payload.world.ball.y, life: 1 };
      playArcadeSound('pong-hit');
    }
    previous = latest;
    latest = payload;
    latestAt = performance.now();
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
      match.scores = payload.scores;
      match.targetScore = payload.targetScore;
    }
    updateRoster();
    if (!document.querySelector('#pong-canvas') && currentView() === 'arcade') rerender();
  });
  socket.on('pong:point', (payload) => {
    if (match) match.scores = payload.scores;
    updateRoster();
    flashPoint(payload.scorer?.name);
    playArcadeSound('pong-score');
  });
  socket.on('pong:match:paused', () => { if (match) { match.paused = true; if (currentView() === 'pong') rerender(); } });
  socket.on('pong:match:resumed', () => { if (match) { match.paused = false; if (currentView() === 'pong') rerender(); } });
  socket.on('pong:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.winners = payload.winners ?? [];
    match.winnerTeam = payload.winnerTeam ?? null;
    match.scores = payload.scores ?? [];
    cancelCountdown();
    if (match.winner) {
      const winnerIds = match.winners.map((winner) => winner.id);
      const localPlayerWon = winnerIds.length
        ? winnerIds.includes(myId())
        : match.winner.id === myId();
      playArcadeSound(localPlayerWon ? 'pong-win' : 'pong-lose');
    }
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    stopAnimation();
    if (currentView() === 'pong' || currentView() === 'arcade') rerender();
  });
  bindKeyboard();
  return socket;
}

function modeLabel(mode) {
  return mode === 'doubles' ? 'Doppel' : 'Duell';
}

function teamLabel(team) {
  return team === 'left' ? 'Team Blau' : 'Team Pink';
}

function lobbyMemberRow(player, lobby) {
  const role = player.id === lobby.host.id ? 'Host' : player.ready ? 'Bereit' : 'Mitspieler';
  return `<div class="arcade-lobby-member-row">
    ${avatarHtml(player, 24)}
    <span class="player-name">${escapeHtml(player.name)}</span>
    <span class="arcade-lobby-member-role">${role}</span>
  </div>`;
}

function teamLobbyHtml(lobby, team, joined) {
  const players = lobby.players.filter((player) => player.team === team);
  const limit = lobby.mode === 'doubles' ? 2 : 1;
  const free = limit - players.length;
  const joinAction = !joined && free > 0
    ? `<button type="button" class="btn btn-sm btn-primary" data-pong-join="${lobby.id}" data-pong-team="${team}">Beitreten</button>`
    : '';
  return `<div class="tournament-section-panel">
    <div class="row-between"><strong>${teamLabel(team)}</strong><span class="badge">${players.length}/${limit}</span></div>
    <div class="arcade-lobby-member-list">
      ${players.map((player) => lobbyMemberRow(player, lobby)).join('')}
      ${free > 0 ? `<div class="arcade-lobby-member-row arcade-lobby-free-row">
        <span class="arcade-lobby-avatar-slot" aria-hidden="true"></span>
        <span class="muted arcade-lobby-free-label">${free} frei</span>
        ${joinAction}
      </div>` : ''}
    </div>
  </div>`;
}

function startReason(lobby) {
  const missing = lobby.playerLimit - lobby.players.length;
  if (missing > 0) return `Noch ${missing} ${missing === 1 ? 'Person' : 'Personen'} benötigt.`;
  const waiting = lobby.players.filter((player) => player.id !== lobby.host.id && !player.ready).length;
  return waiting > 0 ? `Noch ${waiting} ${waiting === 1 ? 'Person ist' : 'Personen sind'} nicht bereit.` : '';
}

function lobbyList() {
  if (!lobbies.length) return emptyStateHtml('Keine offene Pong-Lobby.', { style: 'padding:var(--space-4);' });
  return lobbies.map((lobby) => {
    const isHost = lobby.host.id === myId();
    const joined = lobby.players.some((player) => player.id === myId());
    const full = lobby.players.length >= lobby.playerLimit && !joined;
    const ready = lobby.players.length === lobby.playerLimit && lobby.players.every((player) => player.id === lobby.host.id || player.ready);
    const reason = isHost && !ready ? startReason(lobby) : '';
    const settingsHtml = isHost
      ? `<label class="arcade-lobby-target-score">
          <span>Punkte bis Sieg</span>
          <select name="pong-target" aria-label="Punkte bis Sieg">
            ${[5, 7, 10, 15, 21].map((score) => `<option value="${score}" ${score === targetScore ? 'selected' : ''}>${score}</option>`).join('')}
          </select>
        </label>`
      : '';
    const footerActions = isHost
      ? `<span class="row" style="gap:var(--space-1);">
          <button type="button" class="btn btn-sm btn-equal btn-primary" id="pong-start" ${ready ? '' : 'disabled'}>Start</button>
          ${reason ? infoTooltipHtml(`pong-start-${lobby.id}`, 'Start nicht möglich', reason, 'warning') : ''}
        </span>
        <button type="button" class="btn btn-sm btn-equal btn-danger" data-pong-close="${lobby.id}">Schließen</button>`
      : joined
        ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-pong-leave="${lobby.id}">Verlassen</button>
          ${readyToggleHtml(lobby, myId(), 'pong-ready')}`
        : '';
    if (lobby.mode === 'duel') {
      const joinAction = !joined && !isHost
        ? `<button type="button" class="btn btn-sm btn-primary" data-pong-join="${lobby.id}" data-pong-team="right" ${full ? 'disabled' : ''}>Beitreten</button>`
        : '';
      return `<div class="stack">
        <div class="row-between"><strong>${modeLabel(lobby.mode)}</strong><span class="badge">${lobby.players.length}/${lobby.playerLimit}</span></div>
        ${arcadeLobbyEntryHtml(lobby, { joinAction, settingsHtml, footerActions, full })}
      </div>`;
    }
    return `<div class="card stack arcade-lobby-entry">
      <div class="arcade-lobby-entry-head">
        <strong>${escapeHtml(lobby.host.name)}s Lobby</strong>
        <span class="badge">${modeLabel(lobby.mode)} · ${lobby.players.length}/${lobby.playerLimit}</span>
      </div>
      <div class="two-column-card-grid">
        ${teamLobbyHtml(lobby, 'left', joined)}
        ${teamLobbyHtml(lobby, 'right', joined)}
      </div>
      <div class="arcade-lobby-control-bar">
        ${settingsHtml ? `<div class="arcade-lobby-settings">${settingsHtml}</div>` : ''}
        ${footerActions ? `<div class="arcade-lobby-entry-actions">${footerActions}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

export function renderPongLobbyCard() {
  const lobby = myPongLobby();
  const noMe = !myId();
  const createReason = !noMe && match ? 'Beende zuerst dein aktuelles Spiel.' : '';
  const mayUseAi = currentPlayerMayUseArcadeAi();
  return `<div class="card stack arcade-lobby-card">
    ${noMe ? '<div class="muted" style="font-size:var(--font-size-xs);">Wähle oben zuerst aus, wer du bist.</div>' : ''}
    <div class="arcade-lobby-create-actions">
      <div class="arcade-lobby-create-row${lobby ? ' arcade-lobby-create-row--no-mode' : ''}${mayUseAi ? '' : ' arcade-lobby-create-row--no-opponent'}">
        ${!lobby ? arcadeLobbyModeButtonsHtml('pong-mode', 'Pong-Spielmodus', [
          { value: 'duel', label: 'Duell' },
          { value: 'doubles', label: 'Doppel' },
        ], lobbyMode) : ''}
        <button type="button" class="btn btn-primary btn-sm" id="pong-create" ${match || noMe ? 'disabled' : ''}>Lobby öffnen</button>
        ${createReason ? infoTooltipHtml('pong-create-info', 'Lobby öffnen nicht möglich', createReason, 'warning') : ''}
        ${mayUseAi ? arcadeLobbyOpponentToggleHtml('pong-opponent', pongOpponent, Boolean(match || noMe)) : ''}
      </div>
    </div>
    ${lobbyList()}
  </div>`;
}

export async function leaveMyPongLobby() {
  const lobby = myPongLobby();
  if (!lobby) return { ok: true };
  return emitAck('pong:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wirePongLobbyCard(container, { beforeCreate, beforeJoin } = {}) {
  container.querySelectorAll('select[name="pong-target"]').forEach((input) => input.addEventListener('change', () => { targetScore = Number(input.value); }));
  container.querySelectorAll('#pong-mode [data-arcade-mode]').forEach((button) => button.addEventListener('click', () => {
    lobbyMode = button.dataset.arcadeMode === 'doubles' ? 'doubles' : 'duel';
    targetScore = lobbyMode === 'doubles' ? 21 : 7;
    rerender();
  }));
  wireArcadeOpponentToggle(container, 'pong-opponent', (value) => {
    pongOpponent = value;
    rerender();
  });
  container.querySelector('#pong-create')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    if (pongOpponent === 'bot') {
      targetScore = lobbyMode === 'doubles' ? 21 : 7;
      const botResult = await emitAck('pong:lobby:bot', { playerId: myId(), mode: lobbyMode });
      if (!botResult?.ok) showToast(botResult?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
      return;
    }
    const result = await emitAck('pong:lobby:create', { playerId: myId(), mode: lobbyMode });
    if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelectorAll('[data-pong-join]').forEach((button) => button.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const result = await emitAck('pong:lobby:join', { lobbyId: button.dataset.pongJoin, playerId: myId(), team: button.dataset.pongTeam || 'auto' });
    if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  for (const [selector, attribute] of [['[data-pong-close]', 'pongClose'], ['[data-pong-leave]', 'pongLeave']]) {
    container.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => {
      emitAck('pong:lobby:leave', { lobbyId: button.dataset[attribute], playerId: myId() });
    }));
  }
  wireReadyToggle(container, 'pong-ready', async (lobbyId, ready) => {
    const result = await emitAck('pong:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });
  container.querySelector('#pong-start')?.addEventListener('click', async () => {
    const result = await emitAck('pong:lobby:start', { lobbyId: myPongLobby()?.id, playerId: myId(), targetScore });
    if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

function sendInput() {
  if (!match?.matchId || match.ended) return;
  socket.emit('pong:input', { matchId: match.matchId, playerId: myId(), input: keys });
}

function bindKeyboard() {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener('keydown', (event) => {
    if (!document.querySelector('#pong-canvas')) return;
    if (event.key === 'ArrowUp') keys.up = true;
    else if (event.key === 'ArrowDown') keys.down = true;
    else return;
    event.preventDefault();
    sendInput();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowUp') keys.up = false;
    else if (event.key === 'ArrowDown') keys.down = false;
    else return;
    sendInput();
  });
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function interpolatedWorld() {
  if (!latest?.world) return null;
  if (!previous?.world) return latest.world;
  const progress = Math.min(1, (performance.now() - latestAt + 50) / 100);
  return {
    ball: {
      x: lerp(previous.world.ball.x, latest.world.ball.x, progress),
      y: lerp(previous.world.ball.y, latest.world.ball.y, progress),
    },
    paddles: latest.world.paddles.map((paddle, index) => ({
      x: paddle.x,
      y: lerp(previous.world.paddles[index].y, paddle.y, progress),
      team: paddle.team,
      lane: paddle.lane,
      playerId: paddle.playerId,
    })),
  };
}

function drawArena(context) {
  const gradient = context.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, '#0e1530'); // design-token-ok: canvas arena uses a dark platform-tinted surface.
  gradient.addColorStop(0.52, '#111326'); // design-token-ok: canvas arena center needs a fixed neutral midpoint.
  gradient.addColorStop(1, '#241128'); // design-token-ok: canvas arena uses a dark platform-tinted surface.
  context.fillStyle = gradient;
  context.fillRect(0, 0, W, H);

  context.strokeStyle = 'rgba(145,99,245,.12)';
  context.lineWidth = 1;
  for (let x = 48; x < W; x += 48) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, H); context.stroke();
  }
  for (let y = 45; y < H; y += 45) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(W, y); context.stroke();
  }

  context.setLineDash([13, 16]);
  context.strokeStyle = 'rgba(226,232,255,.30)';
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(W / 2, 24); context.lineTo(W / 2, H - 24); context.stroke();
  if (match?.mode === 'doubles') {
    context.strokeStyle = 'rgba(226,232,255,.22)';
    context.lineWidth = 2;
    context.setLineDash([10, 12]);
    context.beginPath(); context.moveTo(24, H / 2); context.lineTo(W - 24, H / 2); context.stroke();
  }
  context.setLineDash([]);
  context.beginPath(); context.arc(W / 2, H / 2, 72, 0, Math.PI * 2); context.stroke();
}

function playerInitials(playerId, players = match?.players ?? []) {
  const name = players.find((player) => player.id === playerId)?.name?.trim();
  if (!name) return '';
  const parts = name.split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0].slice(0, 2)).toUpperCase();
}

function drawPaddle(context, paddle, color) {
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 24;
  const fill = context.createLinearGradient(paddle.x, paddle.y, paddle.x + PADDLE_WIDTH, paddle.y + PADDLE_HEIGHT);
  fill.addColorStop(0, '#ffffff'); // design-token-ok: canvas highlight keeps neon paddles legible.
  fill.addColorStop(0.22, color);
  fill.addColorStop(1, color);
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(paddle.x, paddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, 8);
  context.fill();
  const label = playerInitials(paddle.playerId);
  if (label) {
    context.shadowBlur = 0;
    context.fillStyle = '#ffffff'; // design-token-ok: canvas player initials need maximum contrast.
    context.font = '700 18px sans-serif';
    context.textBaseline = 'middle';
    context.textAlign = paddle.team === 'left' ? 'left' : 'right';
    context.fillText(
      label,
      paddle.team === 'left' ? paddle.x + PADDLE_WIDTH + 9 : paddle.x - 9,
      paddle.y + PADDLE_HEIGHT / 2
    );
  }
  context.restore();
}

function drawBall(context, ball) {
  trail.unshift({ x: ball.x, y: ball.y, life: 1 });
  if (trail.length > 14) trail.pop();
  trail.forEach((particle, index) => {
    particle.life *= 0.88;
    const radius = Math.max(2, BALL_RADIUS * (1 - index / trail.length) * .75);
    context.fillStyle = `rgba(145,99,245,${Math.max(0, particle.life * .24)})`;
    context.beginPath(); context.arc(particle.x, particle.y, radius, 0, Math.PI * 2); context.fill();
  });

  context.save();
  context.shadowColor = '#d9d5ff'; // design-token-ok: canvas ball glow uses a fixed pale accent.
  context.shadowBlur = 24;
  const fill = context.createRadialGradient(ball.x - 4, ball.y - 5, 2, ball.x, ball.y, BALL_RADIUS);
  fill.addColorStop(0, '#ffffff'); // design-token-ok: canvas ball highlight.
  fill.addColorStop(.64, '#e7e6ff'); // design-token-ok: canvas ball body.
  fill.addColorStop(1, '#9163f5'); // design-token-ok: canvas ball edge uses the brand accent.
  context.fillStyle = fill;
  context.beginPath(); context.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2); context.fill();
  context.restore();

  if (impact) {
    context.strokeStyle = `rgba(239,93,168,${impact.life * .7})`;
    context.lineWidth = 3;
    context.beginPath(); context.arc(impact.x, impact.y, 16 + (1 - impact.life) * 42, 0, Math.PI * 2); context.stroke();
    impact.life -= .055;
    if (impact.life <= 0) impact = null;
  }
}

function paint() {
  const canvas = document.querySelector('#pong-canvas');
  if (!canvas) return stopAnimation();
  const context = canvas.getContext('2d');
  const world = interpolatedWorld();
  drawArena(context);
  if (world) {
    world.paddles.forEach((paddle) => drawPaddle(context, paddle, PLAYER_COLORS[paddle.team === 'left' ? 0 : 1]));
    drawBall(context, world.ball);
  }
  animation = requestAnimationFrame(paint);
}

function startAnimation() {
  if (!animation) animation = requestAnimationFrame(paint);
}

function stopAnimation() {
  if (animation) cancelAnimationFrame(animation);
  animation = null;
}

function flashPoint(name) {
  const element = document.querySelector('#pong-point');
  if (!element) return;
  element.textContent = `Punkt für ${name || 'Spieler'}!`;
  element.hidden = false;
  setTimeout(() => { element.hidden = true; }, 900);
}

function updateRoster() {
  const roster = document.querySelector('#pong-roster');
  if (!roster || !match) return;
  roster.innerHTML = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    winnerIds: match.winners?.map((winner) => winner.id) ?? [],
    scoreFor: (player) => `${match.scores?.find((score) => score.playerId === player.id)?.score ?? 0}/${match.targetScore ?? targetScore}`,
    detailFor: playerDetail,
  });
}

function playerDetail(player) {
  if (match?.mode !== 'doubles') return teamLabel(player.team);
  const paddle = latest?.world?.paddles?.find((entry) => entry.playerId === player.id);
  const fallbackIndex = match.players.filter((entry) => entry.team === player.team).findIndex((entry) => entry.id === player.id);
  const lane = paddle?.lane ?? (fallbackIndex === 0 ? 'upper' : 'lower');
  return `${teamLabel(player.team)} · ${lane === 'upper' ? 'Oben' : 'Unten'}`;
}

function resultHtml() {
  if (!match?.ended) return '';
  const text = match.winnerTeam
    ? `${teamLabel(match.winnerTeam)} gewinnt!`
    : match.winner
      ? `${escapeHtml(match.winner.name)} gewinnt!`
      : 'Match beendet';
  return `<div class="card arcade-winner-card"><strong>${text}</strong><button class="btn btn-primary" id="pong-back">Zur Arcade</button></div>`;
}

function matchControlsHtml(isHost) {
  if (!match || match.ended) return '';
  if (!isHost) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!match.players.some((p) => p.id === myId())) return '';
    return `<div class="arcade-match-controls"><button class="btn btn-sm btn-equal btn-danger" id="pong-leave-match">Verlassen</button></div>`;
  }
  return `<div class="arcade-match-controls">${match.paused ? '<button class="btn btn-sm btn-equal btn-primary" id="pong-resume">Fortsetzen</button>' : '<button class="btn btn-sm btn-equal" id="pong-pause">Pausieren</button>'}<button class="btn btn-sm btn-equal btn-danger" id="pong-finish">Beenden</button></div>`;
}

export function renderPong(container) {
  ensurePongSocket();
  if (!match) {
    container.innerHTML = `<button class="btn btn-sm" data-navigate="arcade">${icon('chevronLeft')} Zurück</button><h1 class="view-title">Pong</h1>${renderPongLobbyCard()}`;
    wirePongLobbyCard(container);
    return;
  }
  const isHost = match.host?.id === myId();
  const roster = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    winnerIds: match.winners?.map((winner) => winner.id) ?? [],
    scoreFor: (player) => `${match.scores?.find((score) => score.playerId === player.id)?.score ?? 0}/${match.targetScore ?? targetScore}`,
    detailFor: playerDetail,
  });
  container.innerHTML = `<div class="arcade-game-shell"><h1 class="view-title">Pong</h1>${arcadeToolbarHtml()}<div id="pong-roster">${roster}</div>
    <div class="pong-arena"><canvas id="pong-canvas" width="${W}" height="${H}"></canvas><div id="pong-point" class="pong-point" hidden></div>${match.paused ? '<div class="pong-overlay">Pause</div>' : ''}</div>
    ${matchControlsHtml(isHost)}${resultHtml()}</div>`;
  wireGame(container);
  wireArcadeToolbar(container);
  startAnimation();
}

function wireGame(container) {
  wireTouchControls(container.querySelector('#pong-canvas'));
  container.querySelector('#pong-pause')?.addEventListener('click', async () => {
    const result = await emitAck('pong:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-resume')?.addEventListener('click', async () => {
    const result = await emitAck('pong:match:resume', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('pong:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#pong-leave-match')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const result = await emitAck('pong:match:leave', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-back')?.addEventListener('click', () => {
    match = null;
    previous = latest = null;
    trail.length = 0;
    stopAnimation();
    navigate('arcade');
  });
}

function wireTouchControls(canvas) {
  if (!canvas) return;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const dy = event.clientY - lastY;
    if (Math.abs(dy) < 8) return;
    keys.up = dy < 0;
    keys.down = dy > 0;
    lastY = event.clientY;
    sendInput();
  });
  const release = (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    keys.up = false;
    keys.down = false;
    sendInput();
    canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
