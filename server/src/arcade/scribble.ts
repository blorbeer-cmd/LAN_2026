// Scribble (skribbl.io-style draw & guess) — server-authoritative realtime
// game over Socket.IO. Kept fully separate from arcade.ts (the quiz) and
// tetris.ts, each with its own `scribble:*` event namespace and lobby list —
// the only thing all three share is the arcade_results table, so completed
// Scribble matches show up automatically in the Arcade stats alongside quiz
// and Tetris.
//
// State machine per turn: word choice -> drawing (with hints ticking in and
// a countdown before the first turn) -> reveal -> next turn, rotating who
// draws. See scribbleLogic.ts for the pure rules this leans on (scoring,
// hint timing, word choice, drawer rotation).

import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import { notifyPlayers } from '../push';
import { matchesAnswer } from './quizLogic';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { broadcastArcadeKiosk } from '../realtime';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import {
  buildHintSchedule,
  HintStep,
  isCloseGuess,
  isMatchComplete,
  nextDrawerIndex,
  pickWordChoices,
  pointsForDrawer,
  pointsForGuess,
  wordMask,
} from './scribbleLogic';

const CHOICE_MS = 15_000;
const REVEAL_MS = 3_000;
const COUNTDOWN_MS = 3000; // "3, 2, 1" before the first turn's word choice
const DEFAULT_ROUNDS = 2;
const DEFAULT_TURN_MS = 60_000;
const MIN_TURN_MS = 20_000;
const MAX_TURN_MS = 120_000;
const MAX_STROKE_BATCHES = 4000; // guards memory if a client sends nonstop for a whole turn
const BOT_ID = 'scribble-bot';
const BOT = { id: BOT_ID, name: 'Scribble-Bot' };

interface PlayerRef {
  id: string;
  name: string;
}

interface ScribbleLobby {
  id: string;
  host: PlayerRef;
  players: PlayerRef[];
  socketIds: Map<string, string>;
  ready: Set<string>;
  createdAt: number;
}

interface WordRow {
  id: string;
  word: string;
  difficulty: string | null;
}

export interface StrokeBatch {
  type: 'stroke';
  strokeId: string;
  color: string;
  size: number;
  erase: boolean;
  points: number[][];
}

// A paint-bucket fill: unlike a stroke, this is a single atomic action (one
// click, not a drag split into batches), replayed by flood-filling from
// (x, y) on each client's own canvas rather than by transmitting pixels —
// see arcadeScribble.js's floodFill, which every client runs independently
// against whatever it has locally rendered so far.
export interface FillOp {
  type: 'fill';
  strokeId: string;
  x: number;
  y: number;
  color: string;
}

export type DrawOp = StrokeBatch | FillOp;

interface ScribbleMatchState {
  id: string;
  room: string;
  host: PlayerRef;
  players: PlayerRef[]; // fixed roster, draw order = lobby join order
  socketIds: Map<string, string>;
  online: Set<string>;
  scores: Map<string, number>;
  rounds: number;
  turnDurationMs: number;
  turnsPlayed: number;
  drawIndex: number;
  phase: 'choosing' | 'drawing' | 'reveal';
  currentWord: string | null;
  currentWordId: string | null;
  wordOptions: WordRow[] | null;
  guessedPlayerIds: Set<string>;
  revealedIndices: Set<number>;
  pendingHints: HintStep[];
  strokes: DrawOp[];
  choiceTimer: NodeJS.Timeout | null;
  choiceExpiresAt: number | null;
  turnTimer: NodeJS.Timeout | null;
  turnExpiresAt: number | null;
  turnRemainingMs: number | null;
  pausedElapsedMs: number | null;
  hintTimers: NodeJS.Timeout[];
  nextTurnTimer: NodeJS.Timeout | null;
  startTimer: NodeJS.Timeout | null; // the pre-first-turn "3, 2, 1" delay
  botTimer: NodeJS.Timeout | null;
  paused: boolean;
  startedAt: number;
}

const lobbies = new Map<string, ScribbleLobby>();
const matches = new Map<string, ScribbleMatchState>();

function playerById(playerId: unknown): PlayerRef | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  const row = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as PlayerRef | undefined;
  return row ?? null;
}

function roundsValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 5 ? value : null;
}

function turnDurationValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= MIN_TURN_MS && value <= MAX_TURN_MS ? value : null;
}

function publicLobbies() {
  return [...lobbies.values()].map((l) => ({
    id: l.id,
    host: l.host,
    players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })),
    createdAt: l.createdAt,
  }));
}

function emitLobbies(io: Server) {
  io.emit('scribble:lobbies', { lobbies: publicLobbies() });
}

// Open-lobby summary for GET /api/arcade/lobbies — see arcade.ts.
export function openLobbySummaries() {
  return [...lobbies.values()].map((l) => ({
    id: l.id,
    hostName: l.host.name,
    playerCount: l.players.length,
    createdAt: l.createdAt,
  }));
}

function removeFromOpenLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const entry = [...lobby.socketIds.entries()].find(([, sid]) => sid === socketId);
    if (!entry) continue;
    if (lobby.host.id === entry[0]) {
      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'scribble', id);
      lobbies.delete(id);
    } else {
      releaseLobbyMembership(entry[0], 'scribble', id);
      lobby.socketIds.delete(entry[0]);
      lobby.ready.delete(entry[0]);
      lobby.players = lobby.players.filter((p) => p.id !== entry[0]);
    }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

function scorePayload(match: ScribbleMatchState) {
  return match.players.map((p) => ({ playerId: p.id, name: p.name, score: match.scores.get(p.id) ?? 0 }));
}

// Kiosk projection: intentionally contains only the drawing surface. Never
// add currentWord, mask, wordOptions, hints, chat or guesses here.
function kioskSnapshot(io: Server, match: ScribbleMatchState): void {
  broadcastArcadeKiosk(io, {
    gameType: 'scribble',
    matchId: match.id,
    players: match.players,
    drawer: match.phase === 'drawing' ? match.players[match.drawIndex] : null,
    phase: match.phase,
    strokes: match.phase === 'drawing' ? match.strokes : [],
    scores: scorePayload(match),
  });
}

function realPlayerIds(players: PlayerRef[]): string[] {
  return players.filter((p) => p.id !== BOT_ID).map((p) => p.id);
}

function eligibleGuesserIds(match: ScribbleMatchState): string[] {
  const drawerId = match.players[match.drawIndex]?.id;
  return match.players.filter((p) => p.id !== drawerId && match.online.has(p.id)).map((p) => p.id);
}

// Whether every rater currently online has already guessed correctly this
// turn. Deliberately not a size comparison against guessedPlayerIds — that
// set can outlive a guesser who later disconnected, which would otherwise
// make the turn end early while an online player still hasn't had a chance.
function allEligibleGuessed(match: ScribbleMatchState): boolean {
  return eligibleGuesserIds(match).every((id) => match.guessedPlayerIds.has(id));
}

function clearAllTimers(match: ScribbleMatchState): void {
  if (match.choiceTimer) clearTimeout(match.choiceTimer);
  if (match.turnTimer) clearTimeout(match.turnTimer);
  if (match.nextTurnTimer) clearTimeout(match.nextTurnTimer);
  if (match.startTimer) clearTimeout(match.startTimer);
  if (match.botTimer) clearTimeout(match.botTimer);
  match.hintTimers.forEach(clearTimeout);
  match.choiceTimer = null;
  match.turnTimer = null;
  match.nextTurnTimer = null;
  match.startTimer = null;
  match.botTimer = null;
  match.hintTimers = [];
}

function loadWordPool(): WordRow[] {
  return db.prepare('SELECT id, word, difficulty FROM scribble_words ORDER BY created_at').all() as WordRow[];
}

function seenWordIds(playerIds: string[]): Set<string> {
  playerIds = playerIds.filter((id) => id !== BOT_ID);
  if (playerIds.length === 0) return new Set();
  const rows = db
    .prepare(
      `SELECT word_id FROM scribble_seen WHERE player_id IN (${playerIds.map(() => '?').join(',')})
       GROUP BY word_id HAVING COUNT(DISTINCT player_id) = ?`
    )
    .all(...playerIds, playerIds.length) as Array<{ word_id: string }>;
  return new Set(rows.map((r) => r.word_id));
}

function markWordSeen(wordId: string, playerIds: string[]): void {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO scribble_seen (word_id, player_id, seen_at) VALUES (?, ?, ?)
     ON CONFLICT(word_id, player_id) DO UPDATE SET seen_at = excluded.seen_at`
  );
  for (const id of playerIds) if (id !== BOT_ID) stmt.run(wordId, id, now);
}

function finishMatch(io: Server, match: ScribbleMatchState, winner: PlayerRef | null, reason: string): void {
  clearAllTimers(match);
  endArcadeSession(realPlayerIds(match.players), 'scribble');
  const scores = scorePayload(match);
  const bestScore = scores.reduce<(typeof scores)[number] | null>((best, s) => (!best || s.score > best.score ? s : best), null);
  const candidateWinnerId = winner?.id ?? bestScore?.playerId ?? null;
  const winnerId = candidateWinnerId === BOT_ID ? null : candidateWinnerId;
  const resolvedWinner = winnerId ? match.players.find((p) => p.id === winnerId) ?? null : null;
  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), 'scribble', winnerId, JSON.stringify(match.players), JSON.stringify(scores), reason, match.startedAt, Date.now());
  io.to(match.room).emit('scribble:match:end', {
    matchId: match.id,
    winner: resolvedWinner,
    reason,
    scores,
  });
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id });
  matches.delete(match.id);
}

function startTurnTimers(io: Server, match: ScribbleMatchState, remainingMs: number, elapsedMs: number): void {
  match.turnExpiresAt = Date.now() + remainingMs;
  match.turnTimer = setTimeout(() => endTurn(io, match, 'timeout'), remainingMs);
  match.hintTimers = match.pendingHints.map((hint) => {
    const fireIn = Math.max(0, hint.atMs - elapsedMs);
    return setTimeout(() => fireHint(io, match, hint), fireIn);
  });
}

function fireHint(io: Server, match: ScribbleMatchState, hint: HintStep): void {
  if (!matches.has(match.id) || match.phase !== 'drawing') return;
  if (!match.pendingHints.includes(hint)) return;
  match.pendingHints = match.pendingHints.filter((h) => h !== hint);
  match.revealedIndices.add(hint.index);
  io.to(match.room).emit('scribble:hint', {
    matchId: match.id,
    mask: wordMask(match.currentWord ?? '', match.revealedIndices),
  });
}

function startNextTurn(io: Server, match: ScribbleMatchState): void {
  if (isMatchComplete(match.turnsPlayed, match.rounds, match.players.length)) {
    return finishMatch(io, match, null, 'completed');
  }
  const order = match.players.map((p) => p.id);
  let nextIndex = nextDrawerIndex(order, match.drawIndex, match.online);
  // The test bot is a fast rater, not a fake canvas artist. Keep the human
  // as drawer so every bot round stays useful and understandable.
  if (nextIndex !== null && match.players[nextIndex]?.id === BOT_ID) {
    nextIndex = nextDrawerIndex(order, nextIndex, new Set([...match.online].filter((id) => id !== BOT_ID)));
  }
  if (nextIndex === null) return finishMatch(io, match, null, 'player-left');

  match.drawIndex = nextIndex;
  match.phase = 'choosing';
  match.currentWord = null;
  match.currentWordId = null;
  match.guessedPlayerIds = new Set();
  match.revealedIndices = new Set();
  match.pendingHints = [];
  match.strokes = [];

  const pool = loadWordPool();
  const seen = seenWordIds(match.players.map((p) => p.id));
  const optionIds = pickWordChoices(
    pool.map((w) => w.id),
    seen,
    3
  );
  match.wordOptions = optionIds.map((id) => pool.find((w) => w.id === id)!).filter(Boolean);

  if (match.wordOptions.length === 0) return finishMatch(io, match, null, 'no-words');

  const drawer = match.players[match.drawIndex];
  match.choiceExpiresAt = Date.now() + CHOICE_MS;
  match.choiceTimer = setTimeout(() => autoChooseWord(io, match), CHOICE_MS);

  const drawerSocketId = match.socketIds.get(drawer.id);
  if (drawerSocketId) {
    io.to(drawerSocketId).emit('scribble:choose', {
      matchId: match.id,
      options: match.wordOptions.map((w) => ({ id: w.id, word: w.word })),
      expiresAt: match.choiceExpiresAt,
    });
  }

  io.to(match.room).emit('scribble:turn', {
    matchId: match.id,
    phase: 'choosing',
    drawer,
    round: Math.floor(match.turnsPlayed / match.players.length) + 1,
    rounds: match.rounds,
    turnDurationMs: match.turnDurationMs,
    expiresAt: match.choiceExpiresAt,
    scores: scorePayload(match),
  });
  kioskSnapshot(io, match);
}

function autoChooseWord(io: Server, match: ScribbleMatchState): void {
  if (!matches.has(match.id) || match.phase !== 'choosing' || !match.wordOptions?.length) return;
  chooseWord(io, match, match.wordOptions[0].id);
}

function chooseWord(io: Server, match: ScribbleMatchState, wordId: string): void {
  const option = match.wordOptions?.find((w) => w.id === wordId);
  if (!option) return;
  if (match.choiceTimer) clearTimeout(match.choiceTimer);
  match.choiceTimer = null;
  match.choiceExpiresAt = null;
  match.phase = 'drawing';
  match.currentWord = option.word;
  match.currentWordId = option.id;
  match.wordOptions = null;
  match.pendingHints = buildHintSchedule(option.word, match.turnDurationMs);

  const drawer = match.players[match.drawIndex];
  io.to(match.room).emit('scribble:turn', {
    matchId: match.id,
    phase: 'drawing',
    drawer,
    round: Math.floor(match.turnsPlayed / match.players.length) + 1,
    rounds: match.rounds,
    turnDurationMs: match.turnDurationMs,
    mask: wordMask(option.word, match.revealedIndices),
    startedAt: Date.now(),
    expiresAt: Date.now() + match.turnDurationMs,
    scores: scorePayload(match),
  });

  // The room broadcast above only ever carries the masked word (guessers must
  // never see it) — the drawer needs the real text, sent privately so it
  // works the same whether they picked it themselves or it was auto-chosen
  // on a choice timeout.
  const drawerSocketId = match.socketIds.get(drawer.id);
  if (drawerSocketId) {
    io.to(drawerSocketId).emit('scribble:word-chosen', { matchId: match.id, word: option.word });
  }

  startTurnTimers(io, match, match.turnDurationMs, 0);
  if (match.players.some((player) => player.id === BOT_ID)) {
    match.botTimer = setTimeout(() => {
      if (!matches.has(match.id) || match.phase !== 'drawing' || match.paused || !match.currentWord) return;
      const bot = match.players.find((player) => player.id === BOT_ID)!;
      if (match.guessedPlayerIds.has(bot.id)) return;
      const remainingMs = Math.max(0, (match.turnExpiresAt ?? Date.now()) - Date.now());
      const points = pointsForGuess(remainingMs, match.turnDurationMs);
      match.scores.set(bot.id, (match.scores.get(bot.id) ?? 0) + points);
      match.guessedPlayerIds.add(bot.id);
      io.to(match.room).emit('scribble:chat', { matchId: match.id, playerId: bot.id, name: bot.name, correct: true, points });
      io.to(match.room).emit('scribble:scores', { matchId: match.id, scores: scorePayload(match) });
      if (allEligibleGuessed(match)) endTurn(io, match, 'all-guessed');
    }, 4500 + Math.floor(Math.random() * 2500));
  }
}

function endTurn(io: Server, match: ScribbleMatchState, reason: string): void {
  if (match.phase === 'reveal') return;
  clearAllTimers(match);
  match.phase = 'reveal';

  if (match.currentWord && reason !== 'drawer-left') {
    const drawer = match.players[match.drawIndex];
    const eligible = eligibleGuesserIds(match).length;
    const drawerPoints = pointsForDrawer(match.guessedPlayerIds.size, eligible);
    if (drawerPoints > 0) match.scores.set(drawer.id, (match.scores.get(drawer.id) ?? 0) + drawerPoints);
    markWordSeen(
      match.currentWordId!,
      match.players.map((p) => p.id)
    );
  }

  match.turnsPlayed += 1;
  io.to(match.room).emit('scribble:turn-end', {
    matchId: match.id,
    word: match.currentWord,
    reason,
    scores: scorePayload(match),
  });

  match.nextTurnTimer = setTimeout(() => {
    if (matches.has(match.id)) startNextTurn(io, match);
  }, REVEAL_MS);
}

export function registerScribbleSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('scribble:lobbies', { lobbies: publicLobbies() });

    socket.on('scribble:lobbies:get', () => {
      socket.emit('scribble:lobbies', { lobbies: publicLobbies() });
    });

    socket.on('scribble:lobby:create', (payload: { playerId?: string }, ack?: (res: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });

      const lobby: ScribbleLobby = {
        id: nanoid(),
        host: player,
        players: [player],
        socketIds: new Map([[player.id, socket.id]]),
        ready: new Set(),
        createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'scribble', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
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
        title: '✏️ Neue Scribble-Lobby',
        body: `${player.name} hat eine Scribble-Lobby geöffnet – jetzt beitreten!`,
        url: '/#arcade',
      });
    });
    socket.on('scribble:lobby:bot', (payload: { playerId?: string; adminPin?: string }, ack?: (res: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const lobby: ScribbleLobby = { id: nanoid(), host: player, players: [player, BOT], socketIds: new Map([[player.id, socket.id]]), ready: new Set([BOT_ID]), createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'scribble', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('scribble:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });

      if (!claimLobbyMembership(player.id, 'scribble', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
      if (!lobby.players.some((p) => p.id === player.id)) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('scribble:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || typeof payload?.playerId !== 'string') return ack?.({ ok: true });
      if (lobby.host.id === payload.playerId) {
        releaseLobbyMemberships(lobby.players.map((p) => p.id), 'scribble', lobby.id);
        lobbies.delete(lobby.id);
      } else {
        releaseLobbyMembership(payload.playerId, 'scribble', lobby.id);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
        lobby.players = lobby.players.filter((p) => p.id !== payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('scribble:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on(
      'scribble:lobby:start',
      (payload: { lobbyId?: string; playerId?: string; rounds?: number; turnDurationMs?: number }, ack?: (res: unknown) => void) => {
        const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
        if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
        if (payload?.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
        if (lobby.players.length < 2) return ack?.({ ok: false, error: 'Mindestens zwei Spieler werden gebraucht.' });

        const rounds = roundsValue(payload?.rounds) ?? DEFAULT_ROUNDS;
        const turnDurationMs = turnDurationValue(payload?.turnDurationMs) ?? DEFAULT_TURN_MS;
        const room = `scribble:${nanoid()}`;
        for (const socketId of lobby.socketIds.values()) {
          io.sockets.sockets.get(socketId)?.join(room);
        }

        const match: ScribbleMatchState = {
          id: nanoid(),
          room,
          host: lobby.host,
          players: lobby.players,
          socketIds: new Map(lobby.socketIds),
          online: new Set(lobby.players.map((p) => p.id)),
          scores: new Map(lobby.players.map((p) => [p.id, 0])),
          rounds,
          turnDurationMs,
          turnsPlayed: 0,
          drawIndex: -1,
          phase: 'choosing',
          currentWord: null,
          currentWordId: null,
          wordOptions: null,
          guessedPlayerIds: new Set(),
          revealedIndices: new Set(),
          pendingHints: [],
          strokes: [],
          choiceTimer: null,
          choiceExpiresAt: null,
          turnTimer: null,
          turnExpiresAt: null,
          turnRemainingMs: null,
          pausedElapsedMs: null,
          hintTimers: [],
          nextTurnTimer: null,
          startTimer: null,
          botTimer: null,
          paused: false,
          startedAt: Date.now(),
        };
        matches.set(match.id, match);
        releaseLobbyMemberships(lobby.players.map((p) => p.id), 'scribble', lobby.id);
        lobbies.delete(lobby.id);
        emitLobbies(io);
        startArcadeSession(realPlayerIds(match.players), 'scribble');

        const beginsAt = Date.now() + COUNTDOWN_MS;
        io.to(room).emit('scribble:match:start', {
          matchId: match.id,
          host: match.host,
          players: match.players,
          rounds,
          turnDurationMs,
          beginsAt,
        });
        kioskSnapshot(io, match);
        ack?.({ ok: true, matchId: match.id });

        // Give everyone a "3, 2, 1" before the first word choice appears.
        match.startTimer = setTimeout(() => {
          if (matches.get(match.id) === match) startNextTurn(io, match);
        }, COUNTDOWN_MS);
      }
    );

    socket.on(
      'scribble:word',
      (payload: { matchId?: string; playerId?: string; wordId?: string }, ack?: (res: unknown) => void) => {
        const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
        if (!match || match.phase !== 'choosing') return ack?.({ ok: false, error: 'Wortauswahl nicht möglich.' });
        if (match.players[match.drawIndex]?.id !== payload?.playerId) return ack?.({ ok: false, error: 'Nur der Zeichner wählt.' });
        if (payload?.playerId === BOT_ID) return ack?.({ ok: false, error: 'Wortauswahl nicht möglich.' });
        if (typeof payload?.wordId !== 'string') return ack?.({ ok: false, error: 'Ungültiges Wort.' });
        chooseWord(io, match, payload.wordId);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'scribble:stroke',
      (payload: {
        matchId?: string;
        playerId?: string;
        strokeId?: string;
        color?: string;
        size?: number;
        erase?: boolean;
        points?: number[][];
      }, ack?: (result: { ok: boolean; strokeCount?: number }) => void) => {
        const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
        if (!match || match.phase !== 'drawing' || match.paused) return;
        if (match.players[match.drawIndex]?.id !== payload?.playerId) return;
        if (payload?.playerId === BOT_ID) return;
        if (typeof payload.strokeId !== 'string' || !payload.strokeId || payload.strokeId.length > 40) return;
        if (!Array.isArray(payload.points) || payload.points.length === 0 || payload.points.length > 200) return;
        const points = payload.points.filter(
          (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
        );
        if (points.length === 0) return;
        const size = typeof payload.size === 'number' && payload.size > 0 && payload.size <= 40 ? payload.size : 4;
        const color = typeof payload.color === 'string' && payload.color.length <= 20 ? payload.color : '#111111';
        const batch: StrokeBatch = { type: 'stroke', strokeId: payload.strokeId, color, size, erase: !!payload.erase, points };
        if (match.strokes.length < MAX_STROKE_BATCHES) match.strokes.push(batch);
        const strokeCount = new Set(match.strokes.map((stroke) => stroke.strokeId)).size;
        socket.to(match.room).emit('scribble:stroke', { matchId: match.id, ...batch, strokeCount });
        ack?.({ ok: true, strokeCount });
        kioskSnapshot(io, match);
      }
    );

    socket.on(
      'scribble:fill',
      (payload: { matchId?: string; playerId?: string; strokeId?: string; x?: number; y?: number; color?: string }, ack?: (result: { ok: boolean; strokeCount?: number }) => void) => {
        const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
        if (!match || match.phase !== 'drawing' || match.paused) return;
        if (match.players[match.drawIndex]?.id !== payload?.playerId) return;
        if (payload?.playerId === BOT_ID) return;
        if (typeof payload.strokeId !== 'string' || !payload.strokeId || payload.strokeId.length > 40) return;
        if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
        if (payload.x < 0 || payload.x > 1 || payload.y < 0 || payload.y > 1) return;
        const color = typeof payload.color === 'string' && payload.color.length <= 20 ? payload.color : '#111111';
        const fill: FillOp = { type: 'fill', strokeId: payload.strokeId, x: payload.x, y: payload.y, color };
        if (match.strokes.length < MAX_STROKE_BATCHES) match.strokes.push(fill);
        const strokeCount = new Set(match.strokes.map((stroke) => stroke.strokeId)).size;
        socket.to(match.room).emit('scribble:fill', { matchId: match.id, x: fill.x, y: fill.y, color: fill.color, strokeCount });
        ack?.({ ok: true, strokeCount });
        kioskSnapshot(io, match);
      }
    );

    socket.on('scribble:clear', (payload: { matchId?: string; playerId?: string }) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'drawing' || match.paused) return;
      if (match.players[match.drawIndex]?.id !== payload?.playerId) return;
      if (payload?.playerId === BOT_ID) return;
      match.strokes = [];
      io.to(match.room).emit('scribble:clear', { matchId: match.id });
      kioskSnapshot(io, match);
    });

    // Removes the whole last pen stroke (every batch sharing its strokeId),
    // not just the most recent network batch — a single visible pen stroke is
    // split into many small batches by the client's per-frame flush, so
    // popping only the last array entry would just nibble a fragment off the
    // end of the line instead of undoing it. Broadcasts the reduced canonical
    // stroke list so every client redraws from the same authoritative state
    // rather than trying to "erase" (which can't correctly undo overlaps).
    socket.on('scribble:undo', (payload: { matchId?: string; playerId?: string }, ack?: (result: { ok: boolean; strokeCount?: number }) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'drawing' || match.paused) return;
      if (match.players[match.drawIndex]?.id !== payload?.playerId) return;
      if (match.strokes.length === 0) return;
      const lastStrokeId = match.strokes[match.strokes.length - 1].strokeId;
      match.strokes = match.strokes.filter((s) => s.strokeId !== lastStrokeId);
      const strokeCount = new Set(match.strokes.map((stroke) => stroke.strokeId)).size;
      io.to(match.room).emit('scribble:redraw', { matchId: match.id, strokes: match.strokes, strokeCount });
      ack?.({ ok: true, strokeCount });
      kioskSnapshot(io, match);
    });

    socket.on(
      'scribble:guess',
      (payload: { matchId?: string; playerId?: string; text?: string }, ack?: (res: unknown) => void) => {
        const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
        const player = match?.players.find((p) => p.id === payload?.playerId);
        if (!match || !player || typeof payload?.text !== 'string' || !payload.text.trim()) {
          return ack?.({ ok: false, error: 'Tipp nicht angenommen.' });
        }
        if (player.id === BOT_ID) return ack?.({ ok: false, error: 'Tipp nicht angenommen.' });
        if (match.phase !== 'drawing' || match.paused) return ack?.({ ok: true, correct: false });
        if (match.players[match.drawIndex]?.id === player.id) return ack?.({ ok: false, error: 'Der Zeichner rät nicht mit.' });
        if (match.guessedPlayerIds.has(player.id)) return ack?.({ ok: true, correct: true });

        const text = payload.text.trim().slice(0, 80);
        if (!match.currentWord || !matchesAnswer(text, [match.currentWord])) {
          io.to(match.room).emit('scribble:chat', { matchId: match.id, playerId: player.id, name: player.name, text });
          // "Knapp dran" is only ever sent back to this one guesser via the
          // ack, never broadcast - anyone else seeing it would effectively
          // learn the word is nearly spelled out.
          const close = !!match.currentWord && isCloseGuess(text, match.currentWord);
          return ack?.({ ok: true, correct: false, close });
        }

        const remainingMs = Math.max(0, (match.turnExpiresAt ?? Date.now()) - Date.now());
        const points = pointsForGuess(remainingMs, match.turnDurationMs);
        match.scores.set(player.id, (match.scores.get(player.id) ?? 0) + points);
        match.guessedPlayerIds.add(player.id);
        io.to(match.room).emit('scribble:chat', {
          matchId: match.id,
          playerId: player.id,
          name: player.name,
          correct: true,
          points,
        });
        io.to(match.room).emit('scribble:scores', { matchId: match.id, scores: scorePayload(match) });
        kioskSnapshot(io, match);
        ack?.({ ok: true, correct: true, points });

        if (allEligibleGuessed(match)) {
          endTurn(io, match, 'all-guessed');
        }
      }
    );

    socket.on('scribble:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      if (match.phase !== 'drawing' || match.paused) return ack?.({ ok: true });

      const remainingMs = Math.max(1, (match.turnExpiresAt ?? Date.now()) - Date.now());
      match.pausedElapsedMs = match.turnDurationMs - remainingMs;
      match.turnRemainingMs = remainingMs;
      if (match.turnTimer) clearTimeout(match.turnTimer);
      match.hintTimers.forEach(clearTimeout);
      match.turnTimer = null;
      match.turnExpiresAt = null;
      match.hintTimers = [];
      match.paused = true;
      io.to(match.room).emit('scribble:match:paused', { matchId: match.id, remainingMs, scores: scorePayload(match) });
      kioskSnapshot(io, match);
      ack?.({ ok: true });
    });

    socket.on('scribble:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      if (match.phase !== 'drawing' || !match.paused) return ack?.({ ok: true });

      const remainingMs = match.turnRemainingMs ?? match.turnDurationMs;
      const elapsedMs = match.pausedElapsedMs ?? 0;
      match.turnRemainingMs = null;
      match.pausedElapsedMs = null;
      match.paused = false;
      startTurnTimers(io, match, remainingMs, elapsedMs);
      io.to(match.room).emit('scribble:match:resumed', { matchId: match.id, expiresAt: match.turnExpiresAt, scores: scorePayload(match) });
      kioskSnapshot(io, match);
      ack?.({ ok: true });
    });

    socket.on('scribble:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finishMatch(io, match, null, 'ended-by-host');
      ack?.({ ok: true });
    });

    socket.on('scribble:rejoin', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      const player = match?.players.find((p) => p.id === payload?.playerId);
      if (!match || !player) return ack?.({ ok: false, error: 'Match nicht gefunden.' });

      match.socketIds.set(player.id, socket.id);
      match.online.add(player.id);
      socket.join(match.room);
      io.to(match.room).emit('scribble:presence', { matchId: match.id, playerId: player.id, online: true });

      ack?.({
        ok: true,
        sync: {
          matchId: match.id,
          host: match.host,
          players: match.players,
          rounds: match.rounds,
          turnDurationMs: match.turnDurationMs,
          phase: match.phase,
          round: Math.floor(match.turnsPlayed / match.players.length) + 1,
          drawer: match.drawIndex >= 0 ? match.players[match.drawIndex] : null,
          isDrawer: match.drawIndex >= 0 && match.players[match.drawIndex]?.id === player.id,
          mask: match.currentWord ? wordMask(match.currentWord, match.revealedIndices) : null,
          // Only ever the real word for the drawer themself — everyone else
          // (including this same payload's `mask` field) must stay masked.
          word: match.currentWord && match.players[match.drawIndex]?.id === player.id ? match.currentWord : null,
          expiresAt: match.phase === 'choosing' ? match.choiceExpiresAt : match.turnExpiresAt,
          paused: match.paused,
          scores: scorePayload(match),
          strokes: match.strokes,
          wordOptions:
            match.phase === 'choosing' && match.players[match.drawIndex]?.id === player.id
              ? match.wordOptions?.map((w) => ({ id: w.id, word: w.word })) ?? null
              : null,
        },
      });
    });

    socket.on('disconnect', () => {
      removeFromOpenLobbies(io, socket.id);
      for (const match of matches.values()) {
        const entry = [...match.socketIds.entries()].find(([, sid]) => sid === socket.id);
        if (!entry) continue;
        const [playerId] = entry;
        match.online.delete(playerId);
        io.to(match.room).emit('scribble:presence', { matchId: match.id, playerId, online: false });

        if (match.online.size < 2) {
          finishMatch(io, match, null, 'player-left');
          continue;
        }

        const isDrawer = match.phase !== 'choosing' ? match.players[match.drawIndex]?.id === playerId : false;
        if (match.phase === 'choosing' && match.players[match.drawIndex]?.id === playerId) {
          if (match.choiceTimer) clearTimeout(match.choiceTimer);
          match.choiceTimer = null;
          startNextTurn(io, match);
        } else if (isDrawer) {
          endTurn(io, match, 'drawer-left');
        } else if (match.phase === 'drawing' && allEligibleGuessed(match)) {
          // The last remaining un-guessed rater just left — nothing left to wait for.
          endTurn(io, match, 'all-guessed');
        }
      }
    });
  });
}
