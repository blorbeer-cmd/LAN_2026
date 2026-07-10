import { api, getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { createScribbleController } from './arcadeScribble.js';

let socket = null;
let scribble = null;
let lobbies = [];
let stats = null;
let statsLoading = false;
let activeStatsGame = null;
let match = null;
let currentQuestion = null;
let lastResult = null;
let countdownInterval = null;
let customTarget = '';
let scribbleRounds = 2;
let scribbleTurnSeconds = 60;

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
}

function updateCountdownBadge() {
  const badge = document.querySelector('#quiz-countdown');
  if (!badge) return;
  const left = secondsLeft();
  badge.textContent = `${left}s`;
  badge.classList.toggle('badge-paused', left <= 5);
  badge.classList.toggle('badge-playing', left > 5);
}

function startCountdown() {
  stopCountdown();
  updateCountdownBadge();
  countdownInterval = setInterval(updateCountdownBadge, 1000);
}

async function loadStats(ctx) {
  if (statsLoading) return;
  statsLoading = true;
  try {
    stats = await api.arcade.stats();
  } catch (err) {
    showToast(err.message, { error: true });
    stats = { games: [] };
  } finally {
    statsLoading = false;
    ctx.rerender();
  }
}

function ensureSocket(ctx) {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  scribble = createScribbleController(ctx);
  scribble.registerSocket(socket);

  socket.on('arcade:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    ctx.rerender();
  });
  // Shared start event for both game types — the scribble controller (wired
  // above) handles its own gameType === 'scribble' case independently, this
  // handler only ever touches quiz state.
  socket.on('arcade:match:start', (payload) => {
    if (payload.gameType !== 'quiz') return;
    match = { ...payload, scores: payload.players.map((p) => ({ playerId: p.id, name: p.name, score: 0 })), paused: false };
    currentQuestion = null;
    lastResult = null;
    stopCountdown();
    ctx.rerender();
  });
  socket.on('arcade:quiz:question', (payload) => {
    currentQuestion = payload;
    if (payload.scores) match = { ...(match ?? {}), matchId: payload.matchId, scores: payload.scores, targetScore: payload.targetScore };
    lastResult = null;
    startCountdown();
    ctx.rerender();
  });
  socket.on('arcade:quiz:result', (payload) => {
    lastResult = payload;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    stopCountdown();
    ctx.rerender();
  });
  socket.on('arcade:quiz:timeout', (payload) => {
    lastResult = { winner: null, correctAnswer: payload.correctAnswer, timeout: true };
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    stopCountdown();
    ctx.rerender();
  });
  // These three events are shared with scribble matches too — always check
  // they're actually about *our* quiz match before touching quiz state,
  // otherwise a scribble match ending would corrupt the quiz view (and
  // vice versa) since both listeners sit on the same socket.
  socket.on('arcade:match:end', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    lastResult = payload.winner ? { winner: payload.winner, correctAnswer: 'Match beendet' } : lastResult;
    match = { ...match, scores: payload.scores, ended: true, winner: payload.winner };
    currentQuestion = null;
    stopCountdown();
    stats = null;
    loadStats(ctx);
    ctx.rerender();
  });
  socket.on('arcade:match:paused', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    match = { ...match, scores: payload.scores, paused: true, remainingMs: payload.remainingMs };
    stopCountdown();
    ctx.rerender();
  });
  socket.on('arcade:match:resumed', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    match = { ...match, scores: payload.scores, paused: false, remainingMs: null };
    if (currentQuestion && payload.expiresAt) currentQuestion = { ...currentQuestion, expiresAt: payload.expiresAt };
    startCountdown();
    ctx.rerender();
  });
  socket.on('arcade:match:opponent-left', (payload) => {
    if (!match || payload.matchId !== match.matchId) return;
    showToast('Ein Spieler hat das Match verlassen.', { error: true });
    match = null;
    currentQuestion = null;
    lastResult = null;
    stopCountdown();
    ctx.rerender();
  });
  return socket;
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function myLobby() {
  const myId = getMyId();
  return lobbies.find((l) => l.players.some((p) => p.id === myId)) ?? null;
}

function anyActiveMatch() {
  return !!match || !!scribble?.hasMatch();
}

function scoreHtml() {
  if (!match?.scores) return '';
  return match.scores
    .map((s) => `<span class="chip">${escapeHtml(s.name)} · ${s.score}/${match.targetScore ?? 5}</span>`)
    .join('');
}

function arcadeStatsHtml() {
  if (!stats && !statsLoading) return '';
  if (statsLoading && !stats) return `<div class="empty-state" style="padding:14px;">Statistiken laden…</div>`;
  const games = stats?.games ?? [];
  if (!games.length) return `<div class="empty-state" style="padding:14px;">Noch keine abgeschlossenen Arcade-Runden.</div>`;
  if (!games.some((g) => g.gameType === activeStatsGame)) activeStatsGame = games[0].gameType;

  const tabs =
    games.length > 1
      ? `<div class="row" style="gap:8px;flex-wrap:wrap;">${games
          .map(
            (g) =>
              `<button type="button" class="btn btn-sm ${g.gameType === activeStatsGame ? 'btn-primary' : ''}" data-stats-tab="${g.gameType}">${escapeHtml(g.title)}</button>`
          )
          .join('')}</div>`
      : '';

  const game = games.find((g) => g.gameType === activeStatsGame);
  const rows = game.players
    .slice(0, 4)
    .map(
      (p) => `
        <div class="lb-row">
          <span>${escapeHtml(p.name)}</span>
          <span class="muted">${p.wins} Sieg(e) · ${p.points} Punkte</span>
        </div>`
    )
    .join('');
  return `
    ${tabs}
    <div class="arcade-stat-game">
      <div class="row-between">
        <strong>${escapeHtml(game.title)}</strong>
        <span class="badge">${game.matches} Match(es)</span>
      </div>
      <div class="muted" style="font-size:0.8rem;">Top: ${escapeHtml(game.leader?.name ?? '-')}</div>
      ${rows}
    </div>`;
}

function quizStartControlsHtml(lobby) {
  const myId = getMyId();
  if (!lobby || lobby.gameType !== 'quiz' || lobby.host.id !== myId) return '';
  return `
    <div class="card stack" style="margin-top:12px;">
      <strong>Quiz-Lobby starten</strong>
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        <label class="check-row" style="padding:8px 10px;"><input type="radio" name="target-score" value="5" checked />5</label>
        <label class="check-row" style="padding:8px 10px;"><input type="radio" name="target-score" value="10" />10</label>
        <label class="check-row" style="padding:8px 10px;"><input type="radio" name="target-score" value="20" />20</label>
        <label class="row" style="gap:6px;align-items:center;">
          <input type="radio" name="target-score" value="custom" />
          <input type="number" id="target-custom" min="1" max="100" value="${escapeHtml(customTarget)}" placeholder="frei" style="width:78px;" />
        </label>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="quiz-start-lobby" ${lobby.players.length < 2 ? 'disabled' : ''}>Start</button>
    </div>`;
}

function scribbleStartControlsHtml(lobby) {
  const myId = getMyId();
  if (!lobby || lobby.gameType !== 'scribble' || lobby.host.id !== myId) return '';
  return `
    <div class="card stack" style="margin-top:12px;">
      <strong>Scribble-Lobby starten</strong>
      <div class="field-label">Runden</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        ${[1, 2, 3]
          .map((n) => `<label class="check-row" style="padding:8px 10px;"><input type="radio" name="scribble-rounds" value="${n}" ${n === scribbleRounds ? 'checked' : ''} />${n}</label>`)
          .join('')}
      </div>
      <div class="field-label">Zeit pro Runde</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        ${[40, 60, 80]
          .map(
            (n) =>
              `<label class="check-row" style="padding:8px 10px;"><input type="radio" name="scribble-turn-seconds" value="${n}" ${n === scribbleTurnSeconds ? 'checked' : ''} />${n}s</label>`
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-primary btn-block" id="scribble-start-lobby" ${lobby.players.length < 2 ? 'disabled' : ''}>Start</button>
    </div>`;
}

function lobbyGameLabel(gameType) {
  return gameType === 'scribble' ? 'Scribble' : 'Quiz';
}

function renderLobbyList() {
  const mine = myLobby();
  if (lobbies.length === 0) return `<div class="empty-state" style="padding:14px;">Keine offene Lobby.</div>`;
  return lobbies
    .map((l) => {
      const isHost = l.host.id === getMyId();
      const joined = l.players.some((p) => p.id === getMyId());
      const action = isHost
        ? `<button type="button" class="btn btn-sm btn-danger" data-close-lobby="${l.id}">Schließen</button>`
        : joined
          ? `<span class="badge badge-playing">Drin</span>`
          : `<button type="button" class="btn btn-sm btn-primary" data-join-lobby="${l.id}" ${mine ? 'disabled' : ''}>Beitreten</button>`;
      return `
        <div class="lb-row" style="align-items:flex-start;">
          <div class="stack" style="gap:6px;flex:1;">
            <strong>${escapeHtml(l.host.name)}s ${lobbyGameLabel(l.gameType)}-Lobby</strong>
            <div class="chip-list">${l.players.map((p) => `<span class="chip">${escapeHtml(p.name)}</span>`).join('')}</div>
            <div class="muted" style="font-size:0.78rem;">${l.players.length} Spieler · Host startet, wenn alle bereit sind</div>
          </div>
          ${action}
        </div>`;
    })
    .join('');
}

function secondsLeft() {
  if (match?.paused) return Math.max(0, Math.ceil((match.remainingMs ?? 0) / 1000));
  if (!currentQuestion?.expiresAt) return 0;
  return Math.max(0, Math.ceil((currentQuestion.expiresAt - Date.now()) / 1000));
}

function matchControlsHtml() {
  if (!match || match.ended || match.host?.id !== getMyId()) return '';
  return `
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;">
      ${
        match.paused
          ? `<button type="button" class="btn btn-sm btn-primary" id="quiz-resume">Fortsetzen</button>`
          : `<button type="button" class="btn btn-sm" id="quiz-pause">Pausieren</button>`
      }
      <button type="button" class="btn btn-sm btn-danger" id="quiz-finish">Beenden</button>
    </div>`;
}

function winnerCelebrationHtml() {
  const winner = match?.winner ?? lastResult?.winner;
  if (!match?.ended || !winner) return '';
  return `
    <div class="card arcade-winner-card">
      <div class="arcade-winner-burst" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="arcade-winner-crown">🏆</div>
      <div>
        <div class="arcade-winner-label">Gewinner</div>
        <strong>${escapeHtml(winner.name)}</strong>
      </div>
      <div class="chip-list">${scoreHtml()}</div>
    </div>`;
}

function renderQuizMatch() {
  if (!match) return '';
  const celebration = winnerCelebrationHtml();
  const result = lastResult && !celebration
    ? `<div class="card stack" style="margin-top:12px;">
        <strong>${lastResult.timeout ? 'Zeit abgelaufen' : `${escapeHtml(lastResult.winner?.name ?? 'Niemand')} gewinnt die Runde`}</strong>
        <span class="muted">Antwort: ${escapeHtml(lastResult.correctAnswer ?? '')}</span>
      </div>`
    : '';
  const question = currentQuestion
    ? `
      <form id="quiz-answer-form" class="card stack" style="margin-top:12px;">
        <div class="row-between">
          <div class="muted">${escapeHtml(currentQuestion.category || 'Quiz')} · ${escapeHtml(currentQuestion.difficulty || 'offen')}</div>
          <span id="quiz-countdown" class="badge ${secondsLeft() <= 5 ? 'badge-paused' : 'badge-playing'}">${match.paused ? 'Pause' : `${secondsLeft()}s`}</span>
        </div>
        <h2 style="font-size:1.15rem;margin:0;">${escapeHtml(currentQuestion.question)}</h2>
        <div class="row">
          <input type="text" id="quiz-answer" autocomplete="off" placeholder="Antwort" style="flex:1;" ${match.paused ? 'disabled' : ''} />
          <button type="submit" class="btn btn-primary" ${match.paused ? 'disabled' : ''}>Senden</button>
        </div>
        ${match.paused ? `<div class="muted">Match pausiert.</div>` : ''}
      </form>`
    : match.ended
      ? `<div class="empty-state" style="margin-top:12px;">Match beendet.</div>`
      : `<div class="empty-state" style="margin-top:12px;">Nächste Frage kommt…</div>`;
  return `
    <div class="section-title">🎮 Laufendes Match</div>
    <div class="chip-list">${scoreHtml()}</div>
    ${matchControlsHtml()}
    ${celebration}
    ${result}
    ${question}
  `;
}

export function renderArcade(container, ctx) {
  ensureSocket(ctx);
  if (!stats && !statsLoading) loadStats(ctx);
  const lobby = myLobby();
  const lobbyOrMatchActive = !!lobby || anyActiveMatch();

  container.innerHTML = `
    <h1 class="view-title">Arcade</h1>
    ${whoAmICardHtml('whoami')}
    <div class="section-title">${icon('brain')} Gaming-Quiz</div>
    <div class="card stack">
      <div class="row-between" style="gap:10px;">
        <div>
          <strong>Quiz-Lobby</strong>
          <div class="muted" style="font-size:0.8rem;">Mehrspieler, 20 Sekunden pro Frage, beliebig viele Antwortversuche.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="quiz-create-lobby" ${lobbyOrMatchActive ? 'disabled' : ''}>Lobby öffnen</button>
      </div>
    </div>
    <div class="section-title">✏️ Scribble</div>
    <div class="card stack">
      <div class="row-between" style="gap:10px;">
        <div>
          <strong>Scribble-Lobby</strong>
          <div class="muted" style="font-size:0.8rem;">Einer zeichnet, alle anderen raten den Begriff.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="scribble-create-lobby" ${lobbyOrMatchActive ? 'disabled' : ''}>Lobby öffnen</button>
      </div>
    </div>
    <div class="section-title">🕹️ Offene Lobbys</div>
    <div class="card stack">${renderLobbyList()}</div>
    <div class="section-title">📊 Arcade-Statistiken</div>
    <div class="card stack">${arcadeStatsHtml()}</div>
    ${quizStartControlsHtml(lobby)}
    ${scribbleStartControlsHtml(lobby)}
    ${renderQuizMatch()}
    ${scribble.renderMatch()}
  `;

  wireWhoAmICard(container, 'whoami', ctx);
  scribble.wireMatch(container);

  container.querySelectorAll('[data-stats-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeStatsGame = btn.dataset.statsTab;
      ctx.rerender();
    });
  });

  container.querySelector('#quiz-create-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const res = await emitWithAck('arcade:lobby:create', { gameType: 'quiz', playerId });
    if (!res?.ok) return showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
    showToast('Quiz-Lobby geöffnet.');
  });

  container.querySelector('#scribble-create-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const res = await emitWithAck('arcade:lobby:create', { gameType: 'scribble', playerId });
    if (!res?.ok) return showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
    showToast('Scribble-Lobby geöffnet.');
  });

  container.querySelectorAll('[data-close-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      const res = await emitWithAck('arcade:lobby:close', { lobbyId: btn.dataset.closeLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Schließen fehlgeschlagen.', { error: true });
    });
  });

  container.querySelectorAll('[data-join-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      const res = await emitWithAck('arcade:lobby:join', { lobbyId: btn.dataset.joinLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
    });
  });

  container.querySelector('#target-custom')?.addEventListener('input', (e) => {
    customTarget = e.target.value;
  });

  container.querySelector('#quiz-start-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    const selected = container.querySelector('input[name="target-score"]:checked')?.value ?? '5';
    const targetScore = selected === 'custom' ? Number(container.querySelector('#target-custom').value) : Number(selected);
    const res = await emitWithAck('arcade:lobby:start', { lobbyId: lobby.id, playerId, targetScore });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });

  container.querySelectorAll('input[name="scribble-rounds"]').forEach((el) => {
    el.addEventListener('change', () => {
      scribbleRounds = Number(el.value);
    });
  });
  container.querySelectorAll('input[name="scribble-turn-seconds"]').forEach((el) => {
    el.addEventListener('change', () => {
      scribbleTurnSeconds = Number(el.value);
    });
  });
  container.querySelector('#scribble-start-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    const res = await emitWithAck('arcade:lobby:start', {
      lobbyId: lobby.id,
      playerId,
      rounds: scribbleRounds,
      turnDurationMs: scribbleTurnSeconds * 1000,
    });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-answer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const playerId = getMyId();
    const input = container.querySelector('#quiz-answer');
    const text = input.value.trim();
    if (!playerId || !match?.matchId || !text) return;
    const res = await emitWithAck('arcade:quiz:answer', { matchId: match.matchId, playerId, text });
    if (res?.ok && res.correct === false) showToast('Noch nicht richtig.');
    if (!res?.ok) showToast(res?.error || 'Antwort nicht angenommen.', { error: true });
    input.value = '';
    input.focus();
  });

  container.querySelector('#quiz-pause')?.addEventListener('click', async () => {
    const res = await emitWithAck('arcade:match:pause', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-resume')?.addEventListener('click', async () => {
    const res = await emitWithAck('arcade:match:resume', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-finish')?.addEventListener('click', async () => {
    if (!confirm('Match wirklich beenden?')) return;
    const res = await emitWithAck('arcade:match:finish', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
  });
}
