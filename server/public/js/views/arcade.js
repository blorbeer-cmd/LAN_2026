import { api, getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

let socket = null;
let lobbies = [];
let match = null;
let currentQuestion = null;
let lastResult = null;
let questionsCache = null;
let loadingQuestions = false;

function ensureSocket(ctx) {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  socket.on('arcade:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    ctx.rerender();
  });
  socket.on('arcade:match:start', (payload) => {
    match = { ...payload, scores: payload.players.map((p) => ({ ...p, score: 0 })) };
    currentQuestion = null;
    lastResult = null;
    ctx.rerender();
  });
  socket.on('arcade:quiz:question', (payload) => {
    currentQuestion = payload;
    if (payload.scores) match = { ...(match ?? {}), matchId: payload.matchId, scores: payload.scores };
    lastResult = null;
    ctx.rerender();
  });
  socket.on('arcade:quiz:result', (payload) => {
    lastResult = payload;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    ctx.rerender();
  });
  socket.on('arcade:match:end', (payload) => {
    lastResult = payload.winner ? { winner: payload.winner, correctAnswer: 'Match beendet' } : null;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, ended: true, winner: payload.winner };
    currentQuestion = null;
    ctx.rerender();
  });
  socket.on('arcade:match:opponent-left', () => {
    showToast('Gegner hat das Match verlassen.', { error: true });
    match = null;
    currentQuestion = null;
    lastResult = null;
    ctx.rerender();
  });
  return socket;
}

async function loadQuestions(ctx) {
  if (loadingQuestions) return;
  loadingQuestions = true;
  try {
    questionsCache = await api.quiz.questions();
  } catch (err) {
    showToast(err.message, { error: true });
    questionsCache = { questions: [] };
  } finally {
    loadingQuestions = false;
    ctx.rerender();
  }
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    ensureSocket({ rerender: () => {} }).emit(event, payload, resolve);
  });
}

function scoreHtml() {
  if (!match?.scores) return '';
  return match.scores
    .map((s) => `<span class="chip">${escapeHtml(s.name)} · ${s.score}/${match.targetScore ?? 3}</span>`)
    .join('');
}

function renderLobbyList() {
  if (lobbies.length === 0) return `<div class="empty-state" style="padding:14px;">Keine offene Quiz-Lobby.</div>`;
  return lobbies
    .map(
      (l) => `
        <div class="lb-row">
          <div>
            <strong>${escapeHtml(l.host.name)}</strong>
            <div class="muted" style="font-size:0.78rem;">Gaming-Quiz · wartet auf Gegner</div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-join-lobby="${l.id}">Beitreten</button>
        </div>`
    )
    .join('');
}

function renderMatch() {
  if (!match) return '';
  const ended = match.ended;
  const result = lastResult
    ? `<div class="card stack" style="margin-top:12px;">
        <strong>${escapeHtml(lastResult.winner?.name ?? 'Niemand')} gewinnt die Runde</strong>
        <span class="muted">Antwort: ${escapeHtml(lastResult.correctAnswer ?? '')}</span>
      </div>`
    : '';
  const question = currentQuestion
    ? `
      <form id="quiz-answer-form" class="card stack" style="margin-top:12px;">
        <div class="muted">${escapeHtml(currentQuestion.category || 'Quiz')} · ${escapeHtml(currentQuestion.difficulty || 'offen')}</div>
        <h2 style="font-size:1.15rem;margin:0;">${escapeHtml(currentQuestion.question)}</h2>
        <div class="row">
          <input type="text" id="quiz-answer" autocomplete="off" placeholder="Antwort" style="flex:1;" />
          <button type="submit" class="btn btn-primary">Senden</button>
        </div>
      </form>`
    : ended
      ? `<div class="empty-state" style="margin-top:12px;">Match beendet.</div>`
      : `<div class="empty-state" style="margin-top:12px;">Nächste Frage kommt…</div>`;
  return `
    <div class="section-title">🎮 Laufendes Match</div>
    <div class="chip-list">${scoreHtml()}</div>
    ${result}
    ${question}
  `;
}

function questionRows() {
  const questions = questionsCache?.questions ?? [];
  return questions
    .slice(0, 12)
    .map(
      (q) => `
        <div class="lb-row" style="align-items:flex-start;">
          <div style="flex:1;">
            <strong>${escapeHtml(q.question)}</strong>
            <div class="muted" style="font-size:0.78rem;">${escapeHtml(q.category || 'Ohne Kategorie')} · ${escapeHtml(q.difficulty || 'offen')} · ${q.seenCount}× gesehen</div>
          </div>
          <button type="button" class="btn btn-sm" data-edit-question="${q.id}">Bearbeiten</button>
        </div>`
    )
    .join('');
}

function openQuestionForm(ctx, existing = null) {
  const { close } = openModal(
    existing ? 'Quizfrage bearbeiten' : 'Quizfrage anlegen',
    `
      <form id="question-form" class="stack">
        <div>
          <label class="field-label" for="question-text">Frage</label>
          <textarea id="question-text" maxlength="240" rows="3" required>${escapeHtml(existing?.question ?? '')}</textarea>
        </div>
        <div>
          <label class="field-label" for="question-answers">Antworten</label>
          <input id="question-answers" type="text" required value="${escapeHtml((existing?.answers ?? []).join(', '))}" placeholder="Antwort, Alternative, Schreibweise" />
        </div>
        <div class="row" style="align-items:flex-start;">
          <div style="flex:1;">
            <label class="field-label" for="question-category">Kategorie</label>
            <input id="question-category" type="text" maxlength="60" value="${escapeHtml(existing?.category ?? '')}" />
          </div>
          <div style="flex:1;">
            <label class="field-label" for="question-difficulty">Schwierigkeit</label>
            <input id="question-difficulty" type="text" maxlength="30" value="${escapeHtml(existing?.difficulty ?? '')}" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        modalEl.querySelector('#question-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = {
            question: modalEl.querySelector('#question-text').value.trim(),
            answers: modalEl
              .querySelector('#question-answers')
              .value.split(',')
              .map((a) => a.trim())
              .filter(Boolean),
            category: modalEl.querySelector('#question-category').value.trim() || null,
            difficulty: modalEl.querySelector('#question-difficulty').value.trim() || null,
          };
          try {
            questionsCache = existing ? await api.quiz.updateQuestion(existing.id, payload) : await api.quiz.createQuestion(payload);
            close();
            ctx.rerender();
            showToast('Quizfrage gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderArcade(container, ctx) {
  ensureSocket(ctx);
  if (!questionsCache && !loadingQuestions) loadQuestions(ctx);

  container.innerHTML = `
    <h1 class="view-title">Arcade</h1>
    ${whoAmICardHtml('whoami')}
    <div class="section-title">⚡ Gaming-Quiz</div>
    <div class="card stack">
      <div class="row-between" style="gap:10px;">
        <div>
          <strong>1v1 Quiz-Lobby</strong>
          <div class="muted" style="font-size:0.8rem;">First to 3, Antwortprüfung läuft serverseitig.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="quiz-create-lobby">Lobby öffnen</button>
      </div>
      ${renderLobbyList()}
    </div>
    ${renderMatch()}
    <div class="row-between" style="margin-top:18px;">
      <div class="section-title" style="margin:0;">🧠 Fragenkatalog</div>
      <button type="button" class="btn btn-sm" id="quiz-new-question">+ Frage</button>
    </div>
    <div class="card">${loadingQuestions && !questionsCache ? '<div class="empty-state">Lädt…</div>' : questionRows()}</div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);

  container.querySelector('#quiz-create-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const res = await emitWithAck('arcade:lobby:create', { gameType: 'quiz', playerId });
    if (!res?.ok) return showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
    showToast('Quiz-Lobby geöffnet.');
  });

  container.querySelectorAll('[data-join-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      const res = await emitWithAck('arcade:lobby:join', { lobbyId: btn.dataset.joinLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
    });
  });

  container.querySelector('#quiz-answer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const playerId = getMyId();
    const text = container.querySelector('#quiz-answer').value.trim();
    if (!playerId || !match?.matchId || !text) return;
    const res = await emitWithAck('arcade:quiz:answer', { matchId: match.matchId, playerId, text });
    if (res?.ok && res.correct === false) showToast('Noch nicht richtig.');
    if (!res?.ok) showToast(res?.error || 'Antwort nicht angenommen.', { error: true });
    container.querySelector('#quiz-answer').value = '';
  });

  container.querySelector('#quiz-new-question')?.addEventListener('click', () => openQuestionForm(ctx));
  container.querySelectorAll('[data-edit-question]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const question = questionsCache.questions.find((q) => q.id === btn.dataset.editQuestion);
      if (question) openQuestionForm(ctx, question);
    });
  });
}
