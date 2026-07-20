// Tetris 1v1 "Battle" — server-authoritative realtime game over Socket.IO.
//
// The server owns both boards and the shared, seeded piece stream (so neither
// player gets luckier pieces), runs gravity on a fixed tick, validates every
// input, and exchanges garbage lines when a player clears 2+ rows. Clients only
// send intents (left/right/rotate/drop) and render the snapshots the server
// pushes back — the same authoritative model the quiz uses, which keeps things
// cheat-resistant and consistent on a flaky LAN.
//
// Kept fully separate from arcade.ts (the quiz) with its own `tetris:*` event
// namespace and lobby list; the only thing the two share is the arcade_results
// table, so completed Tetris matches show up automatically in the Arcade stats
// alongside the quiz.

import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { broadcastArcadeKiosk } from '../realtime';
import { recordArcadeResult } from './arcadeData';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import {
  Board,
  Piece,
  PieceType,
  emptyBoard,
  spawnPiece,
  collides,
  tryMove,
  tryRotate,
  dropDistance,
  lockPiece,
  clearLines,
  garbageFor,
  lineScore,
  addGarbage,
  pieceCells,
  pieceColor,
  levelForLines,
  gravityMsForLevel,
  makeRng,
  stringToSeed,
  nextBag,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from './tetrisLogic';

const TICK_MS = 40; // gravity/loop resolution
const COUNTDOWN_MS = 3000; // "3, 2, 1" before the first piece falls
const LOCK_STEP_BONUS = 1; // soft-drop point per row
const HARD_DROP_BONUS = 2; // hard-drop points per row
const BOT_ID = 'tetris-bot';
const BOT = { id: BOT_ID, name: 'Tetris-Bot' };

type InputAction = 'left' | 'right' | 'rotate' | 'rotateCcw' | 'soft' | 'hard';

interface PlayerRef {
  id: string;
  name: string;
}

interface TetrisLobby {
  id: string;
  groupId: string;
  eventId: string | null;
  host: PlayerRef;
  players: PlayerRef[];
  socketIds: Map<string, string>;
  ready: Set<string>;
  createdAt: number;
}

interface PlayerState {
  ref: PlayerRef;
  board: Board;
  current: Piece | null;
  pieceIndex: number;
  dropAcc: number; // ms accumulated toward the next gravity step
  score: number;
  lines: number;
  level: number;
  incoming: number; // garbage rows queued against this player
  alive: boolean;
}

interface TetrisMatch {
  id: string;
  groupId: string;
  eventId: string | null;
  room: string;
  host: PlayerRef;
  players: PlayerRef[];
  socketIds: Map<string, string>;
  sequence: PieceType[];
  rng: () => number;
  states: Map<string, PlayerState>;
  loop: NodeJS.Timeout | null;
  running: boolean;
  paused: boolean;
  lastTick: number;
  nextBotMoveAt: number;
  botPlan: InputAction[];
  botPlanKey: string | null;
  startedAt: number;
}

const lobbies = new Map<string, TetrisLobby>();
const matches = new Map<string, TetrisMatch>();

function playerById(playerId: unknown): PlayerRef | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  const row = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as PlayerRef | undefined;
  return row ?? null;
}

function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({
    id: l.id,
    host: l.host,
    players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })),
    createdAt: l.createdAt,
  }));
}

function emitLobbies(io: Server) {
  for (const socket of io.sockets.sockets.values()) { const scope = socketArcadeScope(socket); if (scope) socket.emit('tetris:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); }
}

// Open-lobby summary for GET /api/arcade/lobbies — see arcade.ts.
export function openLobbySummaries(groupId?: string, eventId?: string | null) {
  return [...lobbies.values()].filter((l) => !groupId || (l.groupId === groupId && (eventId === undefined || l.eventId === eventId))).map((l) => ({
    id: l.id,
    hostName: l.host.name,
    playerCount: l.players.length,
    createdAt: l.createdAt,
  }));
}

// Pull the next piece from the shared stream, extending it a bag at a time so
// both players draw identical pieces no matter how fast each one plays.
function drawPieceType(match: TetrisMatch, state: PlayerState): PieceType {
  while (state.pieceIndex >= match.sequence.length) match.sequence.push(...nextBag(match.rng));
  return match.sequence[state.pieceIndex++];
}

function previewTypes(match: TetrisMatch, state: PlayerState, count: number): PieceType[] {
  while (match.sequence.length < state.pieceIndex + count) match.sequence.push(...nextBag(match.rng));
  return match.sequence.slice(state.pieceIndex, state.pieceIndex + count);
}

function serializeState(match: TetrisMatch, state: PlayerState) {
  return {
    playerId: state.ref.id,
    name: state.ref.name,
    board: state.board,
    current: state.current
      ? { cells: pieceCells(state.current), color: pieceColor(state.current.type) }
      : null,
    next: previewTypes(match, state, 2),
    score: state.score,
    lines: state.lines,
    level: state.level,
    incoming: state.incoming,
    alive: state.alive,
  };
}

function broadcastState(io: Server, match: TetrisMatch) {
  const payload = {
    matchId: match.id,
    running: match.running,
    paused: match.paused,
    players: match.players.map((p) => serializeState(match, match.states.get(p.id)!)),
    scores: scorePayload(match),
  };
  emitArcadeRoom(io, match.room, 'tetris:state', payload, match);
  broadcastArcadeKiosk(io, { gameType: 'tetris', groupId: match.groupId, eventId: match.eventId, ...payload, playerRefs: match.players });
}

function opponentState(match: TetrisMatch, playerId: string): PlayerState | null {
  const other = match.players.find((p) => p.id !== playerId);
  return other ? match.states.get(other.id) ?? null : null;
}

function scorePayload(match: TetrisMatch) {
  return match.players.map((p) => {
    const s = match.states.get(p.id)!;
    return { playerId: p.id, name: p.name, score: s.score, lines: s.lines };
  });
}

function realPlayerIds(players: PlayerRef[]): string[] {
  return players.filter((p) => p.id !== BOT_ID).map((p) => p.id);
}

function pieceKey(piece: Piece): string {
  return `${piece.x}:${piece.y}:${piece.rotation}`;
}

function evaluateBoard(board: Board, cleared: number): number {
  let aggregateHeight = 0;
  let holes = 0;
  let bumpiness = 0;
  let previousHeight = 0;

  for (let x = 0; x < BOARD_WIDTH; x++) {
    let y = 0;
    while (y < BOARD_HEIGHT && board[y][x] === 0) y += 1;
    const columnHeight = BOARD_HEIGHT - y;
    aggregateHeight += columnHeight;
    if (x > 0) bumpiness += Math.abs(columnHeight - previousHeight);
    previousHeight = columnHeight;

    let filled = false;
    for (; y < BOARD_HEIGHT; y++) {
      if (board[y][x] !== 0) filled = true;
      else if (filled) holes += 1;
    }
  }

  return cleared * 900 - aggregateHeight * 7 - holes * 55 - bumpiness * 14;
}

function planBotPath(board: Board, start: Piece, targetRotation: number, targetX: number): InputAction[] {
  type Node = { piece: Piece; path: InputAction[] };
  const queue: Node[] = [{ piece: start, path: [] }];
  const seen = new Set([pieceKey(start)]);
  const directions: Array<{ action: InputAction; next: (piece: Piece) => Piece | null }> = [
    { action: 'left', next: (piece) => tryMove(board, piece, -1, 0) },
    { action: 'right', next: (piece) => tryMove(board, piece, 1, 0) },
    { action: 'rotate', next: (piece) => tryRotate(board, piece, 1) },
    { action: 'rotateCcw', next: (piece) => tryRotate(board, piece, -1) },
  ];

  while (queue.length) {
    const node = queue.shift()!;
    if (node.piece.rotation === targetRotation && node.piece.x === targetX) return [...node.path, 'hard'];
    if (node.path.length >= 18) continue;
    for (const step of directions) {
      const next = step.next(node.piece);
      if (!next) continue;
      const key = pieceKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ piece: next, path: [...node.path, step.action] });
    }
  }
  return ['hard'];
}

function chooseBotTarget(match: TetrisMatch, state: PlayerState): { rotation: number; x: number } | null {
  if (!state.current) return null;
  let best: { rotation: number; x: number; score: number } | null = null;
  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = -2; x < BOARD_WIDTH + 2; x++) {
      const candidate = { ...state.current, rotation, x };
      if (collides(state.board, candidate)) continue;
      const landing = { ...candidate, y: candidate.y + dropDistance(state.board, candidate) };
      const locked = lockPiece(state.board, landing);
      const { board: clearedBoard, cleared } = clearLines(locked);
      const score = evaluateBoard(clearedBoard, cleared);
      const centerBonus = 40 - Math.abs(x - 3.5) * 6;
      const total = score + centerBonus;
      if (!best || total > best.score) best = { rotation, x, score: total };
    }
  }
  return best ? { rotation: best.rotation, x: best.x } : null;
}

function finishMatch(io: Server, match: TetrisMatch, winner: PlayerRef | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  match.running = false;
  endArcadeSession(realPlayerIds(match.players), 'tetris', match);
  recordArcadeResult({
    gameType: 'tetris',
    winnerId: winner?.id === BOT_ID ? null : winner?.id ?? null,
    players: match.players,
    scores: scorePayload(match),
    reason,
    startedAt: match.startedAt,
    scope: match,
  });
  emitArcadeRoom(io, match.room, 'tetris:match:end', {
    matchId: match.id,
    winner,
    reason,
    scores: scorePayload(match),
  }, match);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
  matches.delete(match.id);
}

// If exactly one player is left standing, end the match. Returns true if ended.
function checkGameOver(io: Server, match: TetrisMatch): boolean {
  const alive = match.players.filter((p) => match.states.get(p.id)!.alive);
  if (alive.length > 1) return false;
  const winner = alive[0] ? match.players.find((p) => p.id === alive[0].id) ?? null : null;
  finishMatch(io, match, winner, 'completed');
  return true;
}

// Spawns the next piece for a player; if it collides immediately, they top out.
function spawnNext(match: TetrisMatch, state: PlayerState) {
  const piece = spawnPiece(drawPieceType(match, state));
  if (collides(state.board, piece)) {
    state.current = null;
    state.alive = false;
  } else {
    state.current = piece;
    state.dropAcc = 0;
  }
}

// Locks the current piece, resolves line clears, exchanges garbage and spawns
// the next piece. The garbage rules: clearing lines first cancels your own
// pending garbage, then sends the surplus to your opponent; placing a piece
// without clearing anything drops your pending garbage onto your own field.
function lockAndAdvance(match: TetrisMatch, state: PlayerState) {
  if (!state.current) return;
  const locked = lockPiece(state.board, state.current);
  const { board: cleared, cleared: clearedCount } = clearLines(locked);
  state.board = cleared;

  if (clearedCount > 0) {
    state.lines += clearedCount;
    state.level = levelForLines(state.lines);
    state.score += lineScore(clearedCount, state.level);

    let attack = garbageFor(clearedCount);
    const cancelled = Math.min(attack, state.incoming);
    state.incoming -= cancelled;
    attack -= cancelled;
    if (attack > 0) {
      const opponent = opponentState(match, state.ref.id);
      if (opponent) opponent.incoming += attack;
    }
  } else if (state.incoming > 0) {
    const gap = Math.floor(match.rng() * BOARD_WIDTH);
    state.board = addGarbage(state.board, state.incoming, gap);
    state.incoming = 0;
  }

  spawnNext(match, state);
}

function applyInput(match: TetrisMatch, state: PlayerState, action: InputAction): boolean {
  if (!state.current || !state.alive) return false;
  switch (action) {
    case 'left': {
      const moved = tryMove(state.board, state.current, -1, 0);
      if (moved) state.current = moved;
      return Boolean(moved);
    }
    case 'right': {
      const moved = tryMove(state.board, state.current, 1, 0);
      if (moved) state.current = moved;
      return Boolean(moved);
    }
    case 'rotate': {
      const rotated = tryRotate(state.board, state.current, 1);
      if (rotated) state.current = rotated;
      return Boolean(rotated);
    }
    case 'rotateCcw': {
      const rotated = tryRotate(state.board, state.current, -1);
      if (rotated) state.current = rotated;
      return Boolean(rotated);
    }
    case 'soft': {
      const moved = tryMove(state.board, state.current, 0, 1);
      if (moved) {
        state.current = moved;
        state.score += LOCK_STEP_BONUS;
        state.dropAcc = 0;
        return true;
      }
      // Can't drop further -> lock in place.
      lockAndAdvance(match, state);
      return true;
    }
    case 'hard': {
      const distance = dropDistance(state.board, state.current);
      state.current = { ...state.current, y: state.current.y + distance };
      state.score += distance * HARD_DROP_BONUS;
      lockAndAdvance(match, state);
      return true;
    }
    default:
      return false;
  }
}

// One gravity step: drop the piece a row, or lock it if it can't fall.
function gravityStep(match: TetrisMatch, state: PlayerState) {
  if (!state.current || !state.alive) return;
  const moved = tryMove(state.board, state.current, 0, 1);
  if (moved) {
    state.current = moved;
  } else {
    lockAndAdvance(match, state);
  }
}

function startLoop(io: Server, match: TetrisMatch) {
  match.lastTick = Date.now();
  match.loop = setInterval(() => {
    if (!match.running || match.paused) {
      match.lastTick = Date.now();
      return;
    }
    const now = Date.now();
    const dt = now - match.lastTick;
    match.lastTick = now;
    let changed = false;

    const bot = match.states.get(BOT_ID);
    if (bot?.alive && bot.current) {
      const key = String(bot.pieceIndex);
      if (match.botPlanKey !== key || match.botPlan.length === 0) {
        const target = chooseBotTarget(match, bot);
        match.botPlan = target ? planBotPath(bot.board, bot.current, target.rotation, target.x) : ['hard'];
        match.botPlanKey = key;
        match.nextBotMoveAt = now + 120;
      }
      if (now >= match.nextBotMoveAt && match.botPlan.length > 0) {
        const action = match.botPlan.shift()!;
        const acted = applyInput(match, bot, action);
        match.nextBotMoveAt = now + (action === 'hard' ? 0 : 55);
        changed = changed || acted;
      }
    }

    for (const p of match.players) {
      const state = match.states.get(p.id)!;
      if (!state.alive || !state.current) continue;
      state.dropAcc += dt;
      const gravityMs = gravityMsForLevel(state.level);
      while (state.dropAcc >= gravityMs && state.alive && state.current) {
        state.dropAcc -= gravityMs;
        gravityStep(match, state);
        changed = true;
      }
    }
    if (changed) {
      broadcastState(io, match);
      checkGameOver(io, match);
    }
  }, TICK_MS);
}

function removeFromOpenLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const entry = [...lobby.socketIds.entries()].find(([, sid]) => sid === socketId);
    if (!entry) continue;
    if (lobby.host.id === entry[0]) {
      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'tetris', id);
      lobbies.delete(id);
    } else {
      releaseLobbyMembership(entry[0], 'tetris', id);
      lobby.socketIds.delete(entry[0]);
      lobby.ready.delete(entry[0]);
      lobby.players = lobby.players.filter((p) => p.id !== entry[0]);
    }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

export function registerTetrisSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const emitSocketLobbies = () => { const scope = socketArcadeScope(socket); if (scope) socket.emit('tetris:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); };
    emitSocketLobbies();

    socket.on('tetris:lobbies:get', emitSocketLobbies);
    socket.on('scope:subscribe', emitSocketLobbies);
    socket.on('room:subscribe', emitSocketLobbies);

    socket.on('tetris:lobby:create', (payload: { playerId?: string }, ack?: (res: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const lobby: TetrisLobby = {
        id: nanoid(),
        ...scope,
        host: player,
        players: [player],
        socketIds: new Map([[player.id, socket.id]]),
        ready: new Set(),
        createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'tetris', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('tetris:lobby:bot', (payload: { playerId?: string }, ack?: (res: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const lobby: TetrisLobby = { id: nanoid(), ...scope, host: player, players: [player, BOT], socketIds: new Map([[player.id, socket.id]]), ready: new Set([BOT_ID]), createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'tetris', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('tetris:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobby gehört zu einer anderen Gruppe.' });
      const alreadyIn = lobby.players.some((p) => p.id === player.id);
      // 1v1: block a third party from crowding into a full lobby.
      if (!alreadyIn && lobby.players.length >= 2) return ack?.({ ok: false, error: 'Lobby ist voll (1v1).' });
      if (!claimLobbyMembership(player.id, 'tetris', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromOpenLobbies(io, socket.id);
      if (!alreadyIn) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('tetris:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || typeof payload?.playerId !== 'string') return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (lobby.host.id === payload.playerId) {
        releaseLobbyMemberships(lobby.players.map((p) => p.id), 'tetris', lobby.id);
        lobbies.delete(lobby.id);
      } else {
        releaseLobbyMembership(payload.playerId, 'tetris', lobby.id);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
        lobby.players = lobby.players.filter((p) => p.id !== payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('tetris:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('tetris:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canUseLobby(socket, lobby)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (payload?.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.players.length !== 2) return ack?.({ ok: false, error: 'Tetris Battle ist genau 1 gegen 1.' });

      const matchId = nanoid();
      const room = `tetris:${matchId}`;
      for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);

      const rng = makeRng(stringToSeed(matchId));
      const match: TetrisMatch = {
        id: matchId,
        groupId: lobby.groupId,
        eventId: lobby.eventId,
        room,
        host: lobby.host,
        players: lobby.players,
        socketIds: new Map(lobby.socketIds),
        sequence: [],
        rng,
        states: new Map(),
        loop: null,
        running: false,
        paused: false,
        lastTick: Date.now(),
        nextBotMoveAt: Date.now(),
        botPlan: [],
        botPlanKey: null,
        startedAt: Date.now(),
      };
      for (const p of lobby.players) {
        const state: PlayerState = {
          ref: p,
          board: emptyBoard(),
          current: null,
          pieceIndex: 0,
          dropAcc: 0,
          score: 0,
          lines: 0,
          level: 1,
          incoming: 0,
          alive: true,
        };
        spawnNext(match, state);
        match.states.set(p.id, state);
      }
      matches.set(matchId, match);
      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'tetris', lobby.id);
      lobbies.delete(lobby.id);
      emitLobbies(io);
      startArcadeSession(realPlayerIds(match.players), 'tetris', match);

      const beginsAt = Date.now() + COUNTDOWN_MS;
      emitArcadeRoom(io, room, 'tetris:match:start', {
        matchId,
        host: match.host,
        players: match.players,
        beginsAt,
      }, match);
      broadcastState(io, match);
      ack?.({ ok: true, matchId });

      // Give both players a "3, 2, 1" to focus before gravity kicks in.
      startLoop(io, match);
      setTimeout(() => {
        if (matches.get(matchId) === match) {
          match.running = true;
          match.lastTick = Date.now();
        }
      }, COUNTDOWN_MS);
    });

    socket.on('tetris:input', (payload: { matchId?: string; playerId?: string; action?: InputAction }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || !match.running || match.paused) return ack?.({ ok: false });
      const state = typeof payload?.playerId === 'string' ? match.states.get(payload.playerId) : null;
      if (!state || state.ref.id === BOT_ID || !state.alive) return ack?.({ ok: false });
      const valid: InputAction[] = ['left', 'right', 'rotate', 'rotateCcw', 'soft', 'hard'];
      if (!payload?.action || !valid.includes(payload.action)) return ack?.({ ok: false });

      const changed = applyInput(match, state, payload.action);
      if (changed) {
        broadcastState(io, match);
        checkGameOver(io, match);
      }
      ack?.({ ok: true });
    });

    socket.on('tetris:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      if (!match.running || match.paused) return ack?.({ ok: true });
      match.paused = true;
      emitArcadeRoom(io, match.room, 'tetris:match:paused', { matchId: match.id }, match);
      broadcastState(io, match);
      ack?.({ ok: true });
    });

    socket.on('tetris:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      if (!match.running || !match.paused) return ack?.({ ok: true });
      match.paused = false;
      match.lastTick = Date.now();
      emitArcadeRoom(io, match.room, 'tetris:match:resumed', { matchId: match.id }, match);
      broadcastState(io, match);
      ack?.({ ok: true });
    });

    socket.on('tetris:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finishMatch(io, match, null, 'ended-by-host');
      ack?.({ ok: true });
    });

    // Lets a non-host participant end a running match themselves instead of
    // relying on the host (who might be AFK) or a raw disconnect — same
    // outcome as a disconnect mid-match: the match ends, opponent wins.
    socket.on('tetris:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const leaver = match.players.find((p) => p.id === payload?.playerId);
      if (!leaver) return ack?.({ ok: false, error: 'Du bist kein Teilnehmer dieses Matches.' });
      const winner = match.players.find((p) => p.id !== leaver.id) ?? null;
      // socket.to (not io.to): the leaver's own socket is still joined to
      // match.room at this point (unlike a real disconnect), so io.to would
      // also show them their own "opponent left" toast.
      emitArcadeRoom(io, match.room, 'tetris:opponent-left', { matchId: match.id, playerId: leaver.id }, match, socket.id);
      finishMatch(io, match, winner, 'player-left');
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      removeFromOpenLobbies(io, socket.id);
      for (const [, match] of matches) {
        const entry = [...match.socketIds.entries()].find(([, sid]) => sid === socket.id);
        if (!entry) continue;
        const leaver = entry[0];
        const winner = match.players.find((p) => p.id !== leaver) ?? null;
        emitArcadeRoom(io, match.room, 'tetris:opponent-left', { matchId: match.id, playerId: leaver }, match);
        finishMatch(io, match, winner, 'player-left');
      }
    });
  });
}
