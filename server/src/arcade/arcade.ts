import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { notifyPlayers } from '../push';
import { matchesAnswer, pickQuestion } from './quizLogic';
import { isLobbyReady, setLobbyReady } from './lobbyReady';

const DEFAULT_TARGET_SCORE = 5;
const QUESTION_MS = 20_000;
const COUNTDOWN_MS = 3000; // "3, 2, 1" intro before the first question

interface PlayerRef {
  id: string;
  name: string;
}

interface Lobby {
  id: string;
  gameType: 'quiz';
  host: PlayerRef;
  players: PlayerRef[];
  socketIds: Map<string, string>;
  ready: Set<string>;
  createdAt: number;
}

interface QuizQuestion {
  id: string;
  question: string;
  answers: string;
  category: string | null;
  difficulty: string | null;
}

interface MatchState {
  id: string;
  room: string;
  host: PlayerRef;
  players: PlayerRef[];
  socketIds: Map<string, string>;
  scores: Map<string, number>;
  targetScore: number;
  currentQuestion: QuizQuestion | null;
  questionTimer: NodeJS.Timeout | null;
  questionExpiresAt: number | null;
  questionRemainingMs: number | null;
  paused: boolean;
  answered: boolean;
  startedAt: number;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, MatchState>();

function playerById(playerId: unknown): PlayerRef | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  const row = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as PlayerRef | undefined;
  return row ?? null;
}

function targetScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 100 ? value : null;
}

function publicLobbies() {
  return [...lobbies.values()].map((l) => ({
    id: l.id,
    gameType: l.gameType,
    host: l.host,
    players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })),
    createdAt: l.createdAt,
  }));
}

function emitLobbies(io: Server) {
  io.emit('arcade:lobbies', { lobbies: publicLobbies() });
}

// Open-lobby summary for GET /api/arcade/lobbies (the Home view's "Aktuell"
// card) — just enough to say "a lobby is waiting", less detail than the
// socket payload the Arcade view itself uses.
export function openLobbySummaries() {
  return [...lobbies.values()].map((l) => ({
    id: l.id,
    hostName: l.host.name,
    playerCount: l.players.length,
    createdAt: l.createdAt,
  }));
}

function scorePayload(match: MatchState) {
  return match.players.map((p) => ({ playerId: p.id, name: p.name, score: match.scores.get(p.id) ?? 0 }));
}

function loadQuestionFor(match: MatchState): QuizQuestion | null {
  const questions = db
    .prepare('SELECT id, question, answers, category, difficulty FROM quiz_questions ORDER BY created_at')
    .all() as QuizQuestion[];
  const seenRows = db
    .prepare(
      `SELECT question_id
       FROM quiz_seen
       WHERE player_id IN (${match.players.map(() => '?').join(',')})
       GROUP BY question_id
       HAVING COUNT(DISTINCT player_id) = ?`
    )
    .all(...match.players.map((p) => p.id), match.players.length) as Array<{ question_id: string }>;
  const id = pickQuestion(
    questions.map((q) => q.id),
    new Set(seenRows.map((r) => r.question_id))
  );
  return id ? questions.find((q) => q.id === id) ?? null : null;
}

function clearQuestionTimer(match: MatchState) {
  if (match.questionTimer) clearTimeout(match.questionTimer);
  match.questionTimer = null;
  match.questionExpiresAt = null;
}

function firstAcceptedAnswer(question: QuizQuestion): string {
  return (JSON.parse(question.answers) as string[])[0];
}

function markSeen(match: MatchState, winnerId: string | null) {
  if (!match.currentQuestion) return;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO quiz_seen (question_id, player_id, seen_at, was_correct)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(question_id, player_id) DO UPDATE SET seen_at = excluded.seen_at, was_correct = excluded.was_correct`
  );
  for (const p of match.players) {
    stmt.run(match.currentQuestion.id, p.id, now, winnerId === null ? null : winnerId === p.id ? 1 : 0);
  }
}

function finishMatch(io: Server, match: MatchState, winner: PlayerRef | null, reason = 'completed') {
  clearQuestionTimer(match);
  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(),
    'quiz',
    winner?.id ?? null,
    JSON.stringify(match.players),
    JSON.stringify(scorePayload(match)),
    reason,
    match.startedAt,
    Date.now()
  );
  io.to(match.room).emit('arcade:match:end', { matchId: match.id, winner, reason, scores: scorePayload(match) });
  matches.delete(match.id);
}

function scheduleQuestionTimeout(io: Server, match: MatchState, delayMs: number) {
  match.questionTimer = setTimeout(() => {
    if (!matches.has(match.id) || match.answered || match.paused || !match.currentQuestion) return;
    match.answered = true;
    markSeen(match, null);
    io.to(match.room).emit('arcade:quiz:timeout', {
      matchId: match.id,
      correctAnswer: firstAcceptedAnswer(match.currentQuestion),
      scores: scorePayload(match),
    });
    setTimeout(() => {
      if (matches.has(match.id)) sendQuestion(io, match);
    }, 1400);
  }, delayMs);
}

function sendQuestion(io: Server, match: MatchState) {
  clearQuestionTimer(match);
  const question = loadQuestionFor(match);
  match.currentQuestion = question;
  match.answered = false;
  match.paused = false;
  match.questionRemainingMs = null;
  if (!question) return finishMatch(io, match, null, 'no-questions');

  const startedAt = Date.now();
  match.questionExpiresAt = startedAt + QUESTION_MS;
  io.to(match.room).emit('arcade:quiz:question', {
    matchId: match.id,
    questionId: question.id,
    question: question.question,
    category: question.category,
    difficulty: question.difficulty,
    scores: scorePayload(match),
    targetScore: match.targetScore,
    startedAt,
    expiresAt: match.questionExpiresAt,
  });

  scheduleQuestionTimeout(io, match, QUESTION_MS);
}

function removeFromOpenLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const player = [...lobby.socketIds.entries()].find(([, value]) => value === socketId);
    if (!player) continue;
    if (lobby.host.id === player[0]) {
      lobbies.delete(id);
    } else {
      lobby.socketIds.delete(player[0]);
      lobby.ready.delete(player[0]);
      lobby.players = lobby.players.filter((p) => p.id !== player[0]);
    }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

export function registerArcadeSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('arcade:lobbies', { lobbies: publicLobbies() });

    socket.on('arcade:lobbies:get', () => {
      socket.emit('arcade:lobbies', { lobbies: publicLobbies() });
    });

    socket.on('arcade:lobby:create', (payload: { gameType?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player || payload?.gameType !== 'quiz') return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });

      removeFromOpenLobbies(io, socket.id);
      const lobby: Lobby = {
        id: nanoid(),
        gameType: 'quiz',
        host: player,
        players: [player],
        socketIds: new Map([[player.id, socket.id]]),
        ready: new Set(),
        createdAt: Date.now(),
      };
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });

      // Nobody has the Arcade view open to see the toast-on-connect above,
      // so a real push is the only way the rest of the LAN finds out a lobby
      // is waiting for them.
      const otherPlayerIds = (db.prepare('SELECT id FROM players WHERE id != ?').all(player.id) as Array<{ id: string }>).map(
        (p) => p.id
      );
      notifyPlayers(otherPlayerIds, {
        title: '🕹️ Neue Quiz-Lobby',
        body: `${player.name} hat eine Quiz-Lobby geöffnet – jetzt beitreten!`,
        url: '/#arcade',
      });
    });

    socket.on('arcade:lobby:close', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (payload?.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann die Lobby schließen.' });

      lobbies.delete(lobby.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('arcade:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });

      removeFromOpenLobbies(io, socket.id);
      if (!lobby.players.some((p) => p.id === player.id)) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('arcade:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('arcade:lobby:start', (payload: { lobbyId?: string; playerId?: string; targetScore?: number }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const score = targetScore(payload?.targetScore) ?? DEFAULT_TARGET_SCORE;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (payload?.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.players.length < 2) return ack?.({ ok: false, error: 'Mindestens zwei Spieler werden gebraucht.' });

      const room = `arcade:${nanoid()}`;
      for (const socketId of lobby.socketIds.values()) {
        io.sockets.sockets.get(socketId)?.join(room);
      }
      const match: MatchState = {
        id: nanoid(),
        room,
        host: lobby.host,
        players: lobby.players,
        socketIds: new Map(lobby.socketIds),
        scores: new Map(lobby.players.map((p) => [p.id, 0])),
        targetScore: score,
        currentQuestion: null,
        questionTimer: null,
        questionExpiresAt: null,
        questionRemainingMs: null,
        paused: false,
        answered: false,
        startedAt: Date.now(),
      };
      matches.set(match.id, match);
      lobbies.delete(lobby.id);
      emitLobbies(io);
      const beginsAt = Date.now() + COUNTDOWN_MS;
      io.to(room).emit('arcade:match:start', {
        matchId: match.id,
        gameType: 'quiz',
        host: match.host,
        players: match.players,
        targetScore: score,
        beginsAt,
      });
      ack?.({ ok: true, matchId: match.id });
      // Hold the first question until the shared 3-2-1 countdown finishes.
      setTimeout(() => {
        if (matches.get(match.id) === match) sendQuestion(io, match);
      }, COUNTDOWN_MS);
    });

    socket.on('arcade:quiz:answer', (payload: { matchId?: string; playerId?: string; text?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      const player = match?.players.find((p) => p.id === payload?.playerId);
      if (!match || !player || !match.currentQuestion || match.answered || match.paused || typeof payload?.text !== 'string') {
        return ack?.({ ok: false, error: 'Antwort nicht angenommen.' });
      }
      const accepted = JSON.parse(match.currentQuestion.answers) as string[];
      if (!matchesAnswer(payload.text, accepted)) return ack?.({ ok: true, correct: false });

      clearQuestionTimer(match);
      match.answered = true;
      match.scores.set(player.id, (match.scores.get(player.id) ?? 0) + 1);
      markSeen(match, player.id);
      const scores = scorePayload(match);
      io.to(match.room).emit('arcade:quiz:result', {
        matchId: match.id,
        winner: player,
        correctAnswer: accepted[0],
        scores,
      });

      if ((match.scores.get(player.id) ?? 0) >= match.targetScore) {
        finishMatch(io, match, player);
      } else {
        setTimeout(() => {
          if (matches.has(match.id)) sendQuestion(io, match);
        }, 1400);
      }
      ack?.({ ok: true, correct: true });
    });

    socket.on('arcade:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      if (!match.currentQuestion || match.answered || match.paused) return ack?.({ ok: true });

      match.questionRemainingMs = Math.max(1, (match.questionExpiresAt ?? Date.now()) - Date.now());
      if (match.questionTimer) clearTimeout(match.questionTimer);
      match.questionTimer = null;
      match.questionExpiresAt = null;
      match.paused = true;
      io.to(match.room).emit('arcade:match:paused', {
        matchId: match.id,
        scores: scorePayload(match),
        remainingMs: match.questionRemainingMs,
      });
      ack?.({ ok: true });
    });

    socket.on('arcade:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      if (!match.currentQuestion || match.answered || !match.paused) return ack?.({ ok: true });

      const remainingMs = match.questionRemainingMs ?? QUESTION_MS;
      match.questionExpiresAt = Date.now() + remainingMs;
      match.questionRemainingMs = null;
      match.paused = false;
      scheduleQuestionTimeout(io, match, remainingMs);
      io.to(match.room).emit('arcade:match:resumed', {
        matchId: match.id,
        scores: scorePayload(match),
        expiresAt: match.questionExpiresAt,
      });
      ack?.({ ok: true });
    });

    socket.on('arcade:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finishMatch(io, match, null, 'ended-by-host');
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      removeFromOpenLobbies(io, socket.id);
      for (const [id, match] of matches) {
        const player = [...match.socketIds.entries()].find(([, socketId]) => socketId === socket.id);
        if (!player) continue;
        io.to(match.room).emit('arcade:match:opponent-left', { matchId: id, playerId: player[0] });
        finishMatch(io, match, null, 'player-left');
      }
    });
  });
}
