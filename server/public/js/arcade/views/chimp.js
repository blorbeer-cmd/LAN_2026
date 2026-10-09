import { escapeHtml } from '../../format.js';
import { connectSocket } from '../../socket.js';
import { getMyId } from '../../whoami.js';
import { showToast } from '../../toast.js';
import { icon } from '../../icons.js';
import { confirmDialog } from '../../modal.js';
import { playerById } from '../../state.js';
import { infoTooltipHtml, wireInfoTooltips } from '../../infoTooltip.js';
import { arcadeLobbyEntryHtml, arcadeLobbyHostActionsHtml, arcadeLobbyGuestActionsHtml, arcadeLobbyJoinHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadePlayerStripHtml, arcadeResultListHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { cancelCountdown, showCountdown } from '../countdown.js';
import { playArcadeSound } from '../arcadeSound.js';
import {
  chimpCellLabel, chimpGridModel, chimpNeighbor, chimpNumbersText, chimpRatingText, chimpStageMode, chimpStrikesText, chimpTimeText,
} from '../chimpFormat.js';

// Chimp Test: memorize the numbers, tap the 1 and the rest disappear, tap the
// hidden tiles in order. Every run is a solo result; a shared round only adds
// a display-only round ranking at the end.

const MAX_PLAYERS = 15;
const RULES_HELP = 'Merke dir die Zahlen. Tippe die 1 – dann werden alle anderen verdeckt. Tippe den Rest in der richtigen Reihenfolge. Drei Fehler und du bist raus. Ayumu schaffte in der Studie alle 9 Ziffern – der Vergleich ist nur zum Spaß.';
// The phone grid flows column by column below --bp-md.
const COLUMN_FLOW_QUERY = '(max-width: 639px)'; /* --bp-md */

let socket = null;
let lobbies = [];
let match = null;
let reveal = null;
let runEnd = null;
let roundEnd = null;
let clearedLocally = [];
let focusIndex = 0;
let countdownKey = null;

const myId = () => getMyId();
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const rerenderIfVisible = () => { if (currentView() === 'chimp') rerender(); };
function navigate(view, options = {}) {
  window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: { view, ...options } }));
}
function emit(event, payload) { return new Promise((resolve) => socket?.emit(event, payload, resolve)); }

function resetLocalMatch() {
  match = null; reveal = null; runEnd = null; roundEnd = null; clearedLocally = []; countdownKey = null;
}

// The own run changes only through acks and chimp:state; every change of the
// attempt clears the optimistic taps of the previous one.
function applyMe(me) {
  if (!match || !me) return;
  if (match.me?.levelToken !== me.levelToken || me.phase !== 'memorize' && me.phase !== 'input') clearedLocally = [];
  else if (me.phase === 'input') clearedLocally = clearedLocally.filter((cell) => me.hiddenCells?.includes(cell));
  if (me.phase !== 'reveal') reveal = null;
  match = { ...match, me };
}

function syncCountdown() {
  if (match?.phase === 'countdown' && !match.paused && typeof match.remainingMs === 'number') {
    const key = `${match.matchId}`;
    if (countdownKey !== key) { countdownKey = key; showCountdown(Date.now() + match.remainingMs); }
  } else if (match?.phase !== 'countdown' || match?.paused) {
    if (countdownKey !== null && match?.phase !== 'countdown') playArcadeSound('challenge-start');
    countdownKey = null;
    cancelCountdown();
  }
}

// Other players' progress only patches the strip, so a busy round never
// rebuilds the own grid while someone is tapping it.
function patchStandings() {
  const strip = document.querySelector('[data-chimp-standings]');
  if (strip) strip.innerHTML = standingsHtml();
  const waiting = document.querySelector('[data-chimp-waiting]');
  if (waiting) waiting.innerHTML = waitingHtml();
}

export function ensureChimpSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('chimp:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    // The hub stays live even while this tab still keeps a finished run.
    if (currentView() === 'arcade') rerender();
  });
  socket.on('chimp:match:start', (payload) => {
    const sameMatch = payload?.reconnected === true && match?.matchId === payload.matchId;
    if (!sameMatch) { resetLocalMatch(); match = { ...payload, standings: [] }; }
    else match = { ...match, ...payload, disconnected: false };
    navigate('chimp');
  });
  socket.on('chimp:state', (payload) => {
    if (!payload || (match && payload.matchId !== match.matchId)) return;
    const { me, ...rest } = payload;
    match = { ...(match ?? {}), ...rest };
    if (me) applyMe(me);
    syncCountdown();
    rerenderIfVisible();
  });
  socket.on('chimp:standings', (payload) => {
    if (!match || payload?.matchId !== match.matchId) return;
    match = { ...match, standings: payload.standings ?? [] };
    patchStandings();
  });
  socket.on('chimp:reveal', (payload) => {
    if (!match || payload?.matchId !== match.matchId) return;
    reveal = payload;
    clearedLocally = [];
    playArcadeSound('quiz-wrong');
    rerenderIfVisible();
  });
  socket.on('chimp:run:end', (payload) => {
    if (!match || payload?.matchId !== match.matchId) return;
    runEnd = payload;
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats'));
    playArcadeSound(payload.newBest ? 'challenge-highscore' : 'challenge-gameover');
    rerenderIfVisible();
  });
  socket.on('chimp:match:end', (payload) => {
    if (!match || payload?.matchId !== match.matchId) return;
    cancelCountdown();
    roundEnd = payload;
    match = { ...match, phase: 'ended', paused: false };
    rerenderIfVisible();
  });
  socket.on('disconnect', () => { if (match) { match = { ...match, disconnected: true }; rerenderIfVisible(); } });
  socket.on('connect', () => {
    if (!match?.matchId || match.phase === 'ended') return;
    socket.emit('chimp:match:reconnect', { matchId: match.matchId, playerId: myId() }, (result) => {
      if (result?.ok) return;
      const wasVisible = currentView() === 'chimp';
      resetLocalMatch();
      if (wasVisible) {
        showToast('Chimp Test wegen Zeitüberschreitung verlassen.', { error: true });
        navigate('arcade', { replace: true });
      }
    });
  });
  socket.emit('chimp:lobbies:get');
  return socket;
}

export function myChimpLobby() { return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())); }
export function hasChimpMatch() { return Boolean(match && match.phase !== 'ended' && match.me?.phase !== 'out'); }
export function leaveMyChimpLobby() {
  const lobby = myChimpLobby();
  return lobby ? emit('chimp:lobby:leave', { lobbyId: lobby.id, playerId: myId() }) : Promise.resolve({ ok: true });
}

export async function createChimpLobby() {
  const result = await emit('chimp:lobby:create', { playerId: myId() });
  if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return result;
}

function lobbyEntryHtml(lobby) {
  const joined = lobby.players.some((player) => player.id === myId());
  const isHost = lobby.host.id === myId();
  const startReady = lobby.players.every((player) => player.ready || player.id === lobby.host.id);
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: `data-chimp-start="${escapeHtml(lobby.id)}"`, startEnabled: startReady, startHint: startReady ? '' : 'Noch nicht alle bereit', closeAttrs: `data-chimp-leave="${escapeHtml(lobby.id)}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(lobby, myId(), 'chimp-ready'), leaveAttrs: `data-chimp-leave="${escapeHtml(lobby.id)}"` })
      : '';
  const full = lobby.players.length >= MAX_PLAYERS;
  const joinAction = joined ? '' : arcadeLobbyJoinHtml(`data-chimp-join="${escapeHtml(lobby.id)}"`, full || hasChimpMatch());
  return arcadeLobbyEntryHtml(lobby, { gameType: 'chimp', meta: `${lobby.players.length} Spieler`, full, capacity: lobby.players.length, joinAction, footerActions });
}

export function renderChimpLobbyEntries() {
  return lobbies.map((lobby) => ({ id: lobby.id, html: lobbyEntryHtml(lobby) }));
}

export function wireChimpLobbyCard(container, { beforeJoin = async () => true } = {}) {
  container.querySelectorAll('[data-chimp-join]').forEach((button) => button.addEventListener('click', async () => {
    if (!(await beforeJoin())) return;
    const result = await emit('chimp:lobby:join', { lobbyId: button.dataset.chimpJoin, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  container.querySelectorAll('[data-chimp-leave]').forEach((button) => button.addEventListener('click', () => emit('chimp:lobby:leave', { lobbyId: button.dataset.chimpLeave, playerId: myId() })));
  wireReadyToggle(container, 'chimp-ready', async (lobbyId, ready) => {
    const result = await emit('chimp:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });
  container.querySelectorAll('[data-chimp-start]').forEach((button) => button.addEventListener('click', async () => {
    const result = await emit('chimp:lobby:start', { lobbyId: button.dataset.chimpStart, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true });
  }));
}

// Spectators and the watch view only ever get progress counters, never cells.
export function chimpSpectatorHtml(state) {
  const scores = [...(state?.scores ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!scores.length) return '<div class="arcade-watch-placeholder">Gleich geht es los</div>';
  return arcadePlayerStripHtml(scores.map((entry) => ({
    name: entry.name ?? 'Spieler',
    colorVar: playerById(entry.playerId)?.color || 'var(--text-muted)',
    value: String(entry.score ?? 0),
    detail: entry.status === 'playing' ? `${chimpNumbersText(entry.level ?? 0)} · ${entry.clicked ?? 0} geklickt${entry.strikes ? ` · ${chimpStrikesText(entry.strikes)}` : ''}` : entry.status === 'left' ? 'Ausgestiegen' : entry.status === 'disconnected' ? 'Getrennt' : 'Fertig',
    me: false,
    out: entry.status === 'out' || entry.status === 'left',
  })));
}

// ---------- Match view ----------

function standingStatus(entry) {
  if (entry.invalid) return 'Ungültig';
  if (entry.status === 'left') return 'Ausgestiegen';
  if (entry.status === 'out') return 'Fertig';
  if (entry.status === 'disconnected') return 'Getrennt';
  return `${chimpNumbersText(entry.level)}${entry.strikes ? ` · ${chimpStrikesText(entry.strikes)}` : ''}`;
}

function standingsHtml() {
  const standings = match?.standings ?? [];
  if (standings.length < 2) return '';
  const sorted = [...standings].sort((a, b) => b.bestLevel - a.bestLevel || a.strikes - b.strikes);
  return arcadePlayerStripHtml(sorted.map((entry) => ({
    name: entry.name ?? playerById(entry.playerId)?.name ?? 'Spieler',
    colorVar: playerById(entry.playerId)?.color || 'var(--text-muted)',
    value: String(entry.bestLevel ?? 0),
    detail: standingStatus(entry),
    me: entry.playerId === myId(),
    out: entry.status === 'out' || entry.status === 'left',
  })));
}

function waitingHtml() {
  const playing = (match?.standings ?? []).filter((entry) => entry.status === 'playing' || entry.status === 'disconnected');
  if (!playing.length || match?.phase === 'ended') return '';
  return `<p class="chimp-note">${playing.length === 1 ? 'Noch 1 Person spielt' : `Noch ${playing.length} Personen spielen`}</p>`;
}

function strikesHtml(strikes, maxStrikes) {
  const marks = Array.from({ length: maxStrikes }, (_, index) => `<span class="chimp-strike${index < strikes ? ' is-used' : ''}" aria-hidden="true">${icon('x')}</span>`).join('');
  return `<span class="chimp-strikes" role="img" aria-label="${strikes} von ${maxStrikes} Strikes">${marks}</span>`;
}

function gridHtml(cells, { interactive }) {
  const tabbable = interactive ? Math.min(Math.max(0, focusIndex), cells.length - 1) : -1;
  const html = cells.map((cell, index) => {
    const classes = ['chimp-cell', `is-${cell.kind}`];
    if (cell.wrong) classes.push('is-wrong');
    const content = cell.kind === 'number' || cell.kind === 'revealed' ? String(cell.number) : '';
    return `<button type="button" class="${classes.join(' ')}" data-chimp-cell="${index}" aria-label="${escapeHtml(chimpCellLabel(index, cell))}" tabindex="${index === tabbable ? '0' : '-1'}" ${interactive ? '' : 'disabled'}>${content}</button>`;
  }).join('');
  return `<div class="chimp-grid" role="group" aria-label="Spielfeld">${html}</div>`;
}

function revealNoteHtml() {
  if (!reveal) return '';
  return reveal.wrongCell === null
    ? `<p class="chimp-note is-danger" role="status">Zeit abgelaufen – die ${reveal.expectedNumber} war dran</p>`
    : `<p class="chimp-note is-danger" role="status">Falsch – die ${reveal.expectedNumber} war dran</p>`;
}

function interstitialHtml(me) {
  const success = me.lastOutcome === 'success';
  const title = success ? `${chimpNumbersText(me.bestLevel)} geschafft` : `Strike ${me.strikes} von ${me.maxStrikes}`;
  const next = success ? `Als Nächstes: ${chimpNumbersText(me.level + 1)}` : `Noch einmal ${chimpNumbersText(me.level)}`;
  return `<div class="chimp-interstitial">
    <strong class="chimp-interstitial-title">${escapeHtml(title)}</strong>
    <span class="chimp-note">${escapeHtml(next)}</span>
    <button type="button" class="btn btn-primary" data-chimp-continue>Weiter</button>
  </div>`;
}

function ownResultHtml() {
  const result = runEnd?.result ?? match?.me?.result;
  if (!result) return '<div class="chimp-interstitial"><strong class="chimp-interstitial-title">Lauf beendet</strong></div>';
  const rating = result.rating ?? { percent: 0, beyond: 0, tier: '' };
  const barValue = rating.beyond > 0 ? 100 : rating.percent ?? 0;
  const facts = [chimpStrikesText(result.strikesAtLevel), chimpTimeText(result.activeMsAtLevel)];
  const best = runEnd && !runEnd.invalid && runEnd.newBest && runEnd.previousBest !== null
    ? `<span class="chimp-note">Neuer Bestwert – vorher ${escapeHtml(String(runEnd.previousBest))}</span>`
    : runEnd?.newBest ? '<span class="chimp-note">Dein erster Bestwert</span>' : '';
  const rank = runEnd?.rank ? `<span class="chimp-note">Platz ${escapeHtml(String(runEnd.rank))} in der Chimp-Test-Rangliste</span>` : '';
  const invalid = runEnd?.invalid ? '<span class="chimp-note is-danger">Ungültiger Lauf – zu schnell für einen Menschen, er zählt nicht</span>' : '';
  return `<div class="chimp-result" data-chimp-result>
    <span class="chimp-result-level">${escapeHtml(chimpNumbersText(result.level))}</span>
    <div class="chimp-rating">
      <span class="chimp-rating-label">${escapeHtml(chimpRatingText(rating))}</span>
      <span class="chimp-rating-track" role="img" aria-label="${escapeHtml(`Affen-Nähe ${chimpRatingText(rating)}`)}"><span class="chimp-rating-bar" style="width:${barValue}%"></span></span>
    </div>
    <span class="chimp-note">${escapeHtml(facts.join(' · '))}</span>
    ${invalid}${best}${rank}
    <button type="button" class="btn btn-sm" data-chimp-leaderboard>Rangliste</button>
  </div>`;
}

function stageBodyHtml() {
  const me = match?.me;
  const mode = chimpStageMode(match);
  if (mode === 'result') return ownResultHtml();
  if (mode === 'paused') return '<div class="chimp-concealed"><strong>Pause</strong><span class="chimp-note">Das Spielfeld erscheint nach dem Fortsetzen</span></div>';
  if (mode === 'countdown') return `<div class="chimp-concealed" data-countdown-anchor><strong>Gleich geht es los</strong><span class="chimp-note">Merke dir die Zahlen und tippe die 1 zuerst</span></div>`;
  if (mode === 'interstitial') return interstitialHtml(me);
  const interactive = !reveal && (me.phase === 'memorize' || me.phase === 'input') && !match.disconnected;
  const hint = reveal ? revealNoteHtml() : me.phase === 'memorize' && !clearedLocally.length
    ? '<p class="chimp-note">Merken, dann mit der 1 beginnen</p>'
    : `<p class="chimp-note">${me.clicked + clearedLocally.length} von ${me.level}</p>`;
  // The hint sits above the grid so a phone never has to scroll to read it.
  return `${hint}${gridHtml(chimpGridModel(me, reveal, clearedLocally), { interactive })}`;
}

function stageHtml() {
  const me = match?.me;
  const head = me && match.phase !== 'countdown' && me.phase !== 'out' && match.phase !== 'ended'
    ? `<div class="chimp-head"><strong class="chimp-level">${escapeHtml(chimpNumbersText(me.level))}</strong>${strikesHtml(me.strikes, me.maxStrikes ?? 3)}</div>`
    : '';
  // The own grid comes first; everyone else's progress follows below it.
  const others = match?.phase === 'ended' ? '' : `<div data-chimp-standings>${standingsHtml()}</div><div data-chimp-waiting>${waitingHtml()}</div>`;
  return `<section class="card arcade-stage chimp-stage" data-match-id="${escapeHtml(match?.matchId ?? '')}" data-phase="${escapeHtml(match?.phase ?? '')}" data-run-phase="${escapeHtml(me?.phase ?? '')}" data-disconnected="${match?.disconnected === true}">
    ${head}
    <div class="chimp-playfield" aria-live="polite">${stageBodyHtml()}</div>
    ${others}
  </section>`;
}

function roundRankingHtml() {
  const ranking = roundEnd?.ranking;
  if (!Array.isArray(ranking) || ranking.length < 2) return '';
  const rows = ranking.map((entry) => ({
    player: { id: entry.playerId, name: entry.name },
    place: entry.place ?? '–',
    value: chimpNumbersText(entry.level),
    detail: entry.place === null
      ? 'Ungültig'
      : [chimpRatingText(entry.rating), chimpStrikesText(entry.strikesAtLevel), chimpTimeText(entry.activeMsAtLevel), entry.endReason === 'left' ? 'Ausgestiegen' : ''].filter(Boolean).join(' · '),
    me: entry.playerId === myId(),
  }));
  return `<section class="card stack grouped-page-section chimp-round" aria-labelledby="chimp-round-title">
    <div class="grouped-page-section-title"><h2 id="chimp-round-title">Rundenrangliste</h2></div>
    <p class="chimp-note chimp-round-note">Nur für diese Runde – gezählt wird dein Solo-Ergebnis</p>
    ${arcadeResultListHtml(rows)}
  </section>`;
}

function matchControlsHtml() {
  if (!match) return '';
  if (match.phase === 'ended') return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" data-chimp-close>Schließen</button>');
  if (match.host?.id === myId()) {
    return arcadeMatchControlsHtml(`<button type="button" class="btn btn-sm" data-chimp-pause>${match.paused ? 'Fortsetzen' : 'Pausieren'}</button><button type="button" class="btn btn-sm" data-chimp-finish>Beenden</button>`);
  }
  if (match.me?.phase === 'out') return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" data-chimp-close>Schließen</button>');
  return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" data-chimp-leave-match>Verlassen</button>');
}

function closeMatch() {
  cancelCountdown();
  const ended = match?.phase === 'ended' || match?.me?.phase === 'out';
  const current = match;
  resetLocalMatch();
  if (!ended && current?.matchId) emit('chimp:match:leave', { matchId: current.matchId, playerId: myId() });
  navigate('arcade');
}

function sendClick(index) {
  const me = match?.me;
  if (!me || reveal || match.paused || (me.phase !== 'memorize' && me.phase !== 'input')) return;
  const cells = chimpGridModel(me, null, clearedLocally);
  if (cells[index]?.kind === 'empty') return;
  // Optimistic: the tile disappears right away; the ack or the next state
  // corrects it if the server saw it differently.
  clearedLocally = [...clearedLocally, index];
  focusIndex = index;
  rerender();
  const levelToken = me.levelToken;
  socket.emit('chimp:click', { matchId: match.matchId, playerId: myId(), levelToken, cell: index }, (result) => {
    if (!match || match.me?.levelToken !== levelToken) return;
    if (!result?.ok) {
      clearedLocally = clearedLocally.filter((cell) => cell !== index);
      showToast(result?.error || 'Eingabe abgelehnt.', { error: true });
    }
    if (result?.me) applyMe(result.me);
    if (result?.result === 'level-complete') playArcadeSound('challenge-point');
    rerenderIfVisible();
  });
}

function wireGrid(container) {
  const grid = container.querySelector('.chimp-grid');
  if (!grid) return;
  grid.querySelectorAll('[data-chimp-cell]').forEach((button) => button.addEventListener('click', () => sendClick(Number(button.dataset.chimpCell))));
  grid.addEventListener('keydown', (event) => {
    const current = Number(event.target?.dataset?.chimpCell);
    if (!Number.isInteger(current)) return;
    const next = chimpNeighbor(current, event.key, window.matchMedia(COLUMN_FLOW_QUERY).matches);
    if (next === null) return;
    event.preventDefault();
    focusIndex = next;
    grid.querySelectorAll('[data-chimp-cell]').forEach((button) => { button.tabIndex = Number(button.dataset.chimpCell) === next ? 0 : -1; });
    grid.querySelector(`[data-chimp-cell="${next}"]`)?.focus();
  });
}

export function renderChimp(container, _ctx) {
  ensureChimpSocket();
  if (!match) {
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }
  const hadGridFocus = document.activeElement?.matches?.('[data-chimp-cell]');
  container.innerHTML = `<div class="arcade-game-shell${match.phase === 'ended' ? ' is-ended' : ''}">
    ${arcadeGameHeaderHtml('Chimp Test', matchControlsHtml(), { expand: false, titleInfoHtml: infoTooltipHtml('chimp-rules-help', 'Chimp Test', RULES_HELP) })}
    <div class="grouped-page-sections">${roundRankingHtml()}${stageHtml()}</div>
  </div>`;
  wireArcadeToolbar(container);
  wireInfoTooltips(container);
  wireGrid(container);
  if (hadGridFocus) container.querySelector(`[data-chimp-cell="${focusIndex}"]`)?.focus();
  container.querySelector('[data-chimp-continue]')?.focus();
  container.querySelector('[data-chimp-continue]')?.addEventListener('click', async () => {
    const result = await emit('chimp:continue', { matchId: match.matchId, playerId: myId(), levelToken: match.me?.levelToken });
    if (!result?.ok) return showToast(result?.error || 'Weiter nicht möglich.', { error: true });
    if (result.me) { applyMe(result.me); focusIndex = 0; rerenderIfVisible(); }
  });
  container.querySelector('[data-chimp-pause]')?.addEventListener('click', async () => {
    const result = await emit('chimp:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Pause konnte nicht geändert werden.', { error: true });
  });
  container.querySelector('[data-chimp-finish]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Chimp Test für alle beenden? Offene Läufe zählen mit ihrem erreichten Level.', { confirmText: 'Beenden', danger: true }))) return;
    const result = await emit('chimp:match:finish', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Beenden fehlgeschlagen.', { error: true });
  });
  container.querySelector('[data-chimp-leave-match]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Chimp Test verlassen? Dein Lauf endet mit dem erreichten Level.', { confirmText: 'Verlassen', danger: true }))) return;
    closeMatch();
  });
  container.querySelectorAll('[data-chimp-close]').forEach((button) => button.addEventListener('click', closeMatch));
  container.querySelector('[data-chimp-leaderboard]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats', { detail: { filter: 'chimp' } }));
    if (match?.phase === 'ended') resetLocalMatch();
    navigate('arcade');
  });
}
