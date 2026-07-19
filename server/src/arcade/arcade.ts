import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import { notifyPlayers, resolvePushTopic } from '../push';
import { matchesAnswer, pickQuestion } from './quizLogic';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { broadcastArcadeKiosk } from '../realtime';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { shouldSendLobbyPush } from './lobbyPush';
import { currentArcadeDataScope, recordArcadeResult } from './arcadeData';
import { canJoinLobby, lobbyGroupId, playerGroupId, socketGroupId } from './scope';

const DEFAULT_TARGET_SCORE = 5;
const QUESTION_MS = 20_000;
const COUNTDOWN_MS = 3000; // "3, 2, 1" intro before the first question
const QUIZ_BOT = { id: 'quiz-bot', name: 'Quiz-Bot' };

function quizLobbyPushKey(lobbyId: string): string {
  return `arcade-lobby:quiz:${lobbyId}`;
}

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
  botTimer: NodeJS.Timeout | null;
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

function publicLobbies(groupId?: string | null) {
  return [...lobbies.values()].filter((l) => !groupId || lobbyGroupId(l) === groupId).map((l) => ({
    id: l.id,
    gameType: l.gameType,
    host: l.host,
    players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })),
    createdAt: l.createdAt,
  }));
}

function emitLobbies(io: Server) {
  for (const socket of io.sockets.sockets.values()) socket.emit('arcade:lobbies', { lobbies: publicLobbies(socketGroupId(socket)) });
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

function realPlayerIds(players: PlayerRef[]): string[] {
  return players.filter((p) => p.id !== QUIZ_BOT.id).map((p) => p.id);
}

function loadQuestionFor(match: MatchState): QuizQuestion | null {
  const scope = currentArcadeDataScope(realPlayerIds(match.players));
  if (!scope) return null;
  const questions = db
    .prepare('SELECT id, question, answers, category, difficulty FROM quiz_questions WHERE group_id = ? ORDER BY created_at')
    .all(scope.groupId) as QuizQuestion[];
  const seenRows = db
    .prepare(
      `SELECT question_id
       FROM quiz_seen
       WHERE group_id = ? AND event_id IS ? AND player_id IN (${match.players.map(() => '?').join(',')})
       GROUP BY question_id
       HAVING COUNT(DISTINCT player_id) = ?`
    )
    .all(scope.groupId, scope.eventId, ...match.players.map((p) => p.id), match.players.length) as Array<{ question_id: string }>;
  const id = pickQuestion(
    questions.map((q) => q.id),
    new Set(seenRows.map((r) => r.question_id))
  );
  return id ? questions.find((q) => q.id === id) ?? null : null;
}

function clearQuestionTimer(match: MatchState) {
  if (match.questionTimer) clearTimeout(match.questionTimer);
  if (match.botTimer) clearTimeout(match.botTimer);
  match.questionTimer = null;
  match.botTimer = null;
  match.questionExpiresAt = null;
}

function firstAcceptedAnswer(question: QuizQuestion): string {
  return (JSON.parse(question.answers) as string[])[0];
}

function markSeen(match: MatchState, winnerId: string | null) {
  if (!match.currentQuestion) return;
  const players = realPlayerIds(match.players);
  const scope = currentArcadeDataScope(players);
  if (!scope) return;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO quiz_seen
       (question_id, player_id, seen_at, was_correct, group_id, event_id, player_name_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(question_id, player_id) DO UPDATE SET
       seen_at = excluded.seen_at, was_correct = excluded.was_correct,
       group_id = excluded.group_id, event_id = excluded.event_id,
       player_name_snapshot = excluded.player_name_snapshot`
  );
  for (const p of match.players.filter((player) => player.id !== QUIZ_BOT.id)) {
    stmt.run(
      match.currentQuestion.id,
      p.id,
      now,
      winnerId === null ? null : winnerId === p.id ? 1 : 0,
      scope.groupId,
      scope.eventId,
      p.name,
    );
  }
}

function finishMatch(io: Server, match: MatchState, winner: PlayerRef | null, reason = 'completed') {
  clearQuestionTimer(match);
  endArcadeSession(realPlayerIds(match.players), 'quiz');
  recordArcadeResult({
    gameType: 'quiz',
    winnerId: winner?.id === QUIZ_BOT.id ? null : winner?.id ?? null,
    players: match.players,
    scores: scorePayload(match),
    reason,
    startedAt: match.startedAt,
  });
  io.to(match.room).emit('arcade:match:end', { matchId: match.id, winner, reason, scores: scorePayload(match) });
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id });
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
    broadcastArcadeKiosk(io, { gameType: 'quiz', matchId: match.id, phase: 'result', scores: scorePayload(match), paused: false });
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
  broadcastArcadeKiosk(io, { gameType: 'quiz', matchId: match.id, phase: 'playing', category: question.category, scores: scorePayload(match), startedAt, expiresAt: match.questionExpiresAt });

  scheduleQuestionTimeout(io, match, QUESTION_MS);
  const bot = match.players.find((player) => player.id === QUIZ_BOT.id);
  if (bot) {
    match.botTimer = setTimeout(() => {
      if (!matches.has(match.id) || match.answered || match.paused || !match.currentQuestion) return;
      answerCorrect(io, match, bot);
    }, 3500 + Math.floor(Math.random() * 2500));
  }
}

function answerCorrect(io: Server, match: MatchState, player: PlayerRef) {
  if (!match.currentQuestion || match.answered) return;
  const accepted = JSON.parse(match.currentQuestion.answers) as string[];
  clearQuestionTimer(match);
  match.answered = true;
  match.scores.set(player.id, (match.scores.get(player.id) ?? 0) + 1);
  markSeen(match, player.id);
  const scores = scorePayload(match);
  io.to(match.room).emit('arcade:quiz:result', { matchId: match.id, winner: player, correctAnswer: accepted[0], scores });
  broadcastArcadeKiosk(io, { gameType: 'quiz', matchId: match.id, phase: 'result', scores, paused: false });
  if ((match.scores.get(player.id) ?? 0) >= match.targetScore) finishMatch(io, match, player);
  else setTimeout(() => { if (matches.has(match.id)) sendQuestion(io, match); }, 1400);
}

function removeFromOpenLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const player = [...lobby.socketIds.entries()].find(([, value]) => value === socketId);
    if (!player) continue;
    if (lobby.host.id === player[0]) {
      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'quiz', id);
      lobbies.delete(id);
      resolvePushTopic(quizLobbyPushKey(id));
    } else {
      releaseLobbyMembership(player[0], 'quiz', id);
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
    socket.emit('arcade:lobbies', { lobbies: publicLobbies(socketGroupId(socket)) });

    socket.on('arcade:lobbies:get', () => {
      socket.emit('arcade:lobbies', { lobbies: publicLobbies(socketGroupId(socket)) });
    });

    socket.on('arcade:lobby:create', (payload: { gameType?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player || payload?.gameType !== 'quiz') return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      if (socketGroupId(socket) && socketGroupId(socket) !== playerGroupId(player.id)) return ack?.({ ok: false, error: 'Gruppenzugriff verweigert.' });

      const lobby: Lobby = {
        id: nanoid(),
        gameType: 'quiz',
        host: player,
        players: [player],
        socketIds: new Map([[player.id, socket.id]]),
        ready: new Set(),
        createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'quiz', lobby.id)) {
        return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      }
      removeFromOpenLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });

      // Nobody has the Arcade view open to see the toast-on-connect above,
      // so a real push is the only way the rest of the LAN finds out a lobby
      // is waiting for them. Throttled per game type (see lobbyPush.ts) so
      // rapid re-creation cannot spam every phone on the LAN.
      if (shouldSendLobbyPush('quiz')) {
        const otherPlayerIds = (db.prepare('SELECT id FROM players WHERE id != ?').all(player.id) as Array<{ id: string }>).map(
          (p) => p.id
        );
        notifyPlayers(
          otherPlayerIds,
          {
            title: 'Neue Quiz-Lobby',
            body: `${player.name} hat eine Quiz-Lobby geöffnet – jetzt beitreten!`,
            url: '/#arcade',
          },
          'all',
          { key: quizLobbyPushKey(lobby.id) }
        );
      }
    });

    socket.on('arcade:lobby:bot', (payload: { playerId?: string }, ack?: (res: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      if (socketGroupId(socket) && socketGroupId(socket) !== playerGroupId(player.id)) return ack?.({ ok: false, error: 'Gruppenzugriff verweigert.' });
      const lobby: Lobby = { id: nanoid(), gameType: 'quiz', host: player, players: [player, QUIZ_BOT], socketIds: new Map([[player.id, socket.id]]), ready: new Set([QUIZ_BOT.id]), createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'quiz', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('arcade:lobby:close', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (payload?.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann die Lobby schließen.' });

      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'quiz', lobby.id);
      lobbies.delete(lobby.id);
      resolvePushTopic(quizLobbyPushKey(lobby.id));
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('arcade:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobby gehört zu einer anderen Gruppe.' });

      if (!claimLobbyMembership(player.id, 'quiz', lobby.id)) {
        return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      }
      removeFromOpenLobbies(io, socket.id);
      if (!lobby.players.some((p) => p.id === player.id)) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('arcade:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || typeof payload?.playerId !== 'string') return ack?.({ ok: true });
      if (lobby.host.id === payload.playerId) {
        releaseLobbyMemberships(lobby.players.map((p) => p.id), 'quiz', lobby.id);
        lobbies.delete(lobby.id);
        resolvePushTopic(quizLobbyPushKey(lobby.id));
      } else {
        releaseLobbyMembership(payload.playerId, 'quiz', lobby.id);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
        lobby.players = lobby.players.filter((p) => p.id !== payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
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
        botTimer: null,
        questionExpiresAt: null,
        questionRemainingMs: null,
        paused: false,
        answered: false,
        startedAt: Date.now(),
      };
      matches.set(match.id, match);
      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'quiz', lobby.id);
      lobbies.delete(lobby.id);
      resolvePushTopic(quizLobbyPushKey(lobby.id));
      emitLobbies(io);
      startArcadeSession(realPlayerIds(match.players), 'quiz');
      const beginsAt = Date.now() + COUNTDOWN_MS;
      io.to(room).emit('arcade:match:start', {
        matchId: match.id,
        gameType: 'quiz',
        host: match.host,
        players: match.players,
        targetScore: score,
        beginsAt,
      });
      broadcastArcadeKiosk(io, { gameType: 'quiz', matchId: match.id, phase: 'countdown', players: match.players, scores: scorePayload(match) });
      ack?.({ ok: true, matchId: match.id });
      // Hold the first question until the shared 3-2-1 countdown finishes.
      setTimeout(() => {
        if (matches.get(match.id) === match) sendQuestion(io, match);
      }, COUNTDOWN_MS);
    });

    socket.on('arcade:quiz:answer', (payload: { matchId?: string; playerId?: string; text?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      const player = match?.players.find((p) => p.id === payload?.playerId);
      if (!match || !player || player.id === QUIZ_BOT.id || !match.currentQuestion || match.answered || match.paused || typeof payload?.text !== 'string') {
        return ack?.({ ok: false, error: 'Antwort nicht angenommen.' });
      }
      const accepted = JSON.parse(match.currentQuestion.answers) as string[];
      if (!matchesAnswer(payload.text, accepted)) return ack?.({ ok: true, correct: false });

      answerCorrect(io, match, player);
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
      broadcastArcadeKiosk(io, { gameType: 'quiz', matchId: match.id, phase: 'playing', paused: true, scores: scorePayload(match), remainingMs: match.questionRemainingMs });
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
      broadcastArcadeKiosk(io, { gameType: 'quiz', matchId: match.id, phase: 'playing', paused: false, scores: scorePayload(match), expiresAt: match.questionExpiresAt });
      ack?.({ ok: true });
    });

    socket.on('arcade:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finishMatch(io, match, null, 'ended-by-host');
      ack?.({ ok: true });
    });

    // Lets a non-host participant end a running match themselves instead of
    // relying on the host (who might be AFK) or a raw disconnect — same
    // outcome as a disconnect mid-match.
    socket.on('arcade:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const leaver = match.players.find((p) => p.id === payload?.playerId);
      if (!leaver) return ack?.({ ok: false, error: 'Du bist kein Teilnehmer dieses Matches.' });
      // socket.to (not io.to): the leaver's own socket is still joined to
      // match.room at this point (unlike a real disconnect), so io.to would
      // also show them their own "opponent left" toast.
      socket.to(match.room).emit('arcade:match:opponent-left', { matchId: match.id, playerId: leaver.id });
      finishMatch(io, match, null, 'player-left');
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
