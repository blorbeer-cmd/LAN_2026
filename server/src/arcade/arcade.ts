import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { matchesAnswer, pickQuestion } from './quizLogic';

const TARGET_SCORE = 3;

interface PlayerRef {
  id: string;
  name: string;
}

interface Lobby {
  id: string;
  gameType: 'quiz';
  host: PlayerRef;
  hostSocketId: string;
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
  players: [PlayerRef, PlayerRef];
  socketIds: Map<string, string>;
  scores: Map<string, number>;
  currentQuestion: QuizQuestion | null;
  answered: boolean;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, MatchState>();

function playerById(playerId: unknown): PlayerRef | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  const row = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as PlayerRef | undefined;
  return row ?? null;
}

function publicLobbies() {
  return [...lobbies.values()].map((l) => ({
    id: l.id,
    gameType: l.gameType,
    host: l.host,
    createdAt: l.createdAt,
  }));
}

function emitLobbies(io: Server) {
  io.emit('arcade:lobbies', { lobbies: publicLobbies() });
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
       WHERE player_id IN (?, ?)
       GROUP BY question_id
       HAVING COUNT(DISTINCT player_id) = 2`
    )
    .all(match.players[0].id, match.players[1].id) as Array<{ question_id: string }>;
  const id = pickQuestion(
    questions.map((q) => q.id),
    new Set(seenRows.map((r) => r.question_id))
  );
  return id ? questions.find((q) => q.id === id) ?? null : null;
}

function sendQuestion(io: Server, match: MatchState) {
  const question = loadQuestionFor(match);
  match.currentQuestion = question;
  match.answered = false;
  if (!question) {
    io.to(match.room).emit('arcade:match:end', { matchId: match.id, reason: 'no-questions', scores: scorePayload(match) });
    matches.delete(match.id);
    return;
  }
  io.to(match.room).emit('arcade:quiz:question', {
    matchId: match.id,
    questionId: question.id,
    question: question.question,
    category: question.category,
    difficulty: question.difficulty,
    scores: scorePayload(match),
    targetScore: TARGET_SCORE,
  });
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

export function registerArcadeSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('arcade:lobbies', { lobbies: publicLobbies() });

    socket.on('arcade:lobbies:get', () => {
      socket.emit('arcade:lobbies', { lobbies: publicLobbies() });
    });

    socket.on('arcade:lobby:create', (payload: { gameType?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player || payload?.gameType !== 'quiz') return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });

      for (const [id, lobby] of lobbies) {
        if (lobby.hostSocketId === socket.id || lobby.host.id === player.id) lobbies.delete(id);
      }
      const lobby: Lobby = { id: nanoid(), gameType: 'quiz', host: player, hostSocketId: socket.id, createdAt: Date.now() };
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('arcade:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const guest = playerById(payload?.playerId);
      if (!lobby || !guest) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (guest.id === lobby.host.id) return ack?.({ ok: false, error: 'Du bist schon Host dieser Lobby.' });

      const hostSocket = io.sockets.sockets.get(lobby.hostSocketId);
      if (!hostSocket) {
        lobbies.delete(lobby.id);
        emitLobbies(io);
        return ack?.({ ok: false, error: 'Host ist nicht mehr verbunden.' });
      }

      const match: MatchState = {
        id: nanoid(),
        room: `arcade:${nanoid()}`,
        players: [lobby.host, guest],
        socketIds: new Map([
          [lobby.host.id, lobby.hostSocketId],
          [guest.id, socket.id],
        ]),
        scores: new Map([
          [lobby.host.id, 0],
          [guest.id, 0],
        ]),
        currentQuestion: null,
        answered: false,
      };
      matches.set(match.id, match);
      lobbies.delete(lobby.id);
      hostSocket.join(match.room);
      socket.join(match.room);
      emitLobbies(io);
      io.to(match.room).emit('arcade:match:start', { matchId: match.id, gameType: 'quiz', players: match.players, targetScore: TARGET_SCORE });
      ack?.({ ok: true, matchId: match.id });
      sendQuestion(io, match);
    });

    socket.on('arcade:quiz:answer', (payload: { matchId?: string; playerId?: string; text?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      const player = match?.players.find((p) => p.id === payload?.playerId);
      if (!match || !player || !match.currentQuestion || match.answered || typeof payload?.text !== 'string') {
        return ack?.({ ok: false, error: 'Antwort nicht angenommen.' });
      }
      const accepted = JSON.parse(match.currentQuestion.answers) as string[];
      if (!matchesAnswer(payload.text, accepted)) return ack?.({ ok: true, correct: false });

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

      if ((match.scores.get(player.id) ?? 0) >= TARGET_SCORE) {
        io.to(match.room).emit('arcade:match:end', { matchId: match.id, winner: player, scores });
        matches.delete(match.id);
      } else {
        setTimeout(() => {
          if (matches.has(match.id)) sendQuestion(io, match);
        }, 1800);
      }
      ack?.({ ok: true, correct: true });
    });

    socket.on('disconnect', () => {
      let changed = false;
      for (const [id, lobby] of lobbies) {
        if (lobby.hostSocketId === socket.id) {
          lobbies.delete(id);
          changed = true;
        }
      }
      if (changed) emitLobbies(io);

      for (const [id, match] of matches) {
        const player = [...match.socketIds.entries()].find(([, socketId]) => socketId === socket.id);
        if (!player) continue;
        io.to(match.room).emit('arcade:match:opponent-left', { matchId: id, playerId: player[0] });
        matches.delete(id);
      }
    });
  });
}
