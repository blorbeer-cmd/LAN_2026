import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeMuteControlHtml, wireArcadeMuteControl, playArcadeSound } from '../arcadeSound.js';
import { infoTooltipHtml } from '../infoTooltip.js';
import { cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';
import { currentPlayerMayUseArcadeAi } from './arcadeAdmin.js';
import { emptyStateHtml } from '../emptyState.js';

const COLOR_WORD_LABELS = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };
const COLOR_WORD_VARS = { red: 'var(--danger)', blue: 'var(--accent)', green: 'var(--state-playing)', yellow: 'var(--state-paused)' };
const MEMORY_REVEAL_STEP_MS = 700; const MEMORY_REVEAL_SHOW_MS = 500;

let socket = null; let lobbies = []; let challengeCatalog = []; let match = null; let numberOrder = 1; let prevMyScore = null;
let countdownKey = null; let startedKey = null; let presentationKey = null;
let countdownDeadline = null; let countdownTimer = null;
const selectedChallengeKeys = new Set();
let currentTrial = null; let trialTimer = null; let interaction = freshInteraction(null);
// Shared "how far into the current sequence" pointer for aim-trainer,
// whack-a-mole, memory-sequence and color-word — only one of them is ever
// the active challenge at a time, so one counter is enough.
let progressStep = 0;
let memoryRevealDone = false; let memoryRevealIndex = -1; let trafficGreen = false;
// Whether this player has already completed the current challenge — the
// match itself stays in 'playing' until every player is done, but this
// player's own controls must stop accepting input immediately instead of
// silently swallowing further clicks as server-side duplicate-acks.
let iCompleted = false;
let revealTimers = [];
let oddOneOutSheet = null;
const myId = () => getMyId();
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
function navigate(view) { window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view })); }
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }
function clearRevealTimers() { revealTimers.forEach(clearTimeout); revealTimers = []; }
function clearTrialTimer() { if (trialTimer !== null) clearTimeout(trialTimer); trialTimer = null; }
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
function scheduleAt(delayMs, callback) { revealTimers.push(setTimeout(callback, Math.max(0, delayMs))); }
function rerenderIfVisible() { if (currentView() === 'challengeRush') rerender(); }
function focusTimedChallengeTarget(state) {
  const selector = timedChallengeFocusSelector(state);
  if (!selector) return;
  queueMicrotask(() => {
    if (currentView() !== 'challengeRush') return;
    document.querySelector(selector)?.focus();
  });
}
function elapsedInChallenge(state) { return (state.challenge?.durationMs ?? 0) - (state.remainingMs ?? 0); }
export function freshInteraction(trialId, resume = {}) {
  const found = new Set(Array.isArray(resume.found) ? resume.found : []);
  const pair = Array.isArray(resume.revealed) ? [...resume.revealed] : [];
  const cards = [...(Array.isArray(resume.foundCards) ? resume.foundCards : []), ...(Array.isArray(resume.revealedCards) ? resume.revealedCards : [])];
  const values = new Map(cards.map((card) => [card.index, card.value]));
  return { trialId, sequence: [], cells: [], pair, found, values, revealSeq: Number(resume.revealSeq ?? 0) };
}
// Re-sent events for the same trial occur after pause/resume and reconnect.
// Keep unsent sequence/matrix input, but merge the server's newer authoritative
// pair state so a lost reveal acknowledgement cannot leave the board stale.
export function nextInteractionState(previous, trial) {
  if (previous.trialId !== trial?.trialId) return freshInteraction(trial?.trialId, trial?.resume);
  const resumed = freshInteraction(trial?.trialId, trial?.resume);
  if (resumed.revealSeq < previous.revealSeq) return { ...previous };
  return {
    ...previous,
    pair: resumed.pair,
    found: resumed.found,
    values: resumed.values,
    revealSeq: Math.max(previous.revealSeq, resumed.revealSeq),
  };
}
export function pairHideStillApplies(state, trialId, revealSeq) {
  return state.trialId === trialId && state.revealSeq === revealSeq;
}
export function shouldPreserveInteractionOnMatchStart(previousMatch, nextMatch) {
  return nextMatch?.reconnected === true && previousMatch?.matchId === nextMatch?.matchId;
}
export function focusableTrialSelector() {
  return '[data-cr-choice], [data-cr-bool], [data-cr-sequence-cell], [data-cr-matrix-cell], [data-cr-number-position], [data-cr-pair-card]';
}
export function timedChallengeFocusSelector(state) {
  if (state?.phase !== 'playing' || state?.paused) return '';
  if (state?.challenge?.key === 'aim-trainer') return '.challenge-rush-circle';
  if (state?.challenge?.key === 'whack-a-mole') return '.challenge-rush-tile.is-active';
  return '';
}
export function acknowledgedRevealSeq(currentRevealSeq, serverRevealSeq) {
  return Number.isSafeInteger(serverRevealSeq) && serverRevealSeq >= 0
    ? serverRevealSeq
    : Number(currentRevealSeq) + 1;
}
function clearOddOneOutPresentation() {
  oddOneOutSheet?.replaceSync('');
}
function applyOddOneOutPresentation(container, oddIndex) {
  const grid = container.querySelector('.challenge-rush-odd-grid');
  const position = Number(oddIndex);
  if (!grid || !Number.isInteger(position) || position < 0 || position >= grid.children.length) return;
  if (!oddOneOutSheet) {
    oddOneOutSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, oddOneOutSheet];
  }
  // The selected index lives only in a constructed presentation stylesheet:
  // no field or ancestor attribute, text node, or accessible name identifies
  // the answer. Computed geometry remains available to visual browser tests.
  oddOneOutSheet.replaceSync(`.challenge-rush-odd-grid > .challenge-rush-tile:nth-child(${position + 1}) { border-radius: var(--cr-odd-radius); background: color-mix(in srgb, var(--bg-elevated-2) 88%, var(--accent) 12%); }`);
}
function scheduleTrialPhase() {
  clearTrialTimer();
  if (!currentTrial || match?.paused || match?.phase !== 'playing') return;
  const trialId = currentTrial.trialId;
  if (currentTrial.phase === 'preview') {
    trialTimer = setTimeout(() => {
      if (currentTrial?.trialId !== trialId || currentTrial.phase !== 'preview' || match?.paused) return;
      socket?.emit('challenge-rush:trial:get', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex });
    }, Math.max(0, Number(currentTrial.phaseRemainingMs ?? currentTrial.phaseMs ?? 0)) + 20);
    return;
  }
  trialTimer = setTimeout(() => {
    if (currentTrial?.trialId !== trialId || currentTrial.phase !== 'input' || match?.paused) return;
    socket?.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, trialId, action: 'timeout' });
  }, Math.max(0, Number(currentTrial.inputRemainingMs ?? currentTrial.inputMs ?? 0)) + 20);
}
// The reveal animation is purely presentational: the server independently
// validates timing from its own elapsed clock, so a client that paused,
// reconnected or drifted only ever sees a wrong *animation*, never an unfair
// score. Scheduling is re-derived from remainingMs on every relevant state
// push while actually playing (challenge start, resume) instead of running
// once, so it stays correct across those transitions. Unlike the sequence
// itself (which the player is meant to see and memorize), the traffic
// light's exact green moment is never sent to the client at all — the
// server pushes a dedicated event right when it happens (see
// 'challenge-rush:traffic-light:green' below), so no script can precompute
// the reaction window.
function scheduleMemoryReveal(state) {
  clearRevealTimers();
  const sequence = state.challenge?.data?.sequence ?? [];
  const elapsed = elapsedInChallenge(state);
  memoryRevealIndex = -1;
  sequence.forEach((tile, index) => {
    const showAt = index * MEMORY_REVEAL_STEP_MS; const hideAt = showAt + MEMORY_REVEAL_SHOW_MS;
    // The first tile's showAt is exactly 0, so "elapsed < showAt" never fires
    // for it (elapsed is never negative) — a tile already inside its show
    // window (covers both that boundary case and a mid-reveal reconnect)
    // must be shown immediately instead of only ever being scheduled.
    if (elapsed >= showAt && elapsed < hideAt) memoryRevealIndex = tile;
    else if (elapsed < showAt) scheduleAt(showAt - elapsed, () => { memoryRevealIndex = tile; rerenderIfVisible(); });
    if (elapsed < hideAt) scheduleAt(hideAt - elapsed, () => { memoryRevealIndex = -1; rerenderIfVisible(); });
  });
  const doneAt = sequence.length * MEMORY_REVEAL_STEP_MS;
  if (elapsed < doneAt) scheduleAt(doneAt - elapsed, () => { memoryRevealDone = true; memoryRevealIndex = -1; rerenderIfVisible(); });
  else memoryRevealDone = true;
}

// Keeps the five-second in-card reading countdown and start sound stable per
// challenge. The global full-screen overlay is deliberately not used here:
// title and explanation must remain readable while answer-bearing playfields
// stay concealed until play starts.
function syncPresentation(state) {
  const key = `${state.matchId}:${state.challengeIndex}`;
  if (key !== presentationKey) {
    presentationKey = key; clearRevealTimers(); clearTrialTimer();
    progressStep = 0; memoryRevealDone = false; memoryRevealIndex = -1; trafficGreen = false; iCompleted = false;
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
  // Pausing mid-'playing' must stop the reveal timers too, not just leaving
  // 'playing' entirely — otherwise the memory-reveal animation keeps running
  // in real time while the match is frozen, and replays part of the
  // sequence again once resumed.
  if (state.phase === 'playing' && !state.paused && state.challenge?.key === 'memory-sequence') scheduleMemoryReveal(state);
  else clearRevealTimers();
  // The server-derived boolean (see publicState's trafficLightGreen) is the
  // source of truth for whether the light has already turned green — a
  // reload/reconnect only ever gets a fresh state push, never a replay of
  // the one-shot 'challenge-rush:traffic-light:green' event, so relying on
  // that event alone would leave a reconnected client stuck on red forever.
  if (state.challenge?.key === 'traffic-light') trafficGreen = state.trafficLightGreen === true;
}

// Restores this client's own progress within the current challenge from the
// server's authoritative count instead of always starting from 0 — without
// this, a reload/reconnect mid-round would desync the client (e.g. Aim
// Trainer rendering target 0 again while the server already expects the
// next one) and reject every further input as "Ungültiges Ziel." until the
// round times out.
function syncProgressFromServer(state) {
  const mine = state.progress?.find((entry) => entry.playerId === myId());
  if (!mine) return;
  progressStep = state.challenge?.key === 'color-word' ? mine.correct + mine.errors : mine.correct;
  iCompleted = mine.completed === true;
}

export function ensureChallengeRushSocket() {
  if (socket) return socket;
  socket = connectSocket();
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
    if (currentView() === 'challengeRush') { rerender(); focusTimedChallengeTarget(match); }
  });
  socket.on('challenge-rush:state', (payload) => {
    match = { ...match, ...payload };
    if (payload.phase === 'countdown' && payload.challenge?.key === 'number-salad') numberOrder = 1;
    syncPresentation(payload);
    syncProgressFromServer(payload);
    if (payload.phase !== 'playing') { currentTrial = null; clearTrialTimer(); }
    else if (currentTrial && payload.paused === false) scheduleTrialPhase();
    if (currentView() === 'challengeRush') { rerender(); focusTimedChallengeTarget(match); }
  });
  socket.on('challenge-rush:trial', (payload) => {
    if (!match || payload?.matchId !== match.matchId || payload.challengeIndex !== match.challengeIndex) return;
    currentTrial = payload.trial;
    interaction = nextInteractionState(interaction, currentTrial);
    scheduleTrialPhase();
    rerenderIfVisible();
    queueMicrotask(() => document.querySelector(focusableTrialSelector())?.focus());
  });
  socket.on('challenge-rush:traffic-light:green', (payload) => {
    if (!match || payload?.matchId !== match.matchId || payload?.challengeIndex !== match.challengeIndex) return;
    trafficGreen = true;
    rerenderIfVisible();
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
    cancelCountdown(); clearReadingCountdown(); clearTrialTimer(); clearRevealTimers(); currentTrial = null;
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
    if (wasVisible) { showToast('Challenge Rush wegen Zeitüberschreitung verlassen.', { error: true }); navigate('arcade'); }
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
  return `<details class="challenge-rush-test-selector"><summary><strong>Testauswahl</strong><span class="muted" data-cr-selection-count>${count ? `${count} Aufgaben` : '10 zufällige Aufgaben'}</span></summary><div class="stack"><p class="muted" data-cr-selection-hint>${count ? 'Die markierten Aufgaben laufen einmal in dieser Reihenfolge.' : 'Ohne Auswahl startet das normale Spiel mit 10 zufälligen Aufgaben.'}</p><div class="row challenge-rush-test-actions"><button type="button" class="btn btn-sm" data-cr-select-all ${disabled ? 'disabled' : ''}>Alle auswählen</button><button type="button" class="btn btn-sm" data-cr-select-none ${disabled ? 'disabled' : ''}>Auswahl leeren</button></div><div class="challenge-rush-test-grid">${choices || '<p class="muted">Aufgaben werden geladen …</p>'}</div></div></details>`;
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
      ? `<span class="row" style="gap:var(--space-1);"><button type="button" class="btn btn-sm btn-primary" data-cr-start="${lobby.id}" ${startReady ? '' : 'disabled'}>Start</button>${startReason ? infoTooltipHtml(`cr-start-${lobby.id}`, 'Start nicht möglich', startReason, 'warning') : ''}</span><button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Schließen</button>`
      : joined
        ? `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Verlassen</button>${readyToggleHtml(lobby, myId(), 'cr-ready')}`
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
  return `<div class="card stack arcade-lobby-card"><div class="arcade-lobby-create-actions">${adminChallengeSelectorHtml(Boolean(createDisabled))}<span class="row" style="gap:var(--space-1);"><button type="button" class="btn btn-primary btn-sm" id="cr-create" ${createDisabled ? 'disabled' : ''}>Lobby öffnen</button>${createReason ? infoTooltipHtml('cr-create-info', 'Lobby öffnen nicht möglich', createReason, 'warning') : ''}</span>${currentPlayerMayUseArcadeAi() ? `<button type="button" class="btn btn-sm" id="cr-bot" ${createDisabled ? 'disabled' : ''}>Gegen KI</button>` : ''}</div>${cards || emptyStateHtml('Noch keine Lobby offen.')}</div>`;
}
export function wireChallengeRushLobbyCard(container, { beforeCreate = async () => true, beforeJoin = async () => true } = {}) {
  const createPayload = () => { const keys = challengeSelectionPayload(); return keys.length ? { playerId: myId(), challengeKeys: keys } : { playerId: myId() }; };
  container.querySelector('#cr-create')?.addEventListener('click', async () => { if (!(await beforeCreate())) return; const result = await emit('challenge-rush:lobby:create', createPayload()); if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true }); });
  container.querySelector('#cr-bot')?.addEventListener('click', async () => { if (!(await beforeCreate())) return; const result = await emit('challenge-rush:lobby:bot', createPayload()); if (!result?.ok) showToast(result?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true }); });
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
function trialSequence(trial, playing) {
  const data = trial.data ?? {};
  const preview = Array.isArray(data.sequence) ? data.sequence : Array.isArray(data.path) ? data.path : [];
  if (trial.phase === 'preview') return `${trialGrid(Number(data.size) || 3, preview, 'preview-cell', true, true)}<p class="muted">Merken …</p>`;
  const length = Number(data.sequenceLength ?? data.pathLength ?? 0);
  return `${trialGrid(Number(data.size) || 3, interaction.sequence, 'sequence-cell', !playing, true, true)}<p class="muted">${interaction.sequence.length} / ${length} Felder</p>`;
}
function trialMatrix(trial, playing) {
  const data = trial.data ?? {};
  if (trial.phase === 'preview') return `${trialGrid(Number(data.size) || 3, data.highlights ?? [], 'preview-cell', true)}<p class="muted">Positionen merken …</p>`;
  return `${trialGrid(Number(data.size) || 3, interaction.cells, 'matrix-cell', !playing, false, true)}<p class="muted">${interaction.cells.length} / ${Number(data.highlightCount ?? 0)} Felder</p>`;
}
function trialNumberBlind(trial, playing) {
  const data = trial.data ?? {}; const size = Number(data.size) || 3;
  if (trial.phase === 'preview') {
    const numbers = new Map((data.numbers ?? []).map((entry) => [entry.position, entry.number]));
    return `<div class="challenge-rush-memory-grid" style="--cr-grid-columns:${size}">${Array.from({ length: size * size }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell${numbers.has(index) ? ' is-selected' : ''}" disabled aria-label="${numbers.has(index) ? `Zahl ${numbers.get(index)}` : `Leeres Feld ${index + 1}`}">${numbers.get(index) ?? ''}</button>`).join('')}</div><p class="muted">Positionen merken …</p>`;
  }
  return `${trialGrid(size, interaction.sequence, 'number-position', !playing, true, true)}<p class="muted">${interaction.sequence.length} / ${Number(data.numberCount ?? 0)} Zahlen</p>`;
}
function trialPairs(trial, playing) {
  const cards = Array.isArray(trial.data?.cards) ? trial.data.cards : [];
  return `<div class="challenge-rush-pairs-grid" style="--cr-grid-columns:${Number(trial.data?.boardSize) || 2}">${cards.map((card) => {
    const found = interaction.found.has(card.index); const visible = found || interaction.pair.includes(card.index);
    const value = interaction.values.get(card.index);
    return `<button type="button" class="btn challenge-rush-memory-card${visible ? ' is-selected' : ''}" data-cr-pair-card="${card.index}" aria-label="Karte ${card.index + 1}${visible && value ? `: ${escapeHtml(String(value))}` : ''}" ${playing && !found ? '' : 'disabled'}>${visible ? escapeHtml(String(value ?? '')) : '?'}</button>`;
  }).join('')}</div>`;
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
  const data = trial.data ?? {};
  if (['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform'].includes(challenge.key)) return trialChoice(trial, playing);
  if (challenge.key === 'sequence-echo' || challenge.key === 'reverse-echo' || challenge.key === 'path-memory') return trialSequence(trial, playing);
  if (challenge.key === 'memory-matrix') return trialMatrix(trial, playing);
  if (challenge.key === 'number-blind') return trialNumberBlind(trial, playing);
  if (challenge.key === 'memory-pairs') return trialPairs(trial, playing);
  if (challenge.key === 'n-back' || challenge.key === 'seen-before') {
    const n = Number(data.n) || 1;
    const question = challenge.key === 'n-back' ? `Gleich wie vor ${n} ${n === 1 ? 'Schritt' : 'Schritten'}?` : 'War dieses Symbol schon zu sehen?';
    return `<p class="challenge-rush-logic-prompt">${question}</p><div class="challenge-rush-symbol">${escapeHtml(String(data.symbol ?? ''))}</div><div class="challenge-rush-choice-grid"><button type="button" class="btn challenge-rush-choice" data-cr-bool="true" ${playing ? '' : 'disabled'}>Ja</button><button type="button" class="btn challenge-rush-choice" data-cr-bool="false" ${playing ? '' : 'disabled'}>Nein</button></div>`;
  }
  if (challenge.key === 'missing-item') {
    if (trial.phase === 'preview') return `<div class="challenge-rush-item-list">${(data.originalItems ?? data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="muted">Merken …</p>`;
    return `<div class="challenge-rush-item-list">${(data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="challenge-rush-logic-prompt">Welcher Gegenstand fehlt?</p>${trialOptions(trial, playing)}`;
  }
  if (challenge.key === 'suitcase-memory') {
    if (trial.phase === 'preview') return `<div class="challenge-rush-item-list">${(data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="muted">Merken …</p>`;
    return `<p class="challenge-rush-logic-prompt">Welcher Gegenstand lag an Position ${escapeHtml(String(data.position ?? '?'))}?</p>${trialOptions(trial, playing)}`;
  }
  return '<p class="muted">Trial wird vorbereitet …</p>';
}
export function renderOddOneOut(data, playing = true) {
  const tileCount = data.tileCount ?? 25;
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
  const oddPosition = playing ? Math.max(0, Math.min(tileCount - 1, Number(data.oddIndex))) : -1;
  const subtlety = Math.max(1, Math.min(5, Math.round(Number(data.subtlety)) || 1));
  const shapeLabel = (isOdd) => isOdd ? ['kreisförmig', 'stark abgerundet', 'diagonal abgerundet', 'eckig', 'halb abgerundet'][subtlety - 1] : 'normal abgerundet';
  const tiles = Array.from({ length: tileCount }, (_, index) => `<button type="button" class="challenge-rush-tile" data-cr-tile="${index}" ${playing ? '' : 'disabled'} aria-label="Feld ${index + 1}, Form ${shapeLabel(index === oddPosition)}"></button>`).join('');
  return `<div class="challenge-rush-tile-grid challenge-rush-odd-grid" data-cr-subtlety="${subtlety}" style="grid-template-columns:repeat(${columnCount},minmax(0,1fr));">${tiles}</div>`;
}
function challengeView(container) {
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
  if (challenge?.key === 'cps') body = `<button type="button" class="challenge-rush-big-button" ${playing ? '' : 'disabled'}>KLICKEN</button><p class="muted">Klicks: <strong id="cr-clicks">0</strong></p>`;
  if (challenge?.key === 'number-salad') body = `<div class="challenge-rush-number-grid">${(data.numbers ?? []).map((number) => `<button type="button" class="btn challenge-rush-number" data-cr-number="${number}" ${playing ? '' : 'disabled'}>${number}</button>`).join('')}</div><p class="muted">Nächste Zahl: <strong>${numberOrder}</strong></p>`;
  if (challenge?.key === 'timing-10') body = `<button type="button" class="challenge-rush-big-button" data-cr-stop ${playing ? '' : 'disabled'}>STOPP</button><p class="muted">Keine laufende Zeit sichtbar – vertraue deinem Gefühl.</p>`;
  if (challenge?.key === 'aim-trainer') {
    // The server only ever sends the single current target (data.target),
    // not the full targets array — otherwise a script could read every
    // remaining position at once and blast through every target with only the
    // input floor as a delay. targetCount is a separate, non-secret constant
    // sent alongside it purely for the hit counter.
    const target = playing ? data.target : null;
    body = target
      ? `<button type="button" class="challenge-rush-circle" data-cr-x="${target.x}" data-cr-y="${target.y}" aria-label="Ziel treffen" style="left:${target.x}%;top:${target.y}%"></button>`
      : '<p class="muted">Die Ziele erscheinen, sobald es losgeht.</p>';
    // Positioned as an absolute corner badge, not a normal-flow paragraph:
    // the target button is itself position:absolute (so it can sit anywhere
    // in the field), which pulls it out of the grid's auto-placed rows and
    // leaves a flow paragraph centered in the same cell — directly on top of
    // whichever target happens to render near the field's center.
    body += `<p class="muted challenge-rush-playfield-badge">${Math.min(progressStep, data.targetCount ?? 6)} / ${data.targetCount ?? 6} getroffen</p>`;
  }
  if (challenge?.key === 'memory-sequence') {
    const tileCount = data.tileCount ?? 9;
    // The reveal only toggles `is-active` visually; a screen reader gets no
    // signal that a tile just flashed unless the accessible name says so too.
    const tiles = Array.from({ length: tileCount }, (_, index) => {
      const isActive = memoryRevealIndex === index;
      return `<button type="button" class="challenge-rush-tile ${isActive ? 'is-active' : ''}" data-cr-tile="${index}" ${playing && memoryRevealDone ? '' : 'disabled'} aria-label="Feld ${index + 1}${isActive ? ' (leuchtet gerade)' : ''}"></button>`;
    }).join('');
    body = `<div class="challenge-rush-tile-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">${tiles}</div><p class="muted" aria-live="polite">${!playing ? 'Bereithalten …' : memoryRevealDone ? `Feld ${progressStep + 1} von ${data.sequence?.length ?? 0}` : 'Merke dir die Reihenfolge …'}</p>`;
  }
  if (challenge?.key === 'odd-one-out') {
    // Every field has the same classes, attributes and accessible name. The
    // grid applies the visual shape difference through nth-child, keeping the
    // answer out of both the target element and the accessibility tree.
    body = renderOddOneOut(data, playing);
  }
  if (challenge?.key === 'whack-a-mole') {
    // Same minimization as Aim Trainer: only the current active hole
    // (data.activeHole) is sent, not the whole sequence.
    const holeCount = data.holeCount ?? 9; const active = playing ? data.activeHole : null;
    const totalHits = data.totalHits ?? 8;
    // As with the odd-one-out tile, `is-active` alone conveys nothing to a
    // screen reader — the active hole's accessible name says so directly.
    const tiles = Array.from({ length: holeCount }, (_, index) => {
      const isActive = active === index;
      return `<button type="button" class="challenge-rush-tile ${isActive ? 'is-active' : ''}" data-cr-tile="${index}" ${playing ? '' : 'disabled'} aria-label="Loch ${index + 1}${isActive ? ' (aktiv)' : ''}"></button>`;
    }).join('');
    body = `<div class="challenge-rush-tile-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">${tiles}</div><p class="muted challenge-rush-target-progress">${Math.min(progressStep, totalHits)} / ${totalHits} getroffen</p>`;
  }
  if (challenge?.key === 'traffic-light') {
    body = `<button type="button" class="challenge-rush-traffic-light ${trafficGreen ? 'is-green' : 'is-red'}" data-cr-traffic ${playing ? '' : 'disabled'} aria-label="Klicken sobald Grün">${trafficGreen ? 'GRÜN' : 'ROT'}</button><p class="muted">Zu früh klicken zählt als Fehlstart.</p>`;
  }
  if (challenge?.key === 'color-word') {
    // Same minimization: only the current round (data.round) is sent, not
    // every remaining word/color/option set.
    const round = playing ? data.round : null;
    const roundCount = data.roundCount ?? 6;
    // The correct answer is the rendered font color, not the printed word —
    // a sighted player sees that directly, but a screen reader only reads
    // the text content, never an inline CSS color. The accessible name
    // states the actual color explicitly so both paths carry the same
    // information.
    const word = round ? `<div class="challenge-rush-color-word" style="color:${COLOR_WORD_VARS[round.textColor] ?? 'inherit'}" aria-label="Schriftfarbe: ${COLOR_WORD_LABELS[round.textColor] ?? round.textColor}">${escapeHtml(round.word)}</div>` : '<p class="muted">Bereithalten …</p>';
    const options = round ? `<div class="challenge-rush-color-options">${round.options.map((key) => `<button type="button" class="btn challenge-rush-color-option" data-cr-color="${key}" style="border-color:${COLOR_WORD_VARS[key]};"><span class="challenge-rush-color-dot" style="background:${COLOR_WORD_VARS[key]};"></span>${COLOR_WORD_LABELS[key] ?? key}</button>`).join('')}</div>` : '';
    body = `${word}${options}<p class="muted challenge-rush-target-progress">${Math.min(progressStep, roundCount)} / ${roundCount}</p>`;
  }
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
export function renderChallengeRush(container, ctx) {
  ensureChallengeRushSocket();
  clearOddOneOutPresentation();
  const scores = match?.scores ?? [];
  const body = match?.phase === 'ended'
    ? finalSummaryHtml(scores)
    : match?.phase === 'result'
      ? `${resultView()}${matchControlsHtml()}`
      : `${challengeView(container)}${matchControlsHtml()}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`;
  container.innerHTML = `<div class="arcade-game-shell"><button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><h1 class="view-title">Challenge Rush</h1><div class="arcade-toolbar">${arcadeMuteControlHtml()}</div>${body}</div>`;
  if (match?.phase === 'countdown' && !match?.paused) updateReadingCountdown();
  if (match?.challenge?.key === 'odd-one-out' && match.phase === 'playing' && !match.paused && !iCompleted) {
    applyOddOneOutPresentation(container, match.challenge.data?.oddIndex);
  }
  wireArcadeMuteControl(container);
  container.querySelector('#cr-back')?.addEventListener('click', () => { clearReadingCountdown(); clearTrialTimer(); currentTrial = null; match = null; navigate('arcade'); });
  container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  container.querySelector('[data-cr-pause]')?.addEventListener('click', () => socket.emit('challenge-rush:match:pause', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true }); }));
  container.querySelector('[data-cr-finish]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich für alle beenden?', { confirmText: 'Beenden', danger: true }))) return; const result = await emit('challenge-rush:match:finish', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Beenden fehlgeschlagen.', { error: true }); });
  container.querySelector('[data-cr-leave-match]')?.addEventListener('click', async () => { if (!(await confirmDialog('Challenge Rush wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return; const result = await emit('challenge-rush:match:leave', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) return showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true }); clearTrialTimer(); currentTrial = null; match = null; navigate('arcade'); });
  container.querySelector('#cr-ready-next')?.addEventListener('click', async () => { const result = await emit('challenge-rush:challenge:ready', { matchId: match.matchId, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Bereit-Status fehlgeschlagen.', { error: true }); });
  // The ack's optional `next` field (only set for aim-trainer/whack-a-mole/
  // color-word) carries the freshly revealed current step — merged in here
  // so every send() caller automatically sees it, since individual accepted
  // inputs don't otherwise trigger a full state broadcast.
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
      if (result.next && match?.challenge) match = { ...match, challenge: { ...match.challenge, data: { ...match.challenge.data, ...result.next } } };
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
  container.querySelector('.challenge-rush-circle')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }, (progress) => { if (match?.challenge?.key === 'aim-trainer') { progressStep = progress.correct; rerender(); container.querySelector('.challenge-rush-circle')?.focus(); } }); });
  container.querySelector('.challenge-rush-big-button:not([data-cr-stop])')?.addEventListener('click', () => send('click', undefined, (progress) => { const counter = container.querySelector('#cr-clicks'); if (counter) counter.textContent = String(progress.clicks); }));
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-number]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crNumber); send('number', value, (progress) => { numberOrder = progress.correct + 1; if (progress.correct === value) button.disabled = true; }); }));
  // Refocusing the equivalent element after each rerender (instead of
  // leaving focus on `<body>`, where the full innerHTML replace drops it)
  // keeps these rapid, timed challenges actually playable by keyboard —
  // otherwise a keyboard user would have to tab back in from the top of the
  // page after every single tile.
  container.querySelectorAll('[data-cr-tile]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crTile); const key = match?.challenge?.key;
    if (key === 'memory-sequence') send('tile', value, (progress) => { progressStep = progress.correct; rerender(); container.querySelector(`[data-cr-tile="${value}"]`)?.focus(); });
    else if (key === 'odd-one-out') send('select', value, () => { rerender(); container.querySelector(`[data-cr-tile="${value}"]`)?.focus(); });
    else if (key === 'whack-a-mole') send('hit', value, (progress) => { progressStep = progress.correct; rerender(); container.querySelector('.challenge-rush-tile.is-active')?.focus(); });
  }));
  container.querySelector('[data-cr-traffic]')?.addEventListener('click', () => send('click', undefined, () => rerender()));
  container.querySelectorAll('[data-cr-color]').forEach((button) => button.addEventListener('click', () => send('answer', button.dataset.crColor, (progress) => { progressStep = progress.correct + progress.errors; rerender(); container.querySelector('.challenge-rush-color-option')?.focus(); })));
  container.querySelectorAll('[data-cr-choice]').forEach((button) => button.addEventListener('click', () => send('choice', button.dataset.crChoice, () => { rerender(); container.querySelector('[data-cr-choice]')?.focus(); })));
  container.querySelectorAll('[data-cr-bool]').forEach((button) => button.addEventListener('click', () => send('choice', button.dataset.crBool === 'true', () => { rerender(); container.querySelector('[data-cr-bool]')?.focus(); })));
  container.querySelectorAll('[data-cr-sequence-cell]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crSequenceCell);
    if (interaction.sequence.includes(value)) return;
    interaction.sequence.push(value);
    const expectedLength = Number(currentTrial?.data?.sequenceLength ?? currentTrial?.data?.pathLength ?? 0);
    if (interaction.sequence.length >= expectedLength) send('sequence', [...interaction.sequence]);
    rerender();
    container.querySelector(`[data-cr-sequence-cell="${value}"]`)?.focus();
  }));
  container.querySelectorAll('[data-cr-matrix-cell]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crMatrixCell);
    if (interaction.cells.includes(value)) return;
    interaction.cells.push(value);
    if (interaction.cells.length >= Number(currentTrial?.data?.highlightCount ?? 0)) send('cells', [...interaction.cells]);
    rerender();
    container.querySelector(`[data-cr-matrix-cell="${value}"]`)?.focus();
  }));
  container.querySelectorAll('[data-cr-number-position]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crNumberPosition);
    if (interaction.sequence.includes(value)) return;
    interaction.sequence.push(value);
    if (interaction.sequence.length >= Number(currentTrial?.data?.numberCount ?? 0)) send('sequence', [...interaction.sequence]);
    rerender();
    container.querySelector(`[data-cr-number-position="${value}"]`)?.focus();
  }));
  container.querySelectorAll('[data-cr-pair-card]').forEach((button) => button.addEventListener('click', () => {
    const value = Number(button.dataset.crPairCard);
    if (interaction.found.has(value) || interaction.pair.includes(value)) return;
    const trialId = currentTrial?.trialId;
    send('reveal', value, (result) => {
      if (result.trial?.trialId !== trialId) return;
      const revealed = Array.isArray(result.revealedCards) ? result.revealedCards : [];
      revealed.forEach((card) => interaction.values.set(card.index, card.value));
      interaction.pair = revealed.map((card) => card.index);
      interaction.revealSeq = acknowledgedRevealSeq(interaction.revealSeq, result.revealSeq);
      const revealSeq = interaction.revealSeq;
      if (result.correct === true) {
        interaction.pair.forEach((entry) => interaction.found.add(entry));
        interaction.pair = [];
        rerender();
        container.querySelector('[data-cr-pair-card]:not([disabled])')?.focus();
        return;
      }
      if (result.correct === false) {
        rerender();
        container.querySelector(`[data-cr-pair-card="${value}"]`)?.focus();
        window.setTimeout(() => {
          if (currentTrial?.trialId !== trialId || !pairHideStillApplies(interaction, trialId, revealSeq)) return;
          for (const card of revealed) if (!interaction.found.has(card.index)) interaction.values.delete(card.index);
          interaction.pair = [];
          rerender();
          container.querySelector('[data-cr-pair-card]:not([disabled])')?.focus();
        }, 650);
        return;
      }
      rerender();
    });
  }));
}
