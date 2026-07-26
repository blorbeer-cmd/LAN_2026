import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { getMyId } from '../whoami.js';
import { showToast } from '../toast.js';
import { arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';

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
  socket.on('challenge-rush:state', (payload) => { match = { ...match, ...payload }; if (payload.phase === 'countdown' && payload.challenge?.key === 'number-salad') numberOrder = 1; refresh(); });
  socket.on('challenge-rush:challenge:end', (payload) => { latestResult = payload; refresh(); });
  socket.on('challenge-rush:match:end', (payload) => { latestResult = payload; match = { ...match, phase: 'ended', scores: payload.scores }; refresh(); });
  socket.on('disconnect', () => refresh());
  socket.emit('challenge-rush:lobbies:get');
  return socket;
}
export function challengeRushLobbies() { return lobbies; }
export function myChallengeRushLobby() { return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())); }
export function hasChallengeRushMatch() { return Boolean(match && match.phase !== 'ended'); }
export function leaveMyChallengeRushLobby() { const lobby = myChallengeRushLobby(); return lobby ? emit('challenge-rush:lobby:leave', { lobbyId: lobby.id, playerId: myId() }) : Promise.resolve({ ok: true }); }
function scoreText(scores = []) { return [...scores].sort((a, b) => b.score - a.score).map((score, index) => `<div class="challenge-rush-score-row"><span>${index + 1}. ${escapeHtml(score.name)}</span><strong>${score.score}</strong></div>`).join(''); }
export function renderChallengeRushLobbyCard() {
  const current = myChallengeRushLobby();
  const cards = lobbies.map((lobby) => arcadeLobbyEntryHtml(lobby, { full: lobby.players.length >= 15, joinAction: lobby.players.some((p) => p.id === myId()) ? '' : `<button type="button" class="btn btn-sm btn-primary" data-cr-join="${lobby.id}" ${lobby.players.length >= 15 ? 'disabled' : ''}>Beitreten</button>`, footerActions: lobby.host.id === myId() ? `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Schließen</button><button type="button" class="btn btn-sm btn-primary" data-cr-start="${lobby.id}" ${lobby.players.every((p) => p.ready || p.id === lobby.host.id) ? '' : 'disabled'}>Start</button>` : `<button type="button" class="btn btn-sm btn-danger" data-cr-leave="${lobby.id}">Verlassen</button>${readyToggleHtml(lobby, myId(), 'cr-ready')}` })).join('');
  return `<div class="card stack arcade-lobby-card"><p class="muted">Gemeinsame Runde · bis zu 15 Spieler · vier Challenges</p>${cards || '<div class="empty-state">Noch keine Lobby offen.</div>'}<div class="arcade-lobby-create-actions"><button type="button" class="btn btn-primary btn-sm" id="cr-create" ${current ? 'disabled' : ''}>Lobby öffnen</button></div></div>`;
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
  return `<section class="card stack challenge-rush-stage" aria-live="polite"><div class="row-between"><span class="badge badge-playing">Challenge ${(match?.challengeIndex ?? 0) + 1} / ${match?.challengeCount ?? 4}</span><span>${match?.paused ? 'Pause' : match?.phase === 'countdown' ? 'Startet gleich' : match?.phase === 'result' ? 'Auswertung' : 'Läuft'}</span></div><h2>${escapeHtml(challenge?.title ?? 'Mini-Challenge')}</h2><p class="muted">${escapeHtml(challenge?.description ?? '')}</p><div class="challenge-rush-playfield">${body}</div>${match?.phase === 'result' ? `<div class="challenge-rush-result">Runde abgeschlossen</div>` : ''}</section>`;
}
export function renderChallengeRush(container, ctx) { ensureChallengeRushSocket(); rerender = () => renderChallengeRush(container, ctx); const scores = match?.scores ?? []; container.innerHTML = `<div class="arcade-game-shell"><button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><h1 class="view-title">Challenge Rush</h1>${match?.phase === 'ended' ? `<section class="card stack"><h2>Gesamtergebnis</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div><button type="button" class="btn btn-primary" id="cr-back">Zur Arcade</button></section>` : `${challengeView(container)}<section class="card stack"><h2>Zwischenstand</h2><div class="challenge-rush-scoreboard">${scoreText(scores)}</div></section>`}</div>`; container.querySelector('#cr-back')?.addEventListener('click', () => { match = null; latestResult = null; navigate('arcade'); }); container.querySelector('[data-navigate="arcade"]')?.addEventListener('click', () => navigate('arcade'));
  const send = (action, value) => socket.emit('challenge-rush:challenge:input', { matchId: match.matchId, playerId: myId(), action, value }, (result) => { if (!result?.ok && !result?.ignored) showToast(result?.error || 'Eingabe abgelehnt.', { error: true }); });
  container.querySelector('.challenge-rush-circle')?.addEventListener('click', (event) => { const circle = event.currentTarget; send('hit', { x: Number(circle.dataset.crX), y: Number(circle.dataset.crY) }); });
  container.querySelector('.challenge-rush-big-button:not([data-cr-stop])')?.addEventListener('click', () => { send('click'); const counter = container.querySelector('#cr-clicks'); if (counter) counter.textContent = String(Number(counter.textContent) + 1); });
  container.querySelector('[data-cr-stop]')?.addEventListener('click', () => send('stop'));
  container.querySelectorAll('[data-cr-number]').forEach((button) => button.addEventListener('click', () => { send('number', Number(button.dataset.crNumber)); numberOrder += 1; button.disabled = true; }));
}
