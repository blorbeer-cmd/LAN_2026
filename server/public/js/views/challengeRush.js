import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { infoTooltipHtml } from '../infoTooltip.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';

let socket = null; let lobbies = []; let match = null; let latestResult = null; let rerender = null; let numberOrder = 1;
let countdownKey = null; let startedKey = null; let audioCtx = null;
const myId = () => getMyId();
function navigate(view) { window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view })); }
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }
function refresh() { rerender?.(); }

function ensureAudioCtx() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { audioCtx = null; } }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
// Synthesized instead of shipped as an audio file (same reasoning as the
// kiosk push chime): no extra asset, same "Los!" tone on every device.
// Wrapped in try/catch since a blocked/missing AudioContext must never break the game itself.
function playStartTone() {
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.3);
  } catch { /* Ton ist optional, darf das Spiel nicht stören. */ }
}

// Drives the shared 3-2-1 overlay per challenge (not just once per match) and
// the start tone, keyed by match+challenge so re-renders/reconnects never
// replay either; a pause cancels the overlay and lets a resume re-show it
// against the recalculated remaining time.
function syncPresentation(state) {
  const key = `${state.matchId}:${state.challengeIndex}`;
  if (state.phase === 'countdown' && !state.paused) {
    if (countdownKey !== key) { countdownKey = key; showCountdown(Date.now() + (state.remainingMs ?? 0)); }
  } else if (state.paused) {
    cancelCountdown(); countdownKey = null;
  } else {
    cancelCountdown();
  }
  if (state.phase === 'playing' && startedKey !== key) { startedKey = key; playStartTone(); }
}

export function ensureChallengeRushSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('challenge-rush:lobbies', (payload) => { lobbies = payload?.lobbies ?? []; refresh(); });
  socket.on('challenge-rush:match:start', (payload) => { match = { ...payload }; latestResult = null; countdownKey = null; startedKey = null; navigate('challengeRush'); });
  socket.on('challenge-rush:match:state', (payload) => { match = { ...match, ...payload }; refresh(); });
  socket.on('challenge-rush:state', (payload) => { match = { ...match, ...payload }; if (payload.phase === 'countdown' && payload.challenge?.key === 'number-salad') numberOrder = 1; syncPresentation(payload); refresh(); });
  socket.on('challenge-rush:challenge:end', (payload) => { latestResult = payload; refresh(); });
  socket.on('challenge-rush:match:end', (payload) => { cancelCountdown(); latestResult = payload; match = { ...match, phase: 'ended', scores: payload.scores, draw: payload.draw === true, history: payload.history ?? match?.history ?? [] }; refresh(); });
  socket.on('disconnect', () => { if (match) match = { ...match, disconnected: true }; refresh(); });
  socket.on('connect', () => { if (match?.matchId) socket.emit('challenge-rush:match:reconnect', { matchId: match.matchId, playerId: myId() }, (result) => { if (result?.ok) { match = { ...match, reconnected: true, disconnected: false }; refresh(); } }); });
  window.addEventListener('respawn:challenge-rush-disconnect', () => socket?.disconnect());
  window.addEventListener('respawn:challenge-rush-connect', () => socket?.connect());
  socket.emit('challenge-rush:lobbies:get');
  return socket;
}
export function challengeRushLobbies() { return lobbies; }
export function myChallengeRushLobby() { return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())); }
export function hasChallengeRushMatch() { return Boolean(match && match.phase !== 'ended'); }
export function leaveMyChallengeRushLobby() { const lobby = myChallengeRushLobby(); return lobby ? emit('challenge-rush:lobby:leave', { lobbyId: lobby.id, playerId: myId() }) : Promise.resolve({ ok: true }); }
function scoreText(scores = []) { return [...scores].sort((a, b) => b.score - a.score).map((score, index) => `<div class="challenge-rush-score-row"><span>${index + 1}. ${escapeHtml(score.name)}${score.forfeited ? ' · Forfait' : ''}</span><strong>${score.score}</strong></div>`).join(''); }
export function renderChallengeRushLobbyCard() {
  const current = myChallengeRushLobby();
  const cards = lobbies.map((lobby) => {
    const joined = lobby.players.some((p) => p.id === myId());
    const isHost = lobby.host.id === myId();
    const startReady = lobby.players.every((p) => p.ready || p.id === lobby.host.id);
    const startReason = startReady ? '' : 'Nicht alle Mitspieler sind bereit.';
    const footerActions = isHost
      ? `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Schließen</button><span class="row" style="gap:var(--space-1);"><button type="button" class="btn btn-sm btn-primary" data-cr-start="${lobby.id}" ${startReady ? '' : 'disabled'}>Start</button>${startReason ? infoTooltipHtml(`cr-start-${lobby.id}`, 'Start nicht möglich', startReason, 'warning') : ''}</span>`
      : joined
        ? `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Verlassen</button>${readyToggleHtml(lobby, myId(), 'cr-ready')}`
        : '';
    return arcadeLobbyEntryHtml(lobby, { full: lobby.players.length >= 15, joinAction: joined ? '' : `<button type="button" class="btn btn-sm btn-primary" data-cr-join="${lobby.id}" ${lobby.players.length >= 15 ? 'disabled' : ''}>Beitreten</button>`, footerActions });
  }).join('');
  const noMe = !myId();
  const createReason = noMe ? 'Wähle zuerst aus, wer du bist.' : current ? 'Du hast bereits eine offene Lobby.' : '';
  return `<div class="card stack arcade-lobby-card"><div class="arcade-lobby-create-actions"><span class="row" style="gap:var(--space-1);"><button type="button" class="btn btn-primary btn-sm" id="cr-create" ${current || noMe ? 'disabled' : ''}>Lobby öffnen</button>${createReason ? infoTooltipHtml('cr-create-info', 'Lobby öffnen nicht möglich', createReason, 'warning') : ''}</span></div>${cards || '<div class="empty-state">Noch keine Lobby offen.</div>'}</div>`;
}
export function wireChallengeRushLobbyCard(container, { beforeCreate = async () => true, beforeJoin = async () => true } = {}) {
  container.querySelector('#cr-create')?.addEventListener('click', async () => { if (!(await beforeCreate())) return; const result = await emit('challenge-rush:lobby:create', { playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true }); });
  container.querySelectorAll('[data-cr-join]').forEach((button) => button.addEventListener('click', async () => { if (!(await beforeJoin())) return; const result = await emit('challenge-rush:lobby:join', { lobbyId: button.dataset.crJoin, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true }); }));
  container.querySelectorAll('[data-cr-leave]').forEach((button) => button.addEventListener('click', () => emit('challenge-rush:lobby:leave', { lobbyId: button.dataset.crLeave, playerId: myId() })));
  wireReadyToggle(container, 'cr-ready', async (lobbyId, ready) => { const result = await emit('challenge-rush:lobby:ready', { lobbyId, playerId: myId(), ready }); if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true }); });
  container.querySelectorAll('[data-cr-start]').forEach((button) => button.addEventListener('click', async () => { const result = await emit('challenge-rush:lobby:start', { lobbyId: button.dataset.crStart, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true }); }));
}
function matchControlsHtml() {
  if (!match || match.phase === 'ended') return '';
  const isHost = match.host?.id === myId();
  const pause = isHost ? `<button type="button" class="btn btn-sm btn-equal" data-cr-pause>${match.paused ? 'Fortsetzen' : 'Pausieren'}</button>` : '';
  const finish = isHost ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-cr-finish>Beenden</button>` : '';
  const leave = !isHost ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-cr-leave-match>Verlassen</button>` : '';
  return `<div class="arcade-match-controls">${pause}${finish}${leave}</div>`;
}
function challengeView(container) {
  const challenge = match?.challenge; const playing = match?.phase === 'playing' && !match?.paused; const data = challenge?.data ?? {};
  let body = '<p class="muted">Bereithalten – gleich geht’s los …</p>';
  // The reaction target's exact position is only rendered once play actually
  // starts, so nobody can pre-aim at it during the countdown (requirement:
  // reaction challenges must stay invisible until "Los!").
  if (challenge?.key === 'reaction-circle') body = playing ? `<button type="button" class="challenge-rush-circle" data-cr-x="${data.x}" data-cr-y="${data.y}" style="left:${data.x}%;top:${data.y}%" aria-label="Kreis treffen"></button>` : '<p class="muted">Der Kreis erscheint, sobald es losgeht.</p>';
  if (challenge?.key === 'cps') body = `<button type="button" class="challenge-rush-big-button" ${playing ? '' : 'disabled'}>KLICKEN</button><p class="muted">Klicks: <strong id="cr-clicks">0</strong></p>`;
  if (challenge?.key === 'number-salad') body = `<div class="challenge-rush-number-grid">${(data.numbers ?? []).map((number) => `<button type="button" class="btn challenge-rush-number" data-cr-number="${number}" ${playing ? '' : 'disabled'}>${number}</button>`).join('')}</div><p class="muted">Nächste Zahl: <strong>${numberOrder}</strong></p>`;
  if (challenge?.key === 'timing-10') body = `<button type="button" class="challenge-rush-big-button" data-cr-stop ${playing ? '' : 'disabled'}>STOPP</button><p class="muted">Keine laufende Zeit sichtbar – vertraue deinem Gefühl.</p>`;
  return `<section class="card stack challenge-rush-stage" data-match-id="${escapeHtml(match?.matchId ?? '')}" data-challenge-index="${match?.challengeIndex ?? -1}" data-phase="${escapeHtml(match?.phase ?? '')}" data-remaining-ms="${match?.remainingMs ?? ''}" data-reconnected="${match?.reconnected === true}" data-disconnected="${match?.disconnected === true}" aria-live="polite"><div class="row-between"><span class="badge badge-playing">Challenge ${(match?.challengeIndex ?? 0) + 1} / ${match?.challengeCount ?? 4}</span><span>${match?.paused ? 'Pause' : match?.phase === 'countdown' ? 'Startet gleich' : 'Läuft'}</span></div><h2>${escapeHtml(challenge?.title ?? 'Mini-Challenge')}</h2><p class="muted">${escapeHtml(challenge?.description ?? '')}</p><div class="challenge-rush-playfield">${body}</div></section>`;
}
function resultView() {
  const entry = match?.history?.[match.history.length - 1];
  if (!entry) return '';
  const rows = [...entry.scores].sort((a, b) => b.score - a.score).map((score, index) => `<div class="challenge-rush-score-row"><span>${index + 1}. ${escapeHtml(score.name)}</span><strong>${score.score}</strong></div>`).join('');
  const scores = match?.scores ?? [];
  const pending = scores.filter((score) => score.connected && !score.forfeited);
  const readyIds = new Set(match?.readyNext ?? []);
  const readyCount = pending.filter((score) => readyIds.has(score.playerId)).length;
  const iAmReady = readyIds.has(myId());
  return `<section class="card stack challenge-rush-result" aria-live="polite"><h2>${escapeHtml(entry.title)} – Ergebnis</h2><div class="challenge-rush-scoreboard">${rows}</div><button type="button" class="btn btn-primary btn-block" id="cr-ready-next" ${iAmReady ? 'disabled' : ''}>${iAmReady ? 'Warte auf Mitspieler …' : 'Bereit für die nächste Challenge'}</button><p class="muted challenge-rush-ready-count">${readyCount}/${pending.length} bereit</p></section>`;
}
function finalSummaryHtml(scores) {
  const history = match?.history ?? [];
  const rows = [...scores].sort((a, b) => b.score - a.score).map((score, index) => {
    const breakdown = history.map((entry) => `${escapeHtml(entry.title)}: ${entry.scores.find((s) => s.playerId === score.playerId)?.score ?? 0}`).join(' · ');
    return `<div class="challenge-rush-score-row challenge-rush-final-row"><div class="challenge-rush-final-row-main"><span>${index + 1}. ${escapeHtml(score.name)}${score.forfeited ? ' · Forfait' : ''}</span><strong>${score.score}</strong></div>${breakdown ? `<div class="challenge-rush-final-breakdown muted">${breakdown}</div>` : ''}</div>`;
  }).join('');
  return `<section class="card stack"><h2>${match?.draw ? 'Unentschieden' : 'Gesamtergebnis'}</h2><div class="challenge-rush-scoreboard">${rows}</div><button type="button" class="btn btn-primary" id="cr-back">Zur Arcade</button></section>`;
}
export function renderChallengeRush(container, ctx) {
  ensureChallengeRushSocket(); rerender = () => renderChallengeRush(container, ctx);
  const scores = match?.scores ?? [];
  const body = match?.phase === 'ended'
    ? finalSummaryHtml(scores)
    : match?.phase === 'result'
      ? `${resultView()}${matchControlsHtml()}`
      : `${challengeView(container)}${matchControlsHtml()}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`;
  container.innerHTML = `<div class="arcade-game-shell"><button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><h1 class="view-title">Challenge Rush</h1>${body}</div>`;
  container.querySelector('#cr-back')?.addEventListener('click', () => { match = null; latestResult = null; navigate('arcade'); });
  container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  container.querySelector('[data-cr-pause]')?.addEventListener('click', () => socket.emit('challenge-rush:match:pause', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true }); }));
  container.querySelector('[data-cr-finish]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich für alle beenden?', { confirmText: 'Beenden', danger: true }))) return; const result = await emit('challenge-rush:match:finish', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Beenden fehlgeschlagen.', { error: true }); });
  container.querySelector('[data-cr-leave-match]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return; const result = await emit('challenge-rush:match:leave', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true }); });
  container.querySelector('#cr-ready-next')?.addEventListener('click', async () => { const result = await emit('challenge-rush:challenge:ready', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Bereit-Status fehlgeschlagen.', { error: true }); });
  const send = (action, value, onAccepted = () => {}) => socket.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, action, value }, (result) => { if (!result?.ok && !result?.ignored) return showToast(result?.error || 'Eingabe abgelehnt.', { error: true }); if (result?.ok && !result?.ignored && !result?.duplicate) onAccepted(result.progress); });
  container.querySelector('.challenge-rush-circle')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }); });
  container.querySelector('.challenge-rush-big-button:not([data-cr-stop])')?.addEventListener('click', () => send('click', undefined, (progress) => { const counter = container.querySelector('#cr-clicks'); if (counter) counter.textContent = String(progress.clicks); }));
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-number]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crNumber); send('number', value, (progress) => { numberOrder = progress.correct + 1; if (progress.correct === value) button.disabled = true; }); }));
}
