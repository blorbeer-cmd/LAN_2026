// Tetris Duell and Arena — server-authoritative realtime game over Socket.IO.
//
// The server owns every board and the shared, seeded piece stream (so no
// player gets luckier pieces), runs gravity on a fixed tick, validates every
// input, and exchanges garbage lines when a player clears 2+ rows. Arena
// attacks rotate over the living opponents and a departure eliminates only
// that player. Clients only
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
import { arcadeTiming } from './timing';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import {
  TetrisMode,
  canStartTetris,
  isTargetableTetrisPlayer,
  nextArenaTarget,
  placementForEliminationBatch,
  placementForElimination,
  tetrisBotCount,
  tetrisMode,
  tetrisPlayerLimit,
} from './tetrisArena';
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
const COUNTDOWN_MS = arcadeTiming.countdownMs; // "3, 2, 1" before the first piece falls
const LOCK_STEP_BONUS = 1; // soft-drop point per row
const HARD_DROP_BONUS = 2; // hard-drop points per row
const BOT_ID = 'tetris-bot';
const BOT = { id: BOT_ID, name: 'Tetris-Bot' };
const BOT_ID_PREFIX = 'tetris-bot-';

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
  mode: TetrisMode;
  playerLimit: number;
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
  incoming: Array<{ sourcePlayerId: string; lines: number }>;
  targetId: string | null;
  garbageSent: number;
  garbageReceived: number;
  knockouts: number;
  placement: number | null;
  eliminatedAt: number | null;
  eliminationReason: string | null;
  lastGarbageSourceId: string | null;
  botPlan: InputAction[];
  botPlanKey: string | null;
  nextBotMoveAt: number;
  pendingElimination: boolean;
  alive: boolean;
}

interface TetrisMatch {
  id: string;
  groupId: string;
  eventId: string | null;
  room: string;
  host: PlayerRef;
  mode: TetrisMode;
  players: PlayerRef[];
  socketIds: Map<string, string>;
  sequence: PieceType[];
  pieceRng: () => number;
  garbageRng: () => number;
  states: Map<string, PlayerState>;
  loop: NodeJS.Timeout | null;
  running: boolean;
  paused: boolean;
  lastTick: number;
  stateDirty: boolean;
  inputQueue: Array<{ playerId: string; action: InputAction }>;
  startedAt: number;
}

interface PendingElimination {
  state: PlayerState;
  reason: string;
  sourcePlayerId: string | null;
}

const lobbies = new Map<string, TetrisLobby>();
const matches = new Map<string, TetrisMatch>();

function isBotId(playerId: string): boolean {
  return playerId === BOT_ID || playerId.startsWith(BOT_ID_PREFIX);
}

function arenaBots(count: number): PlayerRef[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${BOT_ID_PREFIX}${index + 1}`,
    name: `Tetris-Bot ${index + 1}`,
  }));
}

function playerById(playerId: unknown): PlayerRef | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  const row = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId) as PlayerRef | undefined;
  return row ?? null;
}

function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({
    id: l.id,
    host: l.host,
    mode: l.mode,
    playerLimit: l.playerLimit,
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
    playerLimit: l.playerLimit,
    mode: l.mode,
    createdAt: l.createdAt,
  }));
}

// Pull the next piece from the shared stream, extending it a bag at a time so
// both players draw identical pieces no matter how fast each one plays.
function drawPieceType(match: TetrisMatch, state: PlayerState): PieceType {
  while (state.pieceIndex >= match.sequence.length) match.sequence.push(...nextBag(match.pieceRng));
  return match.sequence[state.pieceIndex++];
}

function previewTypes(match: TetrisMatch, state: PlayerState, count: number): PieceType[] {
  while (match.sequence.length < state.pieceIndex + count) match.sequence.push(...nextBag(match.pieceRng));
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
    incoming: state.incoming.reduce((sum, packet) => sum + packet.lines, 0),
    targetId: state.targetId,
    garbageSent: state.garbageSent,
    garbageReceived: state.garbageReceived,
    knockouts: state.knockouts,
    placement: state.placement,
    eliminatedAt: state.eliminatedAt,
    eliminationReason: state.eliminationReason,
    isBot: isBotId(state.ref.id),
    alive: isTargetableTetrisPlayer(state),
  };
}

function broadcastState(io: Server, match: TetrisMatch) {
  const payload = {
    matchId: match.id,
    running: match.running,
    paused: match.paused,
    mode: match.mode,
    host: match.host,
    players: match.players.map((p) => serializeState(match, match.states.get(p.id)!)),
    scores: scorePayload(match),
  };
  emitArcadeRoom(io, match.room, 'tetris:state', payload, match);
  broadcastArcadeKiosk(io, { gameType: 'tetris', groupId: match.groupId, eventId: match.eventId, ...payload, playerRefs: match.players });
}

function aliveIds(match: TetrisMatch): Set<string> {
  return new Set(
    match.players
      .filter((player) => {
        const state = match.states.get(player.id);
        return state ? isTargetableTetrisPlayer(state) : false;
      })
      .map((player) => player.id),
  );
}

function attackTarget(match: TetrisMatch, state: PlayerState): PlayerState | null {
  const playerIds = match.players.map((player) => player.id);
  const living = aliveIds(match);
  const targetId =
    state.targetId && living.has(state.targetId)
      ? state.targetId
      : nextArenaTarget(playerIds, living, state.ref.id, state.targetId);
  state.targetId = targetId ? nextArenaTarget(playerIds, living, state.ref.id, targetId) : null;
  return targetId ? match.states.get(targetId) ?? null : null;
}

function scorePayload(match: TetrisMatch) {
  return match.players.map((p) => {
    const s = match.states.get(p.id)!;
    return {
      playerId: p.id,
      name: p.name,
      mode: match.mode,
      isBot: isBotId(p.id),
      isWinner: s.placement === 1,
      score: s.score,
      lines: s.lines,
      placement: s.placement,
      garbageSent: s.garbageSent,
      garbageReceived: s.garbageReceived,
      knockouts: s.knockouts,
      eliminatedAt: s.eliminatedAt,
      eliminationReason: s.eliminationReason,
    };
  });
}

function realPlayerIds(players: PlayerRef[]): string[] {
  return players.filter((p) => !isBotId(p.id)).map((p) => p.id);
}

function pieceKey(piece: Piece): string {
  return `${piece.x}:${piece.y}:${piece.rotation}`;
}

export function evaluateBotBoard(board: Board, cleared: number): number {
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

export function planBotPath(board: Board, start: Piece, targetRotation: number, targetX: number): InputAction[] {
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

export function chooseBotTarget(board: Board, current: Piece): { rotation: number; x: number } | null {
  let best: { rotation: number; x: number; score: number } | null = null;
  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = -2; x < BOARD_WIDTH + 2; x++) {
      const candidate = { ...current, rotation, x };
      if (collides(board, candidate)) continue;
      const landing = { ...candidate, y: candidate.y + dropDistance(board, candidate) };
      const locked = lockPiece(board, landing);
      const { board: clearedBoard, cleared } = clearLines(locked);
      const score = evaluateBotBoard(clearedBoard, cleared);
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
  if (winner) {
    const winnerState = match.states.get(winner.id);
    if (winnerState) winnerState.placement = 1;
  }
  endArcadeSession(realPlayerIds(match.players), 'tetris', match);
  recordArcadeResult({
    gameType: 'tetris',
    winnerId: winner && !isBotId(winner.id) ? winner.id : null,
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

function eliminatePlayers(match: TetrisMatch, pending: PendingElimination[]) {
  const eliminations = pending.filter(
    ({ state }, index) => state.alive && pending.findIndex((entry) => entry.state === state) === index,
  );
  if (eliminations.length === 0) return;
  const aliveBefore = [...match.states.values()].filter((state) => state.alive).length;
  const placement = eliminations.length === 1
    ? placementForElimination(aliveBefore)
    : placementForEliminationBatch(aliveBefore, eliminations.length);
  const eliminatedAt = Date.now();
  for (const { state, reason } of eliminations) {
    state.alive = false;
    state.pendingElimination = false;
    state.current = null;
    state.placement = placement;
    state.eliminatedAt = eliminatedAt;
    state.eliminationReason = reason;
    if (!isBotId(state.ref.id)) endArcadeSession([state.ref.id], 'tetris', match);
  }
  const living = aliveIds(match);
  const eliminatedIds = new Set(eliminations.map(({ state }) => state.ref.id));
  const playerOrder = match.players.map((player) => player.id);
  for (const other of match.states.values()) {
    if (other.alive && other.targetId && eliminatedIds.has(other.targetId)) {
      other.targetId = nextArenaTarget(playerOrder, living, other.ref.id, other.targetId);
    }
  }
  for (const { state, sourcePlayerId } of eliminations) {
    const source = sourcePlayerId ? match.states.get(sourcePlayerId) : null;
    if (source && source.ref.id !== state.ref.id) source.knockouts += 1;
  }
}

function eliminatePlayer(match: TetrisMatch, state: PlayerState, reason: string, sourcePlayerId: string | null = null) {
  eliminatePlayers(match, [{ state, reason, sourcePlayerId }]);
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
function spawnNext(match: TetrisMatch, state: PlayerState, pendingEliminations?: PendingElimination[]) {
  const piece = spawnPiece(drawPieceType(match, state));
  const sourcePlayerId = state.lastGarbageSourceId;
  state.lastGarbageSourceId = null;
  if (collides(state.board, piece)) {
    if (pendingEliminations) {
      state.current = null;
      state.pendingElimination = true;
      pendingEliminations.push({ state, reason: 'top-out', sourcePlayerId });
    } else {
      eliminatePlayer(match, state, 'top-out', sourcePlayerId);
    }
  } else {
    state.current = piece;
    state.dropAcc = 0;
  }
}

function cancelIncoming(state: PlayerState, attack: number): number {
  let remaining = attack;
  while (remaining > 0 && state.incoming.length > 0) {
    const packet = state.incoming[0];
    const cancelled = Math.min(remaining, packet.lines);
    packet.lines -= cancelled;
    remaining -= cancelled;
    if (packet.lines === 0) state.incoming.shift();
  }
  return remaining;
}

// Locks the current piece, resolves line clears, exchanges garbage and spawns
// the next piece. The garbage rules: clearing lines first cancels your own
// pending garbage, then sends the surplus to your opponent; placing a piece
// without clearing anything drops your pending garbage onto your own field.
function lockAndAdvance(match: TetrisMatch, state: PlayerState, pendingEliminations?: PendingElimination[]) {
  if (!state.current) return;
  const locked = lockPiece(state.board, state.current);
  const { board: cleared, cleared: clearedCount } = clearLines(locked);
  state.board = cleared;

  if (clearedCount > 0) {
    state.lines += clearedCount;
    state.level = levelForLines(state.lines);
    state.score += lineScore(clearedCount, state.level);

    const attack = cancelIncoming(state, garbageFor(clearedCount));
    if (attack > 0) {
      const target = attackTarget(match, state);
      if (target) {
        target.incoming.push({ sourcePlayerId: state.ref.id, lines: attack });
        state.garbageSent += attack;
      }
    }
  } else if (state.incoming.length > 0) {
    const incoming = state.incoming.reduce((sum, packet) => sum + packet.lines, 0);
    state.lastGarbageSourceId = state.incoming[state.incoming.length - 1]?.sourcePlayerId ?? null;
    const gap = Math.floor(match.garbageRng() * BOARD_WIDTH);
    state.board = addGarbage(state.board, incoming, gap);
    state.garbageReceived += incoming;
    state.incoming = [];
  }

  spawnNext(match, state, pendingEliminations);
}

function applyInput(
  match: TetrisMatch,
  state: PlayerState,
  action: InputAction,
  pendingEliminations?: PendingElimination[],
): boolean {
  if (!state.current || !isTargetableTetrisPlayer(state)) return false;
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
      lockAndAdvance(match, state, pendingEliminations);
      return true;
    }
    case 'hard': {
      const distance = dropDistance(state.board, state.current);
      state.current = { ...state.current, y: state.current.y + distance };
      state.score += distance * HARD_DROP_BONUS;
      lockAndAdvance(match, state, pendingEliminations);
      return true;
    }
    default:
      return false;
  }
}

// One gravity step: drop the piece a row, or lock it if it can't fall.
function gravityStep(match: TetrisMatch, state: PlayerState, pendingEliminations?: PendingElimination[]) {
  if (!state.current || !state.alive) return;
  const moved = tryMove(state.board, state.current, 0, 1);
  if (moved) {
    state.current = moved;
  } else {
    lockAndAdvance(match, state, pendingEliminations);
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
    const pendingEliminations: PendingElimination[] = [];

    const queuedInputs = match.inputQueue.splice(0);
    for (const input of queuedInputs) {
      const state = match.states.get(input.playerId);
      if (!state || !isTargetableTetrisPlayer(state)) continue;
      const acted = applyInput(match, state, input.action, pendingEliminations);
      changed = changed || acted;
    }

    for (const bot of match.states.values()) {
      if (!isBotId(bot.ref.id) || !isTargetableTetrisPlayer(bot) || !bot.current) continue;
      const key = String(bot.pieceIndex);
      if (bot.botPlanKey !== key || bot.botPlan.length === 0) {
        const target = chooseBotTarget(bot.board, bot.current);
        bot.botPlan = target ? planBotPath(bot.board, bot.current, target.rotation, target.x) : ['hard'];
        bot.botPlanKey = key;
        bot.nextBotMoveAt = now + 120;
      }
      if (now >= bot.nextBotMoveAt && bot.botPlan.length > 0) {
        const action = bot.botPlan.shift()!;
        const acted = applyInput(match, bot, action, pendingEliminations);
        bot.nextBotMoveAt = now + (action === 'hard' ? 0 : 55);
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
        gravityStep(match, state, pendingEliminations);
        changed = true;
      }
    }
    eliminatePlayers(match, pendingEliminations);
    if (changed || match.stateDirty) {
      match.stateDirty = false;
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

function handleMatchDeparture(io: Server, match: TetrisMatch, playerId: string, excludedSocketId?: string) {
  const leaver = match.players.find((player) => player.id === playerId);
  const state = match.states.get(playerId);
  if (!leaver || !state) return;

  emitArcadeRoom(
    io,
    match.room,
    'tetris:opponent-left',
    { matchId: match.id, playerId: leaver.id, playerName: leaver.name },
    match,
    excludedSocketId,
  );

  if (match.mode === 'duel') {
    const winner = match.players.find((player) => player.id !== leaver.id) ?? null;
    finishMatch(io, match, winner, 'player-left');
    return;
  }

  match.socketIds.delete(playerId);
  match.inputQueue = match.inputQueue.filter((input) => input.playerId !== playerId);
  eliminatePlayer(match, state, 'player-left');
  if (match.host.id === playerId) {
    const nextHost = match.players.find(
      (player) => !isBotId(player.id) && match.states.get(player.id)?.alive && match.socketIds.has(player.id),
    );
    const livingBot = match.players.find((player) => isBotId(player.id) && match.states.get(player.id)?.alive);
    if (nextHost) {
      match.host = nextHost;
    } else if (livingBot) {
      match.host = livingBot;
      finishMatch(io, match, livingBot, 'no-human-players');
      return;
    }
  }
  match.stateDirty = true;
  if (!checkGameOver(io, match)) broadcastState(io, match);
}

export function registerTetrisSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const emitSocketLobbies = () => { const scope = socketArcadeScope(socket); if (scope) socket.emit('tetris:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); };
    emitSocketLobbies();

    socket.on('tetris:lobbies:get', emitSocketLobbies);
    socket.on('scope:subscribe', emitSocketLobbies);
    socket.on('room:subscribe', emitSocketLobbies);

    socket.on('tetris:lobby:create', (payload: { playerId?: string; mode?: TetrisMode }, ack?: (res: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const mode = tetrisMode(payload?.mode);
      if (!mode) return ack?.({ ok: false, error: 'Unbekannter Tetris-Modus.' });
      const lobby: TetrisLobby = {
        id: nanoid(),
        ...scope,
        host: player,
        mode,
        playerLimit: tetrisPlayerLimit(mode),
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
    socket.on('tetris:lobby:bot', (payload: { playerId?: string; mode?: TetrisMode }, ack?: (res: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const mode = tetrisMode(payload?.mode);
      if (!mode) return ack?.({ ok: false, error: 'Unbekannter Tetris-Modus.' });
      const botCount = tetrisBotCount(mode);
      const bots = mode === 'arena' ? arenaBots(botCount) : [BOT];
      const lobby: TetrisLobby = {
        id: nanoid(),
        ...scope,
        host: player,
        mode,
        playerLimit: tetrisPlayerLimit(mode),
        players: [player, ...bots],
        socketIds: new Map([[player.id, socket.id]]),
        ready: new Set(bots.map((bot) => bot.id)),
        createdAt: Date.now(),
      };
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
      if (!alreadyIn && lobby.players.length >= lobby.playerLimit) return ack?.({ ok: false, error: 'Lobby ist voll.' });
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
      if (lobby.socketIds.get(payload.playerId) !== socket.id) return ack?.({ ok: false, error: 'Du kannst nur dich selbst abmelden.' });
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
      if (
        !lobby ||
        !canUseLobby(socket, lobby) ||
        typeof payload?.playerId !== 'string' ||
        lobby.socketIds.get(payload.playerId) !== socket.id ||
        !setLobbyReady(lobby, payload.playerId, payload?.ready)
      ) {
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
      if (lobby.socketIds.get(lobby.host.id) !== socket.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (!canStartTetris(lobby.mode, lobby.players.length)) {
        return ack?.({
          ok: false,
          error: lobby.mode === 'arena' ? 'Für eine Arena werden 3 bis 8 Spieler benötigt.' : 'Tetris Duell ist genau 1 gegen 1.',
        });
      }
      if (lobby.players.some((player) => !isLobbyReady(lobby, player.id))) {
        return ack?.({ ok: false, error: 'Alle Mitspieler müssen bereit sein.' });
      }
      const matchId = nanoid();
      const room = `tetris:${matchId}`;
      for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);

      const pieceRng = makeRng(stringToSeed(`${matchId}:pieces`));
      const garbageRng = makeRng(stringToSeed(`${matchId}:garbage`));
      const match: TetrisMatch = {
        id: matchId,
        groupId: lobby.groupId,
        eventId: lobby.eventId,
        room,
        host: lobby.host,
        mode: lobby.mode,
        players: lobby.players,
        socketIds: new Map(lobby.socketIds),
        sequence: [],
        pieceRng,
        garbageRng,
        states: new Map(),
        loop: null,
        running: false,
        paused: false,
        lastTick: Date.now(),
        stateDirty: false,
        inputQueue: [],
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
          incoming: [],
          targetId: null,
          garbageSent: 0,
          garbageReceived: 0,
          knockouts: 0,
          placement: null,
          eliminatedAt: null,
          eliminationReason: null,
          lastGarbageSourceId: null,
          botPlan: [],
          botPlanKey: null,
          nextBotMoveAt: Date.now(),
          pendingElimination: false,
          alive: true,
        };
        spawnNext(match, state);
        match.states.set(p.id, state);
      }
      const initialAlive = aliveIds(match);
      const playerOrder = match.players.map((player) => player.id);
      for (const state of match.states.values()) {
        state.targetId = nextArenaTarget(playerOrder, initialAlive, state.ref.id, null);
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
        mode: match.mode,
        players: match.players,
        beginsAt,
      }, match);
      broadcastState(io, match);
      ack?.({ ok: true, matchId });

      // Give every player a "3, 2, 1" to focus before gravity kicks in.
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
      if (
        !state ||
        isBotId(state.ref.id) ||
        match.socketIds.get(state.ref.id) !== socket.id ||
        !isTargetableTetrisPlayer(state)
      ) {
        return ack?.({ ok: false });
      }
      const valid: InputAction[] = ['left', 'right', 'rotate', 'rotateCcw', 'soft', 'hard'];
      if (!payload?.action || !valid.includes(payload.action)) return ack?.({ ok: false });
      if (match.inputQueue.length >= 128) return ack?.({ ok: false });
      match.inputQueue.push({ playerId: state.ref.id, action: payload.action });
      ack?.({ ok: true });
    });

    socket.on('tetris:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      if (match.socketIds.get(match.host.id) !== socket.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      if (!match.running || match.paused) return ack?.({ ok: true });
      match.paused = true;
      match.inputQueue = [];
      emitArcadeRoom(io, match.room, 'tetris:match:paused', { matchId: match.id }, match);
      broadcastState(io, match);
      ack?.({ ok: true });
    });

    socket.on('tetris:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (res: unknown) => void) => {
      const match = typeof payload?.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload?.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      if (match.socketIds.get(match.host.id) !== socket.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
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
      if (match.socketIds.get(match.host.id) !== socket.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
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
      if (match.socketIds.get(leaver.id) !== socket.id) return ack?.({ ok: false, error: 'Du kannst nur dich selbst abmelden.' });
      handleMatchDeparture(io, match, leaver.id, socket.id);
      socket.leave(match.room);
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      removeFromOpenLobbies(io, socket.id);
      for (const [, match] of matches) {
        const entry = [...match.socketIds.entries()].find(([, sid]) => sid === socket.id);
        if (!entry) continue;
        handleMatchDeparture(io, match, entry[0]);
      }
    });
  });
}
