import { escapeHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';

let socket = null; let lobbies = []; let match = null; let latestResult = null; let rerender = null; let currentTrial = null; let numberOrder = 1; let cpsClicks = 0;
let interaction = { trialId: null, sequence: [], cells: [], pair: [], found: new Set(), values: new Map(), whackHits: 0 };
const COLOR_WORD_LABELS = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };
const COLOR_WORD_VARS = { red: 'var(--danger)', blue: 'var(--accent)', green: 'var(--state-playing)', yellow: 'var(--state-paused)' };
const myId = () => getMyId();
function navigate(view) { window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view })); }
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }
function refresh() { rerender?.(); }
function resetInteraction(trialId, resume = {}) {
  const sequence = [];
  const found = new Set(Array.isArray(resume.found) ? resume.found : []);
  const pair = Array.isArray(resume.revealed) ? [...resume.revealed] : [];
  const values = new Map([...(Array.isArray(resume.foundCards) ? resume.foundCards : []), ...(Array.isArray(resume.revealedCards) ? resume.revealedCards : [])].map((card) => [card.index, card.value]));
  interaction = { trialId, sequence, cells: [], pair, found, values, whackHits: Number(resume.correct) || 0 };
}
function phaseTimer() {
  if (!currentTrial || match?.paused) return;
  const trialId = currentTrial.trialId;
  if (currentTrial.phase === 'preview') {
    const delay = Number(currentTrial.phaseRemainingMs ?? currentTrial.phaseMs ?? 0);
    window.setTimeout(() => {
      if (currentTrial?.trialId !== trialId || currentTrial?.phase !== 'preview' || match?.paused) return;
      socket?.emit('challenge-rush:trial:get', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex });
    }, Math.max(0, delay) + 20);
    return;
  }
  if (typeof currentTrial.inputRemainingMs !== 'number') return;
  window.setTimeout(() => {
    if (currentTrial?.trialId !== trialId || currentTrial?.phase !== 'input' || match?.paused) return;
    socket?.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, trialId, action: 'timeout' });
  }, Math.max(0, currentTrial.inputRemainingMs) + 20);
}

export function ensureChallengeRushSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('challenge-rush:lobbies', (payload) => { lobbies = payload?.lobbies ?? []; refresh(); });
  socket.on('challenge-rush:match:start', (payload) => { match = { ...payload }; currentTrial = null; latestResult = null; numberOrder = 1; cpsClicks = 0; navigate('challengeRush'); });
  socket.on('challenge-rush:match:state', (payload) => { const previousIndex = match?.challengeIndex; match = { ...match, ...payload }; if (payload.challengeIndex !== previousIndex) { numberOrder = 1; cpsClicks = 0; } refresh(); });
  socket.on('challenge-rush:state', (payload) => { const previousIndex = match?.challengeIndex; match = { ...match, ...payload }; if (payload.challengeIndex !== previousIndex) { numberOrder = 1; cpsClicks = 0; } if (payload.phase !== 'playing') currentTrial = null; if (currentTrial && payload.paused === false) phaseTimer(); refresh(); });
  socket.on('challenge-rush:trial', (payload) => { if (!match || payload?.matchId !== match.matchId || payload.challengeIndex !== match.challengeIndex) return; currentTrial = payload.trial; numberOrder = Number(currentTrial?.resume?.nextNumber ?? 1); resetInteraction(currentTrial?.trialId, currentTrial?.resume); phaseTimer(); refresh(); });
  socket.on('challenge-rush:challenge:end', (payload) => { latestResult = payload; currentTrial = null; refresh(); });
  socket.on('challenge-rush:match:end', (payload) => { latestResult = payload; currentTrial = null; match = { ...match, phase: 'ended', scores: payload.scores, draw: payload.draw === true }; refresh(); });
  socket.on('disconnect', () => { if (match) match = { ...match, disconnected: true }; refresh(); });
  socket.on('connect', () => { if (match?.matchId) socket.emit('challenge-rush:match:reconnect', { matchId: match.matchId, playerId: myId(), reconnectToken: match.reconnectToken }, (result) => { if (result?.ok) { match = { ...match, reconnected: true, disconnected: false }; refresh(); } }); });
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
  const cards = lobbies.map((lobby) => arcadeLobbyEntryHtml(lobby, { full: lobby.players.length >= 15, joinAction: lobby.players.some((p) => p.id === myId()) ? '' : `<button type="button" class="btn btn-sm btn-primary" data-cr-join="${lobby.id}" ${lobby.players.length >= 15 ? 'disabled' : ''}>Beitreten</button>`, footerActions: lobby.host.id === myId() ? `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Schließen</button><button type="button" class="btn btn-sm btn-primary" data-cr-start="${lobby.id}" ${lobby.players.every((p) => p.ready || p.id === lobby.host.id) ? '' : 'disabled'}>Start</button>` : `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Verlassen</button>${readyToggleHtml(lobby, myId(), 'cr-ready')}` })).join('');
  return `<div class="card stack arcade-lobby-card">${cards || '<div class="empty-state">Noch keine Lobby offen.</div>'}<div class="arcade-lobby-create-actions"><button type="button" class="btn btn-primary btn-sm" id="cr-create" ${current ? 'disabled' : ''}>Lobby öffnen</button></div></div>`;
}
export function wireChallengeRushLobbyCard(container, { beforeCreate = async () => true, beforeJoin = async () => true } = {}) {
  container.querySelector('#cr-create')?.addEventListener('click', async () => { if (!(await beforeCreate())) return; const result = await emit('challenge-rush:lobby:create', { playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true }); });
  container.querySelectorAll('[data-cr-join]').forEach((button) => button.addEventListener('click', async () => { if (!(await beforeJoin())) return; const result = await emit('challenge-rush:lobby:join', { lobbyId: button.dataset.crJoin, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true }); }));
  container.querySelectorAll('[data-cr-leave]').forEach((button) => button.addEventListener('click', () => emit('challenge-rush:lobby:leave', { lobbyId: button.dataset.crLeave, playerId: myId() })));
  wireReadyToggle(container, 'cr-ready', async (lobbyId, ready) => { const result = await emit('challenge-rush:lobby:ready', { lobbyId, playerId: myId(), ready }); if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true }); });
  container.querySelectorAll('[data-cr-start]').forEach((button) => button.addEventListener('click', async () => { const result = await emit('challenge-rush:lobby:start', { lobbyId: button.dataset.crStart, playerId: myId() }); if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true }); }));
}

function gridHtml(size, cells, className, disabled, attribute = 'cell', showOrder = false) {
  const selected = new Set(cells);
  const order = new Map(cells.map((cell, index) => [cell, index + 1]));
  return `<div class="challenge-rush-memory-grid ${className}" style="--cr-grid-columns:${size}">${Array.from({ length: size * size }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell${selected.has(index) ? ' is-selected' : ''}" data-cr-${attribute}="${index}" aria-label="${showOrder && order.has(index) ? `Schritt ${order.get(index)}` : `Feld ${index + 1}`}" ${disabled ? 'disabled' : ''}>${showOrder && order.has(index) ? order.get(index) : selected.has(index) ? '●' : ''}</button>`).join('')}</div>`;
}
function sequenceBody(trial, playing) {
  const data = trial.data; const sequence = Array.isArray(data.sequence) ? data.sequence : Array.isArray(data.path) ? data.path : [];
  if (trial.phase === 'preview') return `${gridHtml(Number(data.size) || 3, sequence, 'is-preview', true, 'cell', true)}<p class="muted">Merken …</p>`;
  const selected = interaction.sequence; const expectedLength = Number(data.sequenceLength ?? data.pathLength ?? sequence.length);
  return `${gridHtml(Number(data.size) || 3, selected, 'is-input', !playing, 'sequence-cell', true)}<p class="muted">${selected.length} / ${expectedLength} Felder</p>`;
}
function matrixBody(trial, playing) {
  const data = trial.data; const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  if (trial.phase === 'preview') return `${gridHtml(Number(data.size) || 3, highlights, 'is-preview', true)}<p class="muted">Positionen merken …</p>`;
  const expectedCount = Number(data.highlightCount ?? highlights.length);
  return `${gridHtml(Number(data.size) || 3, interaction.cells, 'is-input', !playing)}<p class="muted">${interaction.cells.length} / ${expectedCount} Felder</p>`;
}
function numberBlindBody(trial, playing) {
  const data = trial.data; const numbers = Array.isArray(data.numbers) ? data.numbers : []; const size = Number(data.size) || 3;
  if (trial.phase === 'preview') { const byPosition = new Map(numbers.map((entry) => [entry.position, entry.number])); return `<div class="challenge-rush-memory-grid is-preview" style="--cr-grid-columns:${size}">${Array.from({ length: size * size }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell is-selected" aria-label="Zahl ${byPosition.get(index) ?? 'leer'}" disabled>${byPosition.get(index) ?? ''}</button>`).join('')}</div><p class="muted">Positionen merken …</p>`; }
  const expectedCount = Number(data.numberCount ?? numbers.length);
  return `<div class="challenge-rush-memory-grid is-input" style="--cr-grid-columns:${size}">${Array.from({ length: size * size }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell${interaction.sequence.includes(index) ? ' is-selected' : ''}" data-cr-number-position="${index}" aria-label="Position ${index + 1}" ${playing && !interaction.sequence.includes(index) ? '' : 'disabled'}>${interaction.sequence.includes(index) ? interaction.sequence.indexOf(index) + 1 : '?'}</button>`).join('')}</div><p class="muted">${interaction.sequence.length} / ${expectedCount} Zahlen</p>`;
}
function pathBody(trial, playing) { return sequenceBody({ ...trial, data: { ...trial.data, sequence: trial.data.path } }, playing); }
function pairsBody(trial, playing) {
  const cards = Array.isArray(trial.data.cards) ? trial.data.cards : [];
  const resumeFound = new Set(Array.isArray(trial.resume?.found) ? trial.resume.found : []);
  const resumePair = new Set(Array.isArray(trial.resume?.revealed) ? trial.resume.revealed : []);
  const resumeValues = new Map([...(Array.isArray(trial.resume?.foundCards) ? trial.resume.foundCards : []), ...(Array.isArray(trial.resume?.revealedCards) ? trial.resume.revealedCards : [])].map((card) => [card.index, card.value]));
  return `<div class="challenge-rush-pairs-grid" style="--cr-grid-columns:${Number(trial.data.boardSize) || 2}">${cards.map((card) => { const found = interaction.found.has(card.index) || resumeFound.has(card.index); const visible = found || interaction.pair.includes(card.index) || resumePair.has(card.index); const value = interaction.values.get(card.index) ?? resumeValues.get(card.index); return `<button type="button" class="btn challenge-rush-memory-card${visible ? ' is-selected' : ''}" data-cr-pair-card="${card.index}" aria-label="Karte ${card.index + 1}${visible && value ? `: ${escapeHtml(String(value))}` : ''}" ${playing && !found ? '' : 'disabled'}>${visible ? escapeHtml(String(value ?? '')) : '?'}</button>`; }).join('')}</div>`;
}
function aimBody(trial, playing) {
  const target = trial.data.target;
  if (!target || !playing) return '<p class="muted">Das nächste Ziel erscheint gleich …</p>';
  return `<button type="button" class="challenge-rush-circle" data-cr-aim-x="${target.x}" data-cr-aim-y="${target.y}" style="left:${target.x}%;top:${target.y}%" aria-label="Ziel treffen"></button>`;
}
function oddOneOutBody(trial, playing) {
  const tileCount = Number(trial.data.tileCount) || 9; const size = Number(trial.data.size) || Math.sqrt(tileCount);
  return `<div class="challenge-rush-memory-grid" style="--cr-grid-columns:${size}">${Array.from({ length: tileCount }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell${index === Number(trial.data.oddIndex) ? ' is-odd' : ''}" data-cr-odd="${index}" aria-label="Feld ${index + 1}" ${playing ? '' : 'disabled'}></button>`).join('')}</div><p class="muted">Finde das abweichende Feld.</p>`;
}
function whackBody(trial, playing) {
  const sequence = Array.isArray(trial.data.sequence) ? trial.data.sequence : []; const size = Number(trial.data.size) || 3; const expectedLength = Number(trial.data.sequenceLength ?? sequence.length);
  if (trial.phase === 'preview') return `${gridHtml(size, sequence, 'is-preview', true, 'cell', true)}<p class="muted">Merke dir die Reihenfolge …</p>`;
  return `<div class="challenge-rush-memory-grid" style="--cr-grid-columns:${size}">${Array.from({ length: size * size }, (_, index) => `<button type="button" class="btn challenge-rush-memory-cell" data-cr-whack="${index}" aria-label="Feld ${index + 1}" ${playing ? '' : 'disabled'}></button>`).join('')}</div><p class="muted">${Math.min(interaction.whackHits, expectedLength)} / ${expectedLength} Treffer</p>`;
}
function trafficLightBody(trial, playing) {
  const green = trial.phase === 'input';
  return `<button type="button" class="challenge-rush-traffic-light ${green ? 'is-green' : 'is-red'}" data-cr-traffic ${playing && green ? '' : 'disabled'} aria-label="Klicken sobald Grün">${green ? 'GRÜN' : 'ROT'}</button><p class="muted">Zu früh klicken zählt als Fehlstart.</p>`;
}
function colorWordBody(trial, playing) {
  const data = trial.data; const options = Array.isArray(data.options) ? data.options : [];
  const color = COLOR_WORD_VARS[String(data.textColor)] ?? 'inherit';
  return `<div class="challenge-rush-color-word" style="color:${color}">${escapeHtml(String(data.word ?? ''))}</div><div class="challenge-rush-choice-grid">${options.map((option) => `<button type="button" class="btn challenge-rush-choice" data-cr-color="${escapeHtml(String(option))}" ${playing ? '' : 'disabled'}><span class="challenge-rush-color-dot" style="background:${COLOR_WORD_VARS[String(option)] ?? 'var(--text-muted)'}"></span>${escapeHtml(COLOR_WORD_LABELS[String(option)] ?? String(option))}</button>`).join('')}</div>`;
}
function logicChoiceBody(trial, playing) {
  const data = trial.data ?? {};
  const matrix = Array.isArray(data.matrix) ? `<div class="challenge-rush-logic-matrix" role="grid" aria-label="Zwei mal zwei Zahlenmatrix">${data.matrix.flat().map((value, index) => `<span role="gridcell" aria-label="${index === 3 ? 'Gesuchte Zahl' : `Zahl ${escapeHtml(String(value))}`}">${value === null ? '?' : escapeHtml(String(value))}</span>`).join('')}</div>` : '';
  const prompt = matrix || `<p class="challenge-rush-logic-prompt">${escapeHtml(String(data.prompt ?? ''))}</p>`;
  if (trial.phase === 'preview') return `${prompt}<div class="challenge-rush-item-list">${(data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="muted">Merken …</p>`;
  return `${prompt}${optionsBody(trial, playing)}`;
}
function optionsBody(trial, playing) { const options = Array.isArray(trial.data.options) ? trial.data.options : []; return `<div class="challenge-rush-choice-grid">${options.map((option) => `<button type="button" class="btn challenge-rush-choice" data-cr-choice="${escapeHtml(String(option))}" ${playing && trial.phase === 'input' ? '' : 'disabled'}>${escapeHtml(String(option))}</button>`).join('')}</div>`; }
function challengeBody(challenge, trial, playing) {
  if (!trial) return '<p class="muted">Die nächste Challenge startet gleich …</p>';
  const data = trial.data ?? {};
  if (challenge.key === 'reaction-circle') { const target = data.type === 'circle' ? data : challenge.data; return `<button type="button" class="challenge-rush-circle" data-cr-x="${target.x}" data-cr-y="${target.y}" style="left:${target.x}%;top:${target.y}%" aria-label="Kreis treffen" ${playing ? '' : 'disabled'}></button>`; }
  if (challenge.key === 'cps') return `<button type="button" class="challenge-rush-big-button" ${playing ? '' : 'disabled'}>KLICKEN</button><p class="muted">Klicks: <strong id="cr-clicks">${cpsClicks}</strong></p>`;
  if (challenge.key === 'number-salad') return `<div class="challenge-rush-number-grid">${(data.numbers ?? []).map((number) => `<button type="button" class="btn challenge-rush-number" data-cr-number="${number}" ${playing ? '' : 'disabled'}>${number}</button>`).join('')}</div><p class="muted">Nächste Zahl: <strong>${numberOrder}</strong></p>`;
  if (challenge.key === 'timing-10') return `<button type="button" class="challenge-rush-big-button" data-cr-stop ${playing ? '' : 'disabled'}>STOPP</button><p class="muted">Mehrere Versuche in derselben 30‑Sekunden-Runde.</p>`;
  if (challenge.key === 'aim-trainer') return aimBody(trial, playing);
  if (challenge.key === 'memory-sequence') return sequenceBody(trial, playing);
  if (challenge.key === 'odd-one-out') return oddOneOutBody(trial, playing);
  if (challenge.key === 'whack-a-mole') return whackBody(trial, playing);
  if (challenge.key === 'traffic-light') return trafficLightBody(trial, playing);
  if (challenge.key === 'color-word') return colorWordBody(trial, playing);
  if (['number-sequence', 'logic-equation', 'pattern-complete', 'category-sort', 'direction-match', 'mental-rotation', 'word-scramble', 'count-shapes', 'logic-order', 'delayed-recall', 'prime-check', 'balance-scale', 'clock-angle', 'binary-pattern', 'rule-switch', 'matrix-missing', 'coin-change', 'letter-order', 'digit-sum', 'sequence-transform'].includes(challenge.key)) return logicChoiceBody(trial, playing);
  if (challenge.key === 'sequence-echo' || challenge.key === 'reverse-echo') return sequenceBody(trial, playing);
  if (challenge.key === 'memory-matrix') return matrixBody(trial, playing);
  if (challenge.key === 'number-blind') return numberBlindBody(trial, playing);
  if (challenge.key === 'path-memory') return pathBody(trial, playing);
  if (challenge.key === 'memory-pairs') return pairsBody(trial, playing);
  if (challenge.key === 'n-back' || challenge.key === 'seen-before') {
    const n = Number(data.n) || 1;
    const question = challenge.key === 'n-back' ? `Gleich wie vor ${n} ${n === 1 ? 'Schritt' : 'Schritten'}?` : 'War dieses Symbol schon zu sehen?';
    return `<p class="challenge-rush-logic-prompt">${question}</p><div class="challenge-rush-symbol">${escapeHtml(String(data.symbol ?? ''))}</div><div class="challenge-rush-choice-grid"><button type="button" class="btn challenge-rush-choice" data-cr-bool="true" ${playing ? '' : 'disabled'}>Ja</button><button type="button" class="btn challenge-rush-choice" data-cr-bool="false" ${playing ? '' : 'disabled'}>Nein</button></div>`;
  }
  if (challenge.key === 'missing-item') {
    if (trial.phase === 'preview') return `<div class="challenge-rush-item-list">${(data.originalItems ?? data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="muted">Merken …</p>`;
    return `<div class="challenge-rush-item-list">${(data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="challenge-rush-logic-prompt">Welcher Gegenstand fehlt?</p>${optionsBody(trial, playing)}`;
  }
  if (challenge.key === 'suitcase-memory') {
    if (trial.phase === 'preview') return `<div class="challenge-rush-item-list">${(data.items ?? []).map((item) => `<span class="chip">${escapeHtml(String(item))}</span>`).join('')}</div><p class="muted">Merken …</p>`;
    return `<p class="challenge-rush-logic-prompt">Welcher Gegenstand lag an Position ${escapeHtml(String(data.position ?? '?'))}?</p>${optionsBody(trial, playing)}`;
  }
  return '<p class="muted">Bereit …</p>';
}
export function renderChallengeRushTrial(challenge, trial, playing = true) { return challengeBody(challenge, trial, playing); }
function challengeView(container) {
  const challenge = match?.challenge; const playing = match?.phase === 'playing' && !match?.paused;
  const hostControls = match?.host?.id === myId() && match?.phase !== 'ended' ? `<div class="row"><button type="button" class="btn btn-sm" data-cr-pause>${match.paused ? 'Fortsetzen' : 'Pausieren'}</button><button type="button" class="btn btn-danger btn-sm" data-cr-end>Match beenden</button></div>` : '';
  const body = challengeBody(challenge, currentTrial, playing);
  const timingHint = currentTrial?.phase === 'input' && typeof currentTrial.inputMs === 'number' ? `<p class="muted">Antwortfenster: ${(currentTrial.inputMs / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Sekunden</p>` : '';
  return `<section class="card stack challenge-rush-stage" data-match-id="${escapeHtml(match?.matchId ?? '')}" data-challenge-index="${match?.challengeIndex ?? -1}" data-phase="${escapeHtml(match?.phase ?? '')}" data-remaining-ms="${match?.remainingMs ?? ''}" data-reconnected="${match?.reconnected === true}" data-disconnected="${match?.disconnected === true}"><div class="row-between"><span class="badge badge-playing">Challenge ${(match?.challengeIndex ?? 0) + 1} / ${match?.challengeCount ?? 10}</span><span aria-live="polite" aria-atomic="true">Stufe ${currentTrial?.difficulty ?? 1} · ${match?.paused ? 'Pause' : match?.phase === 'countdown' ? 'Startet gleich' : match?.phase === 'result' ? 'Auswertung' : 'Läuft'}</span></div><h2>${escapeHtml(challenge?.title ?? 'Mini-Challenge')}</h2><p class="muted">${escapeHtml(challenge?.description ?? '')}</p>${timingHint}<div class="challenge-rush-playfield" aria-live="off">${body}</div>${hostControls}${match?.phase === 'result' ? '<div class="challenge-rush-result">Runde abgeschlossen</div>' : ''}</section>`;
}
export function renderChallengeRush(container, ctx) { ensureChallengeRushSocket(); rerender = () => renderChallengeRush(container, ctx); const scores = match?.scores ?? []; container.innerHTML = `<div class="arcade-game-shell"><button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><h1 class="view-title">Challenge Rush</h1>${match?.phase === 'ended' ? `<section class="card stack"><h2>${match.draw ? 'Unentschieden' : 'Gesamtergebnis'}</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div><button type="button" class="btn btn-primary" id="cr-back">Zur Arcade</button></section>` : `${challengeView(container)}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`}</div>`; container.querySelector('#cr-back')?.addEventListener('click', () => { match = null; latestResult = null; currentTrial = null; navigate('arcade'); }); container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  container.querySelector('[data-cr-pause]')?.addEventListener('click', () => socket.emit('challenge-rush:match:pause', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true }); }));
  container.querySelector('[data-cr-end]')?.addEventListener('click', () => { if (!window.confirm('Challenge-Rush-Match für alle beenden?')) return; socket.emit('challenge-rush:match:end', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Match konnte nicht beendet werden.', { error: true }); }); });
  const send = (action, value, onAccepted = () => {}) => { const sentTrialId = currentTrial?.trialId; socket.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, trialId: sentTrialId, action, value }, (result) => { if (!result?.ok && !result?.ignored) return showToast(result?.error || 'Eingabe abgelehnt.', { error: true }); if (result?.ok && !result?.ignored && !result?.duplicate && currentTrial?.trialId === sentTrialId) onAccepted(result); }); };
  container.querySelector('[data-cr-x]')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }); });
  container.querySelector('[data-cr-aim-x]')?.addEventListener('click', (event) => { const target = event.currentTarget; send('hit', { x: Number(target.dataset.crAimX), y: Number(target.dataset.crAimY) }); });
  container.querySelector('.challenge-rush-big-button:not([data-cr-stop])')?.addEventListener('click', () => send('click', undefined, (result) => { cpsClicks = Number(result.progress?.clicks ?? cpsClicks + 1); const counter = container.querySelector('#cr-clicks'); if (counter) counter.textContent = String(cpsClicks); }));
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-number]').forEach((button) => button.addEventListener('click', () => { const trialId = currentTrial?.trialId; send('number', Number(button.dataset.crNumber), (result) => { if (result.accepted) numberOrder = result.trial?.trialId === trialId ? numberOrder + 1 : 1; refresh(); }); }));
  container.querySelectorAll('[data-cr-sequence-cell]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crSequenceCell); if (interaction.sequence.includes(value)) return; interaction.sequence.push(value); const expectedLength = Number(currentTrial?.data?.sequenceLength ?? currentTrial?.data?.pathLength ?? currentTrial?.data?.sequence?.length ?? currentTrial?.data?.path?.length ?? 0); if (interaction.sequence.length >= expectedLength) send('sequence', interaction.sequence); refresh(); }));
  container.querySelectorAll('[data-cr-cell]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crCell); if (interaction.cells.includes(value)) return; interaction.cells.push(value); const expectedCount = Number(currentTrial?.data?.highlightCount ?? currentTrial?.data?.highlights?.length ?? 0); if (interaction.cells.length >= expectedCount) send('cells', interaction.cells); refresh(); }));
  container.querySelectorAll('[data-cr-number-position]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crNumberPosition); if (interaction.sequence.includes(value)) return; interaction.sequence.push(value); const expectedCount = Number(currentTrial?.data?.numberCount ?? currentTrial?.data?.numbers?.length ?? 0); if (interaction.sequence.length >= expectedCount) send('sequence', interaction.sequence); refresh(); }));
  container.querySelectorAll('[data-cr-odd]').forEach((button) => button.addEventListener('click', () => send('select', Number(button.dataset.crOdd))));
  container.querySelectorAll('[data-cr-whack]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crWhack); const trialId = currentTrial?.trialId; send('hit', value, (result) => { if (result.accepted && result.correct && result.trial?.trialId === trialId) interaction.whackHits += 1; refresh(); }); }));
  container.querySelector('[data-cr-traffic]')?.addEventListener('click', () => send('click'));
  container.querySelectorAll('[data-cr-color]').forEach((button) => button.addEventListener('click', () => send('answer', button.dataset.crColor)));
  container.querySelectorAll('[data-cr-choice]').forEach((button) => button.addEventListener('click', () => send('choice', button.dataset.crChoice)));
  container.querySelectorAll('[data-cr-bool]').forEach((button) => button.addEventListener('click', () => send('choice', button.dataset.crBool === 'true')));
  container.querySelectorAll('[data-cr-pair-card]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crPairCard); if (interaction.found.has(value) || interaction.pair.includes(value)) return; const trialId = currentTrial?.trialId; send('reveal', value, (result) => { if (result.trial?.trialId !== trialId) return; const revealed = Array.isArray(result.revealedCards) ? result.revealedCards : []; revealed.forEach((card) => interaction.values.set(card.index, card.value)); interaction.pair = revealed.map((card) => card.index); if (result.correct === true) { interaction.pair.forEach((entry) => interaction.found.add(entry)); interaction.pair = []; refresh(); return; } if (result.correct === false) { refresh(); window.setTimeout(() => { if (currentTrial?.trialId !== trialId) return; for (const card of revealed) if (!interaction.found.has(card.index)) interaction.values.delete(card.index); interaction.pair = []; refresh(); }, 650); return; } refresh(); }); }));
}
