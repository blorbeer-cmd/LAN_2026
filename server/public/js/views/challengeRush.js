import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeMuteControlHtml, wireArcadeMuteControl, playArcadeSound } from '../arcadeSound.js';
import { infoTooltipHtml } from '../infoTooltip.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';

const COLOR_WORD_LABELS = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };
const COLOR_WORD_VARS = { red: 'var(--danger)', blue: 'var(--accent)', green: 'var(--state-playing)', yellow: 'var(--state-paused)' };
const MEMORY_REVEAL_STEP_MS = 700; const MEMORY_REVEAL_SHOW_MS = 500;

let socket = null; let lobbies = []; let match = null; let latestResult = null; let numberOrder = 1; let prevMyScore = null;
let countdownKey = null; let startedKey = null; let presentationKey = null;
// Shared "how far into the current sequence" pointer for aim-trainer,
// whack-a-mole, memory-sequence and color-word — only one of them is ever
// the active challenge at a time, so one counter is enough.
let progressStep = 0;
let memoryRevealDone = false; let memoryRevealIndex = -1; let trafficGreen = false;
let revealTimers = [];
const myId = () => getMyId();
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
function navigate(view) { window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view })); }
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }
function clearRevealTimers() { revealTimers.forEach(clearTimeout); revealTimers = []; }
function scheduleAt(delayMs, callback) { revealTimers.push(setTimeout(callback, Math.max(0, delayMs))); }
function rerenderIfVisible() { if (currentView() === 'challengeRush') rerender(); }
function elapsedInChallenge(state) { return (state.challenge?.durationMs ?? 0) - (state.remainingMs ?? 0); }
// Both timers below are purely presentational: the server independently
// validates timing from its own elapsed clock, so a client that paused,
// reconnected or drifted only ever sees a wrong *animation*, never an unfair
// score. Scheduling is re-derived from remainingMs on every relevant state
// push (challenge start, pause, resume) instead of running once, so it stays
// correct across those transitions.
function scheduleTrafficLight(state) {
  clearRevealTimers();
  const elapsed = elapsedInChallenge(state);
  const greenAtMs = Number(state.challenge?.data?.greenAtMs ?? 0);
  if (elapsed >= greenAtMs) { trafficGreen = true; return; }
  trafficGreen = false;
  scheduleAt(greenAtMs - elapsed, () => { trafficGreen = true; rerenderIfVisible(); });
}
function scheduleMemoryReveal(state) {
  clearRevealTimers();
  const sequence = state.challenge?.data?.sequence ?? [];
  const elapsed = elapsedInChallenge(state);
  sequence.forEach((tile, index) => {
    const showAt = index * MEMORY_REVEAL_STEP_MS; const hideAt = showAt + MEMORY_REVEAL_SHOW_MS;
    if (elapsed < showAt) scheduleAt(showAt - elapsed, () => { memoryRevealIndex = tile; rerenderIfVisible(); });
    if (elapsed < hideAt) scheduleAt(hideAt - elapsed, () => { memoryRevealIndex = -1; rerenderIfVisible(); });
  });
  const doneAt = sequence.length * MEMORY_REVEAL_STEP_MS;
  if (elapsed < doneAt) scheduleAt(doneAt - elapsed, () => { memoryRevealDone = true; memoryRevealIndex = -1; rerenderIfVisible(); });
  else memoryRevealDone = true;
}

// Drives the shared 3-2-1 overlay per challenge (not just once per match) and
// the start sound, keyed by match+challenge so re-renders/reconnects never
// replay either; a pause cancels the overlay and lets a resume re-show it
// against the recalculated remaining time.
function syncPresentation(state) {
  const key = `${state.matchId}:${state.challengeIndex}`;
  if (key !== presentationKey) {
    presentationKey = key; clearRevealTimers();
    progressStep = 0; memoryRevealDone = false; memoryRevealIndex = -1; trafficGreen = false;
  }
  if (state.phase === 'countdown' && !state.paused) {
    if (countdownKey !== key) { countdownKey = key; showCountdown(Date.now() + (state.remainingMs ?? 0)); }
  } else if (state.paused) {
    cancelCountdown(); countdownKey = null;
  } else {
    cancelCountdown();
  }
  if (state.phase === 'playing' && startedKey !== key) { startedKey = key; playArcadeSound('challenge-start'); }
  if (state.phase === 'playing' && !state.paused) {
    if (state.challenge?.key === 'traffic-light') scheduleTrafficLight(state);
    else if (state.challenge?.key === 'memory-sequence') scheduleMemoryReveal(state);
  } else if (state.phase !== 'playing') {
    clearRevealTimers();
  }
}

export function ensureChallengeRushSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('challenge-rush:lobbies', (payload) => { lobbies = payload?.lobbies ?? []; if (!match && currentView() === 'arcade') rerender(); });
  socket.on('challenge-rush:match:start', (payload) => { match = { ...payload }; latestResult = null; prevMyScore = null; countdownKey = null; startedKey = null; navigate('challengeRush'); });
  socket.on('challenge-rush:match:state', (payload) => { match = { ...match, ...payload }; if (currentView() === 'challengeRush') rerender(); });
  socket.on('challenge-rush:state', (payload) => { match = { ...match, ...payload }; if (payload.phase === 'countdown' && payload.challenge?.key === 'number-salad') numberOrder = 1; syncPresentation(payload); if (currentView() === 'challengeRush') rerender(); });
  socket.on('challenge-rush:challenge:end', (payload) => {
    latestResult = payload;
    const myScore = payload.scores?.find((score) => score.playerId === myId())?.score;
    if (myScore !== undefined) {
      if (prevMyScore !== null && myScore > prevMyScore) playArcadeSound('challenge-point');
      prevMyScore = myScore;
    }
    if (currentView() === 'challengeRush') rerender();
  });
  socket.on('challenge-rush:match:end', (payload) => {
    cancelCountdown();
    latestResult = payload;
    match = { ...match, phase: 'ended', scores: payload.scores, draw: payload.draw === true, history: payload.history ?? match?.history ?? [] };
    if (payload.winnerId) playArcadeSound(payload.winnerId === myId() ? 'challenge-highscore' : 'challenge-gameover');
    else if (!payload.draw) playArcadeSound('challenge-gameover');
    if (currentView() === 'challengeRush') rerender();
  });
  socket.on('disconnect', () => { if (match) match = { ...match, disconnected: true }; if (currentView() === 'challengeRush') rerender(); });
  socket.on('connect', () => { if (match?.matchId) socket.emit('challenge-rush:match:reconnect', { matchId: match.matchId, playerId: myId() }, (result) => { if (result?.ok) { match = { ...match, reconnected: true, disconnected: false }; if (currentView() === 'challengeRush') rerender(); } }); });
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
  if (challenge?.key === 'aim-trainer') {
    const targets = data.targets ?? []; const target = playing ? targets[progressStep] : null;
    body = target
      ? `<button type="button" class="challenge-rush-circle" data-cr-x="${target.x}" data-cr-y="${target.y}" aria-label="Ziel treffen" style="left:${target.x}%;top:${target.y}%"></button>`
      : '<p class="muted">Die Ziele erscheinen, sobald es losgeht.</p>';
    // Positioned as an absolute corner badge, not a normal-flow paragraph:
    // the target button is itself position:absolute (so it can sit anywhere
    // in the field), which pulls it out of the grid's auto-placed rows and
    // leaves a flow paragraph centered in the same cell — directly on top of
    // whichever target happens to render near the field's center.
    body += `<p class="muted challenge-rush-playfield-badge">${Math.min(progressStep, targets.length)} / ${targets.length} getroffen</p>`;
  }
  if (challenge?.key === 'memory-sequence') {
    const tileCount = data.tileCount ?? 9;
    const tiles = Array.from({ length: tileCount }, (_, index) => `<button type="button" class="challenge-rush-tile ${memoryRevealIndex === index ? 'is-active' : ''}" data-cr-tile="${index}" ${playing && memoryRevealDone ? '' : 'disabled'} aria-label="Feld ${index + 1}"></button>`).join('');
    body = `<div class="challenge-rush-tile-grid" style="grid-template-columns:repeat(3,1fr);">${tiles}</div><p class="muted">${!playing ? 'Bereithalten …' : memoryRevealDone ? `Feld ${progressStep + 1} von ${data.sequence?.length ?? 0}` : 'Merke dir die Reihenfolge …'}</p>`;
  }
  if (challenge?.key === 'odd-one-out') {
    const tileCount = data.tileCount ?? 16;
    const tiles = Array.from({ length: tileCount }, (_, index) => `<button type="button" class="challenge-rush-tile ${playing && index === data.oddIndex ? 'is-odd' : ''}" data-cr-tile="${index}" ${playing ? '' : 'disabled'} aria-label="Feld ${index + 1}"></button>`).join('');
    body = `<div class="challenge-rush-tile-grid" style="grid-template-columns:repeat(4,1fr);">${tiles}</div>`;
  }
  if (challenge?.key === 'whack-a-mole') {
    const holeCount = data.holeCount ?? 9; const active = playing ? data.sequence?.[progressStep] : null;
    const tiles = Array.from({ length: holeCount }, (_, index) => `<button type="button" class="challenge-rush-tile ${active === index ? 'is-active' : ''}" data-cr-tile="${index}" ${playing ? '' : 'disabled'} aria-label="Loch ${index + 1}"></button>`).join('');
    body = `<div class="challenge-rush-tile-grid" style="grid-template-columns:repeat(3,1fr);">${tiles}</div><p class="muted challenge-rush-target-progress">${Math.min(progressStep, data.sequence?.length ?? 0)} / ${data.sequence?.length ?? 0} getroffen</p>`;
  }
  if (challenge?.key === 'traffic-light') {
    body = `<button type="button" class="challenge-rush-traffic-light ${trafficGreen ? 'is-green' : 'is-red'}" data-cr-traffic ${playing ? '' : 'disabled'} aria-label="Klicken sobald Grün">${trafficGreen ? 'GRÜN' : 'ROT'}</button><p class="muted">Zu früh klicken zählt als Fehlstart.</p>`;
  }
  if (challenge?.key === 'color-word') {
    const rounds = data.rounds ?? []; const round = playing ? rounds[progressStep] : null;
    const word = round ? `<div class="challenge-rush-color-word" style="color:${COLOR_WORD_VARS[round.textColor] ?? 'inherit'}">${escapeHtml(round.word)}</div>` : '<p class="muted">Bereithalten …</p>';
    const options = round ? `<div class="challenge-rush-color-options">${round.options.map((key) => `<button type="button" class="btn challenge-rush-color-option" data-cr-color="${key}" style="border-color:${COLOR_WORD_VARS[key]};"><span class="challenge-rush-color-dot" style="background:${COLOR_WORD_VARS[key]};"></span>${COLOR_WORD_LABELS[key] ?? key}</button>`).join('')}</div>` : '';
    body = `${word}${options}<p class="muted challenge-rush-target-progress">${Math.min(progressStep, rounds.length)} / ${rounds.length}</p>`;
  }
  return `<section class="card stack challenge-rush-stage" data-match-id="${escapeHtml(match?.matchId ?? '')}" data-challenge-index="${match?.challengeIndex ?? -1}" data-phase="${escapeHtml(match?.phase ?? '')}" data-remaining-ms="${match?.remainingMs ?? ''}" data-reconnected="${match?.reconnected === true}" data-disconnected="${match?.disconnected === true}" data-challenge-key="${escapeHtml(challenge?.key ?? '')}" aria-live="polite"><div class="row-between"><span class="badge badge-playing">Challenge ${(match?.challengeIndex ?? 0) + 1} / ${match?.challengeCount ?? 4}</span><span>${match?.paused ? 'Pause' : match?.phase === 'countdown' ? 'Startet gleich' : 'Läuft'}</span></div><h2>${escapeHtml(challenge?.title ?? 'Mini-Challenge')}</h2><p class="muted">${escapeHtml(challenge?.description ?? '')}</p><div class="challenge-rush-playfield">${body}</div></section>`;
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
  ensureChallengeRushSocket();
  const scores = match?.scores ?? [];
  const body = match?.phase === 'ended'
    ? finalSummaryHtml(scores)
    : match?.phase === 'result'
      ? `${resultView()}${matchControlsHtml()}`
      : `${challengeView(container)}${matchControlsHtml()}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`;
  container.innerHTML = `<div class="arcade-game-shell"><button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><h1 class="view-title">Challenge Rush</h1><div class="arcade-toolbar">${arcadeMuteControlHtml()}</div>${body}</div>`;
  wireArcadeMuteControl(container);
  container.querySelector('#cr-back')?.addEventListener('click', () => { match = null; latestResult = null; navigate('arcade'); });
  container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  container.querySelector('[data-cr-pause]')?.addEventListener('click', () => socket.emit('challenge-rush:match:pause', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true }); }));
  container.querySelector('[data-cr-finish]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich für alle beenden?', { confirmText: 'Beenden', danger: true }))) return; const result = await emit('challenge-rush:match:finish', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Beenden fehlgeschlagen.', { error: true }); });
  container.querySelector('[data-cr-leave-match]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return; const result = await emit('challenge-rush:match:leave', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true }); });
  container.querySelector('#cr-ready-next')?.addEventListener('click', async () => { const result = await emit('challenge-rush:challenge:ready', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Bereit-Status fehlgeschlagen.', { error: true }); });
  const send = (action, value, onAccepted = () => {}) => socket.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, action, value }, (result) => { if (!result?.ok && !result?.ignored) return showToast(result?.error || 'Eingabe abgelehnt.', { error: true }); if (result?.ok && !result?.ignored && !result?.duplicate) onAccepted(result.progress); });
  container.querySelector('.challenge-rush-circle')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }, (progress) => { if (match?.challenge?.key === 'aim-trainer') { progressStep = progress.correct; rerender(); } }); });
  container.querySelector('.challenge-rush-big-button:not([data-cr-stop])')?.addEventListener('click', () => send('click', undefined, (progress) => { const counter = container.querySelector('#cr-clicks'); if (counter) counter.textContent = String(progress.clicks); }));
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-number]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crNumber); send('number', value, (progress) => { numberOrder = progress.correct + 1; if (progress.correct === value) button.disabled = true; }); }));
  container.querySelectorAll('[data-cr-tile]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crTile); const key = match?.challenge?.key;
    if (key === 'memory-sequence') send('tile', value, (progress) => { progressStep = progress.correct; rerender(); });
    else if (key === 'odd-one-out') send('select', value, () => rerender());
    else if (key === 'whack-a-mole') send('hit', value, (progress) => { progressStep = progress.correct; rerender(); });
  }));
  container.querySelector('[data-cr-traffic]')?.addEventListener('click', () => send('click', undefined, () => rerender()));
  container.querySelectorAll('[data-cr-color]').forEach((button) => button.addEventListener('click', () => send('answer', button.dataset.crColor, (progress) => { progressStep = progress.correct + progress.errors; rerender(); })));
}
