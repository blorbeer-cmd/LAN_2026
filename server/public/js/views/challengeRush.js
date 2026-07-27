import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { infoTooltipHtml } from '../infoTooltip.js';

let socket = null; let lobbies = []; let match = null; let latestResult = null; let rerender = null; let numberOrder = 1;
const myId = () => getMyId();
function navigate(view) { window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view })); }
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }
function refresh() { rerender?.(); }
export function ensureChallengeRushSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('challenge-rush:lobbies', (payload) => { lobbies = payload?.lobbies ?? []; refresh(); });
  socket.on('challenge-rush:match:start', (payload) => { match = { ...payload }; latestResult = null; navigate('challengeRush'); });
  socket.on('challenge-rush:match:state', (payload) => { match = { ...match, ...payload }; refresh(); });
  socket.on('challenge-rush:state', (payload) => { match = { ...match, ...payload }; if (payload.phase === 'countdown' && payload.challenge?.key === 'number-salad') numberOrder = 1; refresh(); });
  socket.on('challenge-rush:challenge:end', (payload) => { latestResult = payload; refresh(); });
  socket.on('challenge-rush:match:end', (payload) => { latestResult = payload; match = { ...match, phase: 'ended', scores: payload.scores, draw: payload.draw === true }; refresh(); });
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
function challengeView(container) {
  const challenge = match?.challenge; const playing = match?.phase === 'playing' && !match?.paused; const data = challenge?.data ?? {};
  let body = '<p class="muted">Die nächste Challenge startet gleich …</p>';
  if (challenge?.key === 'reaction-circle') body = `<button type="button" class="challenge-rush-circle" data-cr-x="${data.x}" data-cr-y="${data.y}" style="left:${data.x}%;top:${data.y}%" aria-label="Kreis treffen" ${playing ? '' : 'disabled'}></button>`;
  if (challenge?.key === 'cps') body = `<button type="button" class="challenge-rush-big-button" ${playing ? '' : 'disabled'}>KLICKEN</button><p class="muted">Klicks: <strong id="cr-clicks">0</strong></p>`;
  if (challenge?.key === 'number-salad') body = `<div class="challenge-rush-number-grid">${(data.numbers ?? []).map((number) => `<button type="button" class="btn challenge-rush-number" data-cr-number="${number}" ${playing ? '' : 'disabled'}>${number}</button>`).join('')}</div><p class="muted">Nächste Zahl: <strong>${numberOrder}</strong></p>`;
  if (challenge?.key === 'timing-10') body = `<button type="button" class="challenge-rush-big-button" data-cr-stop ${playing ? '' : 'disabled'}>STOPP</button><p class="muted">Keine laufende Zeit sichtbar – vertraue deinem Gefühl.</p>`;
  const hostControls = match?.host?.id === myId() && match?.phase !== 'ended' ? `<button type="button" class="btn btn-sm" data-cr-pause>${match.paused ? 'Fortsetzen' : 'Pausieren'}</button>` : '';
  return `<section class="card stack challenge-rush-stage" data-match-id="${escapeHtml(match?.matchId ?? '')}" data-challenge-index="${match?.challengeIndex ?? -1}" data-phase="${escapeHtml(match?.phase ?? '')}" data-remaining-ms="${match?.remainingMs ?? ''}" data-reconnected="${match?.reconnected === true}" data-disconnected="${match?.disconnected === true}" aria-live="polite"><div class="row-between"><span class="badge badge-playing">Challenge ${(match?.challengeIndex ?? 0) + 1} / ${match?.challengeCount ?? 4}</span><span>${match?.paused ? 'Pause' : match?.phase === 'countdown' ? 'Startet gleich' : match?.phase === 'result' ? 'Auswertung' : 'Läuft'}</span></div><h2>${escapeHtml(challenge?.title ?? 'Mini-Challenge')}</h2><p class="muted">${escapeHtml(challenge?.description ?? '')}</p><div class="challenge-rush-playfield">${body}</div>${hostControls}${match?.phase === 'result' ? `<div class="challenge-rush-result">Runde abgeschlossen</div>` : ''}</section>`;
}
export function renderChallengeRush(container, ctx) { ensureChallengeRushSocket(); rerender = () => renderChallengeRush(container, ctx); const scores = match?.scores ?? []; container.innerHTML = `<div class="arcade-game-shell"><button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><h1 class="view-title">Challenge Rush</h1>${match?.phase === 'ended' ? `<section class="card stack"><h2>${match.draw ? 'Unentschieden' : 'Gesamtergebnis'}</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div><button type="button" class="btn btn-primary" id="cr-back">Zur Arcade</button></section>` : `${challengeView(container)}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`}</div>`; container.querySelector('#cr-back')?.addEventListener('click', () => { match = null; latestResult = null; navigate('arcade'); }); container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  container.querySelector('[data-cr-pause]')?.addEventListener('click', () => socket.emit('challenge-rush:match:pause', { matchId: match.matchId, playerId: myId() }, (result) => { if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true }); }));
  const send = (action, value, onAccepted = () => {}) => socket.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), challengeIndex: match.challengeIndex, action, value }, (result) => { if (!result?.ok && !result?.ignored) return showToast(result?.error || 'Eingabe abgelehnt.', { error: true }); if (result?.ok && !result?.ignored && !result?.duplicate) onAccepted(result.progress); });
  container.querySelector('.challenge-rush-circle')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }); });
  container.querySelector('.challenge-rush-big-button:not([data-cr-stop])')?.addEventListener('click', () => send('click', undefined, (progress) => { const counter = container.querySelector('#cr-clicks'); if (counter) counter.textContent = String(progress.clicks); }));
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-number]').forEach((button) => button.addEventListener('click', () => { const value = Number(button.dataset.crNumber); send('number', value, (progress) => { numberOrder = progress.correct + 1; if (progress.correct === value) button.disabled = true; }); }));
}
