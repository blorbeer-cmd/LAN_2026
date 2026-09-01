import { escapeHtml } from '../../format.js';
import { connectSocket } from '../../socket.js';
import { getMyId } from '../../whoami.js';
import { showToast } from '../../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeMuteControlHtml, wireArcadeMuteControl, playArcadeSound } from '../arcadeSound.js';
import { infoTooltipHtml } from '../../infoTooltip.js';
import { cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../../modal.js';
import { currentPlayerMayUseArcadeAi } from '../arcadeAdmin.js';
import { emptyStateHtml } from '../../emptyState.js';
import { backButtonHtml } from '../../backButton.js';

const PREVIEW_RETRY_MS = 1_000;

let socket = null; let lobbies = []; let challengeCatalog = []; let match = null; let prevMyScore = null;
let countdownKey = null; let startedKey = null; let presentationKey = null;
let countdownDeadline = null; let countdownTimer = null;
const selectedChallengeKeys = new Set();
let challengeSelectorOpen = false;
let currentTrial = null; let trialTimer = null; let previewRetryTimer = null; let interaction = freshInteraction(null);
// Whether this player has already completed the current challenge — the
// match itself stays in 'playing' until every player is done, but this
// player's own controls must stop accepting input immediately instead of
// silently swallowing further clicks as server-side duplicate-acks.
let iCompleted = false;
const myId = () => getMyId();
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
function navigate(view, options = {}) {
  window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: { view, ...options } }));
}
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }
function clearTrialTimer() { if (trialTimer !== null) clearTimeout(trialTimer); trialTimer = null; clearPreviewRetry(); }
function clearPreviewRetry() { if (previewRetryTimer !== null) clearInterval(previewRetryTimer); previewRetryTimer = null; }
function clearReadingCountdown() { if (countdownTimer !== null) clearInterval(countdownTimer); countdownTimer = null; countdownDeadline = null; }
function readingCountdownSeconds() { return Math.max(0, Math.ceil(Math.max(0, Number(countdownDeadline) - Date.now()) / 1000)); }
function updateReadingCountdown() {
  const seconds = readingCountdownSeconds();
  document.querySelectorAll('[data-cr-reading-countdown]').forEach((element) => { element.textContent = `Start in ${seconds} s`; });
}
function startReadingCountdown(remainingMs) {
  clearReadingCountdown();
  countdownDeadline = Date.now() + Math.max(0, Number(remainingMs) || 0);
  updateReadingCountdown();
  countdownTimer = setInterval(updateReadingCountdown, 200);
}
function rerenderIfVisible() { if (currentView() === 'challengeRush') rerender(); }
export function freshInteraction(trialId) {
  return { trialId, cells: [] };
}
// Re-sent events for the same trial occur after pause/resume and reconnect.
// Keep the player's unsent sequence/matrix input across those so a resend
// never silently discards what they already tapped.
export function nextInteractionState(previous, trial) {
  return previous.trialId === trial?.trialId ? { ...previous } : freshInteraction(trial?.trialId);
}
export function shouldPreserveInteractionOnMatchStart(previousMatch, nextMatch) {
  return nextMatch?.reconnected === true && previousMatch?.matchId === nextMatch?.matchId;
}
export function focusableTrialSelector() {
  return '[data-cr-choice], [data-cr-matrix-cell]';
}
function requestCurrentTrial() {
  if (!socket || !match?.matchId || match.phase !== 'playing') return;
  socket.emit('challenge-rush:trial:get', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex });
}
// Belt and braces alongside the server's own preview timer: the input phase
// still arrives if this client's preview request is never answered (a socket
// that dropped right after the emit). Unlike the input branch below there is
// no player action to fall back on during 'Merken', so the request repeats on
// a fixed interval until the server's 'challenge-rush:trial' replaces it.
function schedulePreviewRetry() {
  clearPreviewRetry();
  const trialId = currentTrial?.trialId;
  previewRetryTimer = setInterval(() => {
    if (currentTrial?.trialId !== trialId || currentTrial?.phase !== 'preview' || match?.paused || match?.phase !== 'playing') {
      clearPreviewRetry();
      return;
    }
    requestCurrentTrial();
  }, PREVIEW_RETRY_MS);
}
function scheduleTrialPhase() {
  clearTrialTimer();
  if (!currentTrial || match?.paused || match?.phase !== 'playing') return;
  const trialId = currentTrial.trialId;
  if (currentTrial.phase === 'preview') {
    trialTimer = setTimeout(() => {
      if (currentTrial?.trialId !== trialId || currentTrial.phase !== 'preview' || match?.paused) return;
      requestCurrentTrial();
      schedulePreviewRetry();
    }, Math.max(0, Number(currentTrial.phaseRemainingMs ?? currentTrial.phaseMs ?? 0)) + 20);
    return;
  }
  trialTimer = setTimeout(() => {
    if (currentTrial?.trialId !== trialId || currentTrial.phase !== 'input' || match?.paused) return;
    socket?.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, trialId, action: 'timeout' });
  }, Math.max(0, Number(currentTrial.inputRemainingMs ?? currentTrial.inputMs ?? 0)) + 20);
}
// A backgrounded tab has its timers throttled or suspended, so the local
// preview/input countdown above can come back arbitrarily late. Re-deriving
// the schedule from the server's own remaining-ms on the way back, and asking
// for the current trial, keeps a phone that was locked mid-challenge from
// resuming on a stale screen.
function handleVisibilityChange() {
  if (document.visibilityState !== 'visible' || !match?.matchId || match.phase !== 'playing') return;
  scheduleTrialPhase();
  requestCurrentTrial();
}
// Keeps the five-second in-card reading countdown and start sound stable per
// challenge. The global full-screen overlay is deliberately not used here:
// title and explanation must remain readable while answer-bearing playfields
// stay concealed until play starts.
function syncPresentation(state) {
  const key = `${state.matchId}:${state.challengeIndex}`;
  if (key !== presentationKey) {
    presentationKey = key; clearTrialTimer();
    iCompleted = false;
    currentTrial = null; interaction = freshInteraction(null);
  }
  if (state.phase === 'countdown' && !state.paused) {
    cancelCountdown();
    if (countdownKey !== key) { countdownKey = key; startReadingCountdown(state.remainingMs); }
  } else if (state.paused) {
    cancelCountdown(); clearReadingCountdown(); countdownKey = null;
  } else {
    cancelCountdown(); clearReadingCountdown();
  }
  if (state.phase === 'playing' && startedKey !== key) { startedKey = key; playArcadeSound('challenge-start'); }
}

function syncProgressFromServer(state) {
  const mine = state.progress?.find((entry) => entry.playerId === myId());
  if (!mine) return;
  iCompleted = mine.completed === true;
}

export function ensureChallengeRushSocket() {
  if (socket) return socket;
  socket = connectSocket();
  // Registered once alongside the socket (this whole block runs a single
  // time), so returning to a backgrounded tab always re-syncs the trial.
  document.addEventListener('visibilitychange', handleVisibilityChange);
  socket.on('challenge-rush:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    challengeCatalog = payload?.challenges ?? challengeCatalog;
    if (!match && currentView() === 'arcade') rerender();
  });
  socket.on('challenge-rush:match:start', (payload) => {
    const preserveInteraction = shouldPreserveInteractionOnMatchStart(match, payload);
    match = { ...payload }; prevMyScore = null; countdownKey = null; startedKey = null; clearReadingCountdown();
    if (!preserveInteraction) { currentTrial = null; interaction = freshInteraction(null); }
    navigate('challengeRush');
  });
  socket.on('challenge-rush:match:state', (payload) => {
    match = { ...match, ...payload };
    rerenderIfVisible();
  });
  socket.on('challenge-rush:state', (payload) => {
    match = { ...match, ...payload };
    syncPresentation(payload);
    syncProgressFromServer(payload);
    if (payload.phase !== 'playing') { currentTrial = null; clearTrialTimer(); }
    else if (currentTrial && payload.paused === false) scheduleTrialPhase();
    rerenderIfVisible();
  });
  socket.on('challenge-rush:trial', (payload) => {
    if (!match || payload?.matchId !== match.matchId || payload.challengeIndex !== match.challengeIndex) return;
    currentTrial = payload.trial;
    interaction = nextInteractionState(interaction, currentTrial);
    scheduleTrialPhase();
    rerenderIfVisible();
    queueMicrotask(() => document.querySelector(focusableTrialSelector())?.focus());
  });
  socket.on('challenge-rush:challenge:end', (payload) => {
    const myScore = payload.scores?.find((score) => score.playerId === myId())?.score;
    if (myScore !== undefined) {
      if (prevMyScore !== null && myScore > prevMyScore) playArcadeSound('challenge-point');
      prevMyScore = myScore;
    }
    if (currentView() === 'challengeRush') rerender();
  });
  socket.on('challenge-rush:match:end', (payload) => {
    cancelCountdown(); clearReadingCountdown(); clearTrialTimer(); currentTrial = null;
    match = { ...match, phase: 'ended', scores: payload.scores, draw: payload.draw === true, history: payload.history ?? match?.history ?? [] };
    if (payload.winnerId) playArcadeSound(payload.winnerId === myId() ? 'challenge-highscore' : 'challenge-gameover');
    else if (!payload.draw) playArcadeSound('challenge-gameover');
    if (currentView() === 'challengeRush') rerender();
  });
  socket.on('disconnect', () => { clearReadingCountdown(); if (match) match = { ...match, disconnected: true }; if (currentView() === 'challengeRush') rerender(); });
  socket.on('connect', () => { if (match?.matchId) socket.emit('challenge-rush:match:reconnect', { matchId: match.matchId, playerId: myId() }, (result) => {
    if (result?.ok) { match = { ...match, reconnected: true, disconnected: false }; if (currentView() === 'challengeRush') rerender(); return; }
    // Rejected reconnect means the server already forfeited us for exceeding
    // the reconnect grace period (attachSocket refuses a forfeited player) —
    // the match keeps running for the others, but nothing further will ever
    // arrive for it here. Clearing the stale local match immediately (rather
    // than leaving its pre-disconnect, not-yet-forfeited snapshot in place)
    // is what lets hasChallengeRushMatch() report free again, so this player
    // can start or join a new lobby right away instead of staying locked out
    // until a manual "Verlassen" or a page reload.
    const wasVisible = currentView() === 'challengeRush';
    match = null;
    if (wasVisible) {
      showToast('Challenge Rush wegen Zeitüberschreitung verlassen.', { error: true });
      navigate('arcade', { replace: true, localRoute: { kind: 'game', id: 'challenge-rush' } });
    }
  }); });
  window.addEventListener('respawn:challenge-rush-disconnect', () => socket?.disconnect());
  window.addEventListener('respawn:challenge-rush-connect', () => socket?.connect());
  window.addEventListener('respawn:identity-changed', () => {
    if (!currentPlayerMayUseArcadeAi()) selectedChallengeKeys.clear();
  });
  socket.emit('challenge-rush:lobbies:get');
  return socket;
}
export function challengeRushLobbies() { return lobbies; }
export function myChallengeRushLobby() { return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())); }
export function hasChallengeRushMatch() {
  const myScore = match?.scores?.find((score) => score.playerId === myId());
  return Boolean(match && match.phase !== 'ended' && myScore?.forfeited !== true);
}
export function leaveMyChallengeRushLobby() { const lobby = myChallengeRushLobby(); return lobby ? emit('challenge-rush:lobby:leave', { lobbyId: lobby.id, playerId: myId() }) : Promise.resolve({ ok: true }); }
function scoreText(scores = []) { return [...scores].sort((a, b) => b.score - a.score).map((score, index) => `<div class="challenge-rush-score-row"><span>${index + 1}. ${escapeHtml(score.name)}${score.forfeited ? ' · Forfait' : ''}</span><strong>${score.score}</strong></div>`).join(''); }
export function orderedChallengeSelection(catalog, selectedKeys) {
  const byKey = new Map(catalog.map((challenge) => [challenge.key, challenge]));
  return [...selectedKeys].map((key) => byKey.get(key)).filter(Boolean);
}
export function challengeSelectionForPlayer(catalog, selectedKeys, maySelect) {
  return maySelect ? orderedChallengeSelection(catalog, selectedKeys).map((challenge) => challenge.key) : [];
}
function selectedChallenges() { return orderedChallengeSelection(challengeCatalog, selectedChallengeKeys); }
function challengeSelectionPayload() { return challengeSelectionForPlayer(challengeCatalog, selectedChallengeKeys, currentPlayerMayUseArcadeAi()); }
function adminChallengeSelectorHtml(disabled) {
  if (!currentPlayerMayUseArcadeAi()) return '';
  const count = selectedChallenges().length;
  const choices = challengeCatalog.map((challenge) => `<label class="challenge-rush-test-option"><input type="checkbox" data-cr-challenge-key="${escapeHtml(challenge.key)}" ${selectedChallengeKeys.has(challenge.key) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><strong>${escapeHtml(challenge.title)}</strong><small class="muted">${escapeHtml(challenge.description)}</small></span></label>`).join('');
  return `<details class="challenge-rush-test-selector" ${challengeSelectorOpen ? 'open' : ''}><summary><strong>Testauswahl</strong><span class="muted" data-cr-selection-count>${count ? `${count} Aufgaben` : '10 zufällige Aufgaben'}</span></summary><div class="stack"><p class="muted" data-cr-selection-hint>${count ? 'Die markierten Aufgaben laufen einmal in dieser Reihenfolge.' : 'Ohne Auswahl startet das normale Spiel mit 10 zufälligen Aufgaben.'}</p><div class="row challenge-rush-test-actions"><button type="button" class="btn btn-sm" data-cr-select-all ${disabled ? 'disabled' : ''}>Alle auswählen</button><button type="button" class="btn btn-sm" data-cr-select-none ${disabled ? 'disabled' : ''}>Auswahl leeren</button></div><div class="challenge-rush-test-grid">${choices || '<p class="muted">Aufgaben werden geladen …</p>'}</div></div></details>`;
}
function syncChallengeSelectionControls(container) {
  const count = selectedChallenges().length;
  const countLabel = container.querySelector('[data-cr-selection-count]');
  const hint = container.querySelector('[data-cr-selection-hint]');
  if (countLabel) countLabel.textContent = count ? `${count} Aufgaben` : '10 zufällige Aufgaben';
  if (hint) hint.textContent = count ? 'Die markierten Aufgaben laufen einmal in dieser Reihenfolge.' : 'Ohne Auswahl startet das normale Spiel mit 10 zufälligen Aufgaben.';
}
export function renderChallengeRushLobbyCard() {
  const current = myChallengeRushLobby();
  const activeMatch = hasChallengeRushMatch();
  const cards = lobbies.map((lobby) => {
    const joined = lobby.players.some((p) => p.id === myId());
    const isHost = lobby.host.id === myId();
    const startReady = lobby.players.every((p) => p.ready || p.id === lobby.host.id);
    const startReason = startReady ? '' : 'Nicht alle Mitspieler sind bereit.';
    const footerActions = isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-primary" data-cr-start="${lobby.id}" ${startReady ? '' : 'disabled'}>Start</button>${startReason ? infoTooltipHtml(`cr-start-${lobby.id}`, 'Start nicht möglich', startReason, 'warning') : ''}<button type="button" class="btn btn-sm btn-equal btn-danger" data-cr-leave="${lobby.id}">Schließen</button>`
      : joined
        ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-cr-leave="${lobby.id}">Verlassen</button>${readyToggleHtml(lobby, myId(), 'cr-ready')}`
        : '';
    const joinDisabled = lobby.players.length >= 15 || activeMatch;
    const selectedTitles = (lobby.challengeKeys ?? []).map((key) => challengeCatalog.find((challenge) => challenge.key === key)?.title ?? key);
    const settingsHtml = selectedTitles.length ? `<p class="muted challenge-rush-lobby-selection"><strong>Testlauf:</strong> ${selectedTitles.map(escapeHtml).join(' · ')}</p>` : '';
    return arcadeLobbyEntryHtml(lobby, { full: lobby.players.length >= 15, joinAction: joined ? '' : `<button type="button" class="btn btn-sm btn-primary" data-cr-join="${lobby.id}" ${joinDisabled ? 'disabled' : ''}>Beitreten</button>`, settingsHtml, footerActions });
  }).join('');
  const noMe = !myId();
  const createReason = noMe
    ? 'Wähle zuerst aus, wer du bist.'
    : activeMatch
      ? 'Beende zuerst dein laufendes Challenge-Rush-Match.'
      : current
        ? 'Du hast bereits eine offene Lobby.'
        : '';
  const createDisabled = current || activeMatch || noMe;
  return `<div class="card stack arcade-lobby-card"><div class="arcade-lobby-create-actions">${adminChallengeSelectorHtml(Boolean(createDisabled))}<div class="arcade-lobby-create-row arcade-lobby-create-row--no-mode arcade-lobby-create-row--no-opponent"><button type="button" class="btn btn-primary btn-sm" id="cr-create" ${createDisabled ? 'disabled' : ''}>Lobby öffnen</button>${createReason ? infoTooltipHtml('cr-create-info', 'Lobby öffnen nicht möglich', createReason, 'warning') : ''}</div></div>${cards || emptyStateHtml('Keine offene Challenge-Rush-Lobby.', { style: 'padding:var(--space-4);' })}</div>`;
}
export function wireChallengeRushLobbyCard(container, { beforeCreate = async () => true, beforeJoin = async () => true } = {}) {
  const createPayload = () => { const keys = challengeSelectionPayload(); return keys.length ? { playerId: myId(), challengeKeys: keys } : { playerId: myId() }; };
  container.querySelector('.challenge-rush-test-selector')?.addEventListener('toggle', (event) => { challengeSelectorOpen = event.currentTarget.open; });
  container.querySelector('#cr-create')?.addEventListener('click', async () => {
    if (!(await beforeCreate())) return;
    const result = await emit('challenge-rush:lobby:create', createPayload());
    if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelectorAll('[data-cr-challenge-key]').forEach((checkbox) => checkbox.addEventListener('change', () => { if (checkbox.checked) selectedChallengeKeys.add(checkbox.dataset.crChallengeKey); else selectedChallengeKeys.delete(checkbox.dataset.crChallengeKey); syncChallengeSelectionControls(container); }));
  container.querySelector('[data-cr-select-all]')?.addEventListener('click', () => { challengeCatalog.forEach(({ key }) => selectedChallengeKeys.add(key)); container.querySelectorAll('[data-cr-challenge-key]').forEach((checkbox) => { checkbox.checked = true; }); syncChallengeSelectionControls(container); });
  container.querySelector('[data-cr-select-none]')?.addEventListener('click', () => { selectedChallengeKeys.clear(); container.querySelectorAll('[data-cr-challenge-key]').forEach((checkbox) => { checkbox.checked = false; }); syncChallengeSelectionControls(container); });
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
function trialGrid(size, selectedCells, attribute, disabled, showOrder = false, disableSelected = false) {
  const selected = new Set(selectedCells);
  const order = new Map(selectedCells.map((cell, index) => [cell, index + 1]));
  // The visible bullet/order-number marker on a selected cell is purely
  // visual; without an equivalent cue in the accessible name (which
  // otherwise always falls back to the plain "Feld N"), a screen-reader
  // player has no way to tell a marked memory-matrix cell from an unmarked
  // one and the challenge becomes unplayable non-visually.
  const cellLabel = (index) => showOrder && order.has(index) ? `Schritt ${order.get(index)}` : selected.has(index) ? `Feld ${index + 1}, markiert` : `Feld ${index + 1}`;
  return `<div class="challenge-rush-memory-grid" style="--cr-grid-columns:${size}">${Array.from({ length: size * size }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell${selected.has(index) ? ' is-selected' : ''}" data-cr-${attribute}="${index}" aria-label="${cellLabel(index)}" ${disabled || (disableSelected && selected.has(index)) ? 'disabled' : ''}>${showOrder && order.has(index) ? order.get(index) : selected.has(index) ? '•' : ''}</button>`).join('')}</div>`;
}
function trialOptions(trial, playing) {
  const options = Array.isArray(trial.data?.options) ? trial.data.options : [];
  return `<div class="challenge-rush-choice-grid">${options.map((option) => `<button type="button" class="btn challenge-rush-choice" data-cr-choice="${escapeHtml(String(option))}" ${playing && trial.phase === 'input' ? '' : 'disabled'}>${escapeHtml(String(option))}</button>`).join('')}</div>`;
}
function trialMatrix(trial, playing) {
  const data = trial.data ?? {};
  if (trial.phase === 'preview') return `${trialGrid(Number(data.size) || 3, data.highlights ?? [], 'preview-cell', true)}<p class="muted">Positionen merken …</p>`;
  return `${trialGrid(Number(data.size) || 3, interaction.cells, 'matrix-cell', !playing, false, true)}<p class="muted">${interaction.cells.length} / ${Number(data.highlightCount ?? 0)} Felder</p>`;
}
function trialChoice(trial, playing) {
  const data = trial.data ?? {};
  const matrix = Array.isArray(data.matrix) ? `<div class="challenge-rush-logic-matrix" role="grid" aria-label="Zwei mal zwei Zahlenmatrix">${data.matrix.flat().map((value, index) => `<span role="gridcell" aria-label="${index === 3 ? 'Gesuchte Zahl' : `Zahl ${escapeHtml(String(value))}`}">${value === null ? '?' : escapeHtml(String(value))}</span>`).join('')}</div>` : '';
  const letters = data.type === 'letter-choice' && Array.isArray(data.letters) ? `<div class="challenge-rush-letter-row" aria-label="Buchstaben: ${data.letters.map((letter) => escapeHtml(String(letter))).join(', ')}">${data.letters.map((letter) => `<span>${escapeHtml(String(letter))}</span>`).join('')}</div>` : '';
  const prompt = matrix || `<p class="challenge-rush-logic-prompt">${escapeHtml(String(data.prompt ?? ''))}</p>${letters}`;
  if (trial.phase === 'preview') return `${prompt}<div class="challenge-rush-item-list">${(data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="muted">Merken …</p>`;
  return `${prompt}${trialOptions(trial, playing)}`;
}
export function renderChallengeRushTrial(challenge, trial, playing = true) {
  if (!trial) return '<p class="muted">Der erste Trial erscheint gleich …</p>';
  if (['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum'].includes(challenge.key)) return trialChoice(trial, playing);
  if (challenge.key === 'memory-matrix') return trialMatrix(trial, playing);
  return '<p class="muted">Trial wird vorbereitet …</p>';
}
function challengeView() {
  const challenge = match?.challenge;
  // The match itself stays 'playing' until every player finishes this
  // challenge, so a player who's already done must stop being offered live
  // controls — folding !iCompleted into `playing` disables every button
  // below the same way the pre-start/paused states already do.
  const playing = match?.phase === 'playing' && !match?.paused && !iCompleted;
  const data = challenge?.data ?? {};
  let body = '<p class="muted">Bereithalten – gleich geht’s los …</p>';
  if (currentTrial) body = renderChallengeRushTrial(challenge, currentTrial, playing);
  // The reaction target's exact position is only rendered once play actually
  // starts, so nobody can pre-aim at it during the countdown (requirement:
  // reaction challenges must stay invisible until "Los!").
  if (!currentTrial && challenge?.key === 'reaction-circle') body = playing ? `<button type="button" class="challenge-rush-circle" data-cr-x="${data.x}" data-cr-y="${data.y}" style="left:${data.x}%;top:${data.y}%" aria-label="Kreis treffen"></button>` : '<p class="muted">Der Kreis erscheint, sobald es losgeht.</p>';
  if (challenge?.key === 'timing-10') body = `<button type="button" class="challenge-rush-big-button" data-cr-stop ${playing ? '' : 'disabled'}>STOPP</button><p class="muted">Keine laufende Zeit sichtbar – vertraue deinem Gefühl.</p>`;
  if (iCompleted && match?.phase === 'playing' && !match?.paused) {
    body = '<p class="muted">Fertig! Warte auf die anderen Mitspieler …</p>';
  }
  const playfieldHidden = match?.paused || match?.phase === 'countdown';
  if (playfieldHidden) {
    body = match?.paused
      ? '<div class="challenge-rush-concealed"><strong>Spiel pausiert</strong><p class="muted">Die Aufgabe bleibt sichtbar. Das Spielfeld erscheint erst nach dem Fortsetzen.</p></div>'
      : '<div class="challenge-rush-concealed"><strong data-cr-reading-countdown>Start in 5 s</strong><p class="muted">Lies die Aufgabe. Das Spielfeld erscheint bei „Los!“.</p></div>';
  }
  const phaseStatus = match?.paused
    ? 'Pause'
    : match?.phase === 'countdown'
      ? '<span data-cr-reading-countdown>Start in 5 s</span>'
      : 'Läuft';
  return `<section class="card stack challenge-rush-stage" data-match-id="${escapeHtml(match?.matchId ?? '')}" data-challenge-index="${match?.challengeIndex ?? -1}" data-phase="${escapeHtml(match?.phase ?? '')}" data-remaining-ms="${match?.remainingMs ?? ''}" data-reconnected="${match?.reconnected === true}" data-disconnected="${match?.disconnected === true}" data-challenge-key="${escapeHtml(challenge?.key ?? '')}" aria-live="polite"><div class="row-between"><span class="badge badge-playing">Challenge ${(match?.challengeIndex ?? 0) + 1} / ${match?.challengeCount ?? 4}</span><span>${phaseStatus}</span></div><h2>${escapeHtml(challenge?.title ?? 'Mini-Challenge')}</h2><p class="muted">${escapeHtml(challenge?.description ?? '')}</p><div class="challenge-rush-playfield${playfieldHidden ? ' is-concealed' : ''}" data-cr-playfield-hidden="${playfieldHidden}">${body}</div></section>`;
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
export function renderChallengeRush(container, _ctx) {
  ensureChallengeRushSocket();
  const scores = match?.scores ?? [];
  const body = match?.phase === 'ended'
    ? finalSummaryHtml(scores)
    : match?.phase === 'result'
      ? `${resultView()}${matchControlsHtml()}`
      : `${challengeView()}${matchControlsHtml()}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`;
  container.innerHTML = `<div class="arcade-game-shell">${backButtonHtml({ view: 'arcade' })}<h1 class="view-title">Challenge Rush</h1><div class="arcade-toolbar">${arcadeMuteControlHtml()}</div>${body}</div>`;
  if (match?.phase === 'countdown' && !match?.paused) updateReadingCountdown();
  wireArcadeMuteControl(container);
  container.querySelector('#cr-back')?.addEventListener('click', () => { clearReadingCountdown(); clearTrialTimer(); currentTrial = null; match = null; navigate('arcade'); });
  container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  container.querySelector('[data-cr-pause]')?.addEventListener('click', () => socket.emit('challenge-rush:match:pause', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true }); }));
  container.querySelector('[data-cr-finish]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich für alle beenden?', { confirmText: 'Beenden', danger: true }))) return; const result = await emit('challenge-rush:match:finish', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Beenden fehlgeschlagen.', { error: true }); });
  container.querySelector('[data-cr-leave-match]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return; const result = await emit('challenge-rush:match:leave', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) return showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true }); clearTrialTimer(); currentTrial = null; match = null; navigate('arcade'); });
  container.querySelector('#cr-ready-next')?.addEventListener('click', async () => { const result = await emit('challenge-rush:challenge:ready', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Bereit-Status fehlgeschlagen.', { error: true }); });
  const send = (action, value, onAccepted = () => {}) => {
    const sentTrialId = currentTrial?.trialId;
    socket.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, trialId: sentTrialId, action, value }, (result) => {
    if (!result?.ok && !result?.ignored) return showToast(result?.error || 'Eingabe abgelehnt.', { error: true });
    if (result?.ok && !result?.ignored && !result?.duplicate) {
      if (result.trial) {
        currentTrial = result.trial;
        interaction = nextInteractionState(interaction, currentTrial);
        scheduleTrialPhase();
      }
      // Reflected immediately from this ack instead of waiting for the next
      // full state broadcast — the match stays 'playing' until every player
      // finishes, so this player's own controls must stop accepting input
      // (and show a waiting state) the moment they're done, not several
      // silently-ignored duplicate acks later.
      if (result.progress?.completed) { iCompleted = true; rerender(); }
      onAccepted(sentTrialId ? result : result.progress);
    }
    });
  };
  container.querySelector('.challenge-rush-circle')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }); });
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-choice]').forEach((button) => button.addEventListener('click', () => send('choice', button.dataset.crChoice, () => { rerender(); container.querySelector('[data-cr-choice]')?.focus(); })));
  container.querySelectorAll('[data-cr-matrix-cell]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crMatrixCell);
    if (interaction.cells.includes(value)) return;
    interaction.cells.push(value);
    if (interaction.cells.length >= Number(currentTrial?.data?.highlightCount ?? 0)) send('cells', [...interaction.cells]);
    rerender();
    container.querySelector(`[data-cr-matrix-cell="${value}"]`)?.focus();
  }));
}
