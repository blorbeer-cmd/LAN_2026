import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcastArcadeKiosk } from '../realtime';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { recordArcadeResult } from './arcadeData';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { arcadeTiming } from './timing';
import { challengeOrder, challengePayload, createTrial, difficultyFor, isCurrentChallenge, isTrialChallenge, remainingUntil, scoreCps, scoreReaction, scoreRepeatedTrials, scoreTiming10, safeScoreInput, seenBeforeSelection, validateTrialInput, winnerIdForScores, type ChallengeKey, type InternalTrial, type TrialPayload } from './challengeRushLogic';

const MAX_PLAYERS = 15;
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const RESULT_PAUSE_MS = 1_500;
const END_REVEAL_MS = 12_000;

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; groupId: string; eventId: string | null; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface Progress {
  clicks: number; errors: number; correct: number; completed: boolean; score: number;
  startedAt: number; elapsedBeforePause: number; lastInputAt: number;
  rawScore: number; trials: number; streak: number; trialIndex: number; partialHits: number;
  trial: InternalTrial | null; trialStartedAt: number; trialElapsedBeforePause: number;
  seenSymbols: Set<string>; symbolHistory: string[];
}
interface Match {
  id: string; groupId: string; eventId: string | null; room: string; host: Player; players: Player[]; socketIds: Map<string, string>;
  order: ChallengeKey[]; index: number; phase: 'countdown' | 'playing' | 'result' | 'ended'; seed: number;
  current: ReturnType<typeof challengePayload>; progress: Map<string, Progress>; scores: Map<string, number>;
  startedAt: number; timer: NodeJS.Timeout | null; deadlineAt: number | null; pausedRemainingMs: number | null; paused: boolean;
  reconnectTimers: Map<string, NodeJS.Timeout>; reconnectTokens: Map<string, string>; forfeited: Set<string>;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const real = (players: Player[]) => players.filter((player) => !player.id.startsWith('bot-')).map((player) => player.id);
const playerById = (id: unknown): Player | null => typeof id === 'string' ? (db.prepare('SELECT id,name,avatar,color FROM players WHERE id=?').get(id) as Player | undefined) ?? null : null;
function owns(socket: Socket, id: unknown): id is string {
  if (typeof id !== 'string' || !socketArcadeScope(socket, id)) return false;
  const authenticatedId = socket.data.authPlayerId;
  if (typeof authenticatedId === 'string') return authenticatedId === id;
  return socket.data.challengeRushPlayerId === id;
}

function bindPlayer(socket: Socket, playerId: string): boolean {
  const authenticatedId = socket.data.authPlayerId;
  if (typeof authenticatedId === 'string') return authenticatedId === playerId;
  const boundId = socket.data.challengeRushPlayerId;
  if (typeof boundId === 'string' && boundId !== playerId) return false;
  socket.data.challengeRushPlayerId = playerId;
  return true;
}
const publicLobbies = (groupId: string, eventId: string | null) => [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({ id: l.id, host: l.host, players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })), createdAt: l.createdAt }));
const reconnectGraceMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(60_000, configured)) : DEFAULT_RECONNECT_GRACE_MS; };

function emitLobbies(io: Server): void {
  for (const socket of io.sockets.sockets.values()) {
    const scope = socketArcadeScope(socket);
    if (scope) socket.emit('challenge-rush:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
  }
}

function scorePayload(match: Match) {
  return match.players.map((player) => ({ playerId: player.id, name: player.name, score: match.scores.get(player.id) ?? 0, connected: match.socketIds.has(player.id), forfeited: match.forfeited.has(player.id) }));
}

function progressPayload(progress: Progress) {
  return { clicks: progress.clicks, correct: progress.correct, errors: progress.errors, completed: progress.completed, score: progress.score, trials: progress.trials, partialHits: progress.partialHits, difficulty: difficultyFor(progress.streak), streak: progress.streak };
}

function activeElapsed(progress: Progress, now = Date.now()): number {
  return progress.elapsedBeforePause + (progress.startedAt > 0 ? Math.max(0, now - progress.startedAt) : 0);
}

function trialElapsed(progress: Progress, now = Date.now()): number {
  return progress.trialElapsedBeforePause + (progress.trialStartedAt > 0 ? Math.max(0, now - progress.trialStartedAt) : 0);
}

function freshProgress(): Progress {
  return { clicks: 0, errors: 0, correct: 0, completed: false, score: 0, startedAt: 0, elapsedBeforePause: 0, lastInputAt: 0, rawScore: 0, trials: 0, streak: 0, trialIndex: 0, partialHits: 0, trial: null, trialStartedAt: 0, trialElapsedBeforePause: 0, seenSymbols: new Set(), symbolHistory: [] };
}

function stablePlayerSeed(playerId: string): number {
  let hash = 2_166_136_261;
  for (const character of playerId) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return hash >>> 0;
}

function trialSeed(match: Match, progress: Progress, playerId: string): number {
  return (match.seed + match.index * 7_919 + progress.trialIndex * 104_729 + stablePlayerSeed(playerId)) >>> 0;
}

function createMatchTrial(match: Match, progress: Progress, playerId: string): InternalTrial {
  const seed = trialSeed(match, progress, playerId); const key = match.current.key; const difficulty = difficultyFor(progress.streak);
  if (isTrialChallenge(key)) {
    const trial = createTrial(key, seed, progress.trialIndex, difficulty, progress.symbolHistory);
    if (key === 'seen-before') {
      const seen = [...progress.seenSymbols];
      const selection = seenBeforeSelection(String(trial.data.symbol ?? ''), Boolean(trial.expected), seen, progress.trialIndex);
      const { symbol, repeated } = selection;
      trial.data.symbol = symbol; trial.expected = repeated; progress.seenSymbols.add(symbol);
    }
    if (key === 'n-back') progress.symbolHistory.push(String(trial.data.symbol ?? ''));
    return trial;
  }
  const randomPayload = challengePayload(key, seed);
  if (key === 'reaction-circle') return { trialId: `${progress.trialIndex}-${seed}`, index: progress.trialIndex, difficulty, phase: 'input', phaseMs: 0, data: { type: 'circle', ...randomPayload.data }, expected: randomPayload.data, state: {} };
  if (key === 'number-salad') return { trialId: `${progress.trialIndex}-${seed}`, index: progress.trialIndex, difficulty, phase: 'input', phaseMs: 0, data: { type: 'number-salad', ...randomPayload.data }, expected: Array.from({ length: 8 }, (_, index) => index + 1), state: { correct: 0 } };
  return { trialId: `${progress.trialIndex}-${seed}`, index: progress.trialIndex, difficulty, phase: 'input', phaseMs: 0, data: { type: key }, expected: null, state: {} };
}

export function inputTrialData(data: Record<string, unknown>): Record<string, unknown> {
  if (data.type === 'memory-sequence' || data.type === 'sequence' || data.type === 'whack-a-mole') {
    return { type: data.type, size: data.size, sequenceLength: Array.isArray(data.sequence) ? data.sequence.length : 0 };
  }
  if (data.type === 'matrix') return { type: data.type, size: data.size, highlightCount: Array.isArray(data.highlights) ? data.highlights.length : 0 };
  if (data.type === 'number-blind') return { type: data.type, size: data.size, numberCount: Array.isArray(data.numbers) ? data.numbers.length : 0 };
  if (data.type === 'path') return { type: data.type, size: data.size, pathLength: Array.isArray(data.path) ? data.path.length : 0 };
  if (data.type === 'missing') return { type: data.type, items: data.items, options: data.options };
  if (data.type === 'delayed-recall') return { type: data.type, prompt: data.prompt, options: data.options };
  if (data.type === 'suitcase') return { type: data.type, position: data.position, options: data.options };
  return data;
}

function trialPayload(progress: Progress): TrialPayload | null {
  if (!progress.trial) return null;
  const elapsed = trialElapsed(progress);
  if (progress.trial.phase === 'preview' && elapsed >= progress.trial.phaseMs) progress.trial.phase = 'input';
  const { expected: _expected, state, ...payload } = progress.trial;
  const phase = progress.trial.phase;
  const publicData = phase === 'input' ? inputTrialData(payload.data) : payload.data;
  const data = publicData.type === 'pairs'
    ? { ...payload.data, cards: Array.isArray(payload.data.cards) ? payload.data.cards.map((card) => ({ index: (card as { index: number }).index })) : [] }
    : publicData;
  const resume: Record<string, unknown> = {};
  if (payload.data.type === 'number-salad') resume.nextNumber = Number(state.correct ?? 0) + 1;
  if (payload.data.type === 'whack-a-mole') resume.correct = Number(state.correct ?? 0);
  if (payload.data.type === 'pairs') {
    const found = Array.isArray(state.found) ? state.found.filter((index): index is number => typeof index === 'number') : [];
    const revealed = Array.isArray(state.revealed) ? state.revealed.filter((index): index is number => typeof index === 'number') : [];
    const board = progress.trial.expected as string[];
    resume.found = found;
    resume.foundCards = found.map((index) => ({ index, value: board[index] }));
    resume.revealed = revealed;
    resume.revealedCards = revealed.map((index) => ({ index, value: board[index] }));
  }
  const phaseRemainingMs = phase === 'preview'
    ? Math.max(0, payload.phaseMs - elapsed)
    : 0;
  const inputRemainingMs = phase === 'input' && typeof payload.inputMs === 'number'
    ? Math.max(0, payload.inputMs - Math.max(0, elapsed - payload.phaseMs))
    : undefined;
  return { ...payload, phase, data, phaseRemainingMs, inputRemainingMs, resume };
}

function emitTrial(io: Server, match: Match, playerId: string, target?: Socket): void {
  const payload = trialPayload(match.progress.get(playerId)!);
  if (!payload) return;
  const socket = target ?? io.sockets.sockets.get(match.socketIds.get(playerId) ?? '');
  if (socket && canUseLobby(socket, match)) socket.emit('challenge-rush:trial', { matchId: match.id, challengeIndex: match.index, trial: payload });
}

function startPlayerTrial(io: Server, match: Match, progress: Progress, playerId: string): void {
  progress.trial = createMatchTrial(match, progress, playerId); progress.trialStartedAt = Date.now(); progress.trialElapsedBeforePause = 0;
  emitTrial(io, match, playerId);
}

function finishPlayerTrial(io: Server, match: Match, progress: Progress, playerId: string, rawScore: number, correct: boolean, errors = 0): void {
  progress.rawScore += rawScore; progress.trials += 1; progress.errors += errors; progress.correct += correct ? 1 : 0; progress.streak = correct ? progress.streak + 1 : 0; progress.trialIndex += 1; progress.trial = null; progress.trialStartedAt = 0; progress.trialElapsedBeforePause = 0;
  startPlayerTrial(io, match, progress, playerId);
}

function challengeScore(progress: Progress, key: ChallengeKey, durationMs: number): number {
  if (key === 'cps') return scoreCps(progress.clicks, durationMs);
  if (key === 'timing-10') return safeScoreInput(Math.round(progress.trials ? progress.rawScore / progress.trials : 0));
  return scoreRepeatedTrials(progress.rawScore, progress.trials, progress.correct, progress.partialHits, durationMs);
}

function clearTimer(match: Match): void {
  if (match.timer) clearTimeout(match.timer);
  match.timer = null;
}

function schedule(match: Match, delayMs: number, callback: () => void): void {
  clearTimer(match);
  const delay = Math.max(0, delayMs);
  match.deadlineAt = Date.now() + delay;
  match.timer = setTimeout(() => { match.timer = null; match.deadlineAt = null; callback(); }, delay);
}

function pauseMatch(match: Match): void {
  if (match.paused || match.phase === 'ended') return;
  if (match.phase === 'playing') {
    const now = Date.now();
    for (const progress of match.progress.values()) {
      if (!progress.completed && progress.startedAt > 0) { progress.elapsedBeforePause += now - progress.startedAt; progress.startedAt = 0; }
      if (!progress.completed && progress.trialStartedAt > 0) { progress.trialElapsedBeforePause += now - progress.trialStartedAt; progress.trialStartedAt = 0; }
    }
  }
  match.pausedRemainingMs = match.deadlineAt === null ? null : Math.max(0, match.deadlineAt - Date.now());
  clearTimer(match);
  match.paused = true;
}

function resumeMatch(io: Server, match: Match): void {
  if (!match.paused || match.phase === 'ended') return;
  match.paused = false;
  const remaining = match.pausedRemainingMs ?? 0;
  match.pausedRemainingMs = null;
  if (match.phase === 'playing') for (const progress of match.progress.values()) if (!progress.completed) { progress.startedAt = Date.now(); if (progress.trial) progress.trialStartedAt = Date.now(); }
  if (match.phase === 'countdown') schedule(match, remaining, () => beginChallenge(io, match));
  else if (match.phase === 'playing') { for (const player of match.players) emitTrial(io, match, player.id); schedule(match, remaining, () => finishChallenge(io, match)); }
  else if (match.phase === 'result') schedule(match, remaining, () => nextChallenge(io, match));
}

function publicState(match: Match) {
  return {
    matchId: match.id, phase: match.phase, challengeIndex: match.index, challengeCount: match.order.length,
    challenge: match.current, scores: scorePayload(match), paused: match.paused,
    remainingMs: match.paused ? match.pausedRemainingMs : remainingUntil(match.deadlineAt, Date.now()),
  };
}

function emitState(io: Server, match: Match, target?: Socket): void {
  const state = publicState(match);
  if (target) target.emit('challenge-rush:state', state);
  else emitArcadeRoom(io, match.room, 'challenge-rush:state', state, match);
  broadcastArcadeKiosk(io, { gameType: 'challenge-rush', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: match.phase, challenge: match.current.title, challengeIndex: match.index, challengeCount: match.order.length, scores: state.scores, paused: match.paused });
}

function beginChallenge(io: Server, match: Match): void {
  if (match.phase !== 'countdown' || match.paused) return;
  match.phase = 'playing';
  const now = Date.now();
  for (const [playerId, progress] of match.progress) { progress.startedAt = now; progress.elapsedBeforePause = 0; progress.trialIndex = 0; progress.streak = 0; progress.rawScore = 0; progress.trials = 0; progress.correct = 0; progress.errors = 0; progress.partialHits = 0; progress.trial = null; progress.seenSymbols.clear(); progress.symbolHistory = []; startPlayerTrial(io, match, progress, playerId); }
  schedule(match, match.current.durationMs, () => finishChallenge(io, match));
  emitState(io, match);
}

function finishChallenge(io: Server, match: Match): void {
  if (match.phase !== 'playing' || match.paused) return;
  match.phase = 'result';
  clearTimer(match);
  for (const player of match.players) {
    const progress = match.progress.get(player.id)!;
    if (!progress.completed) { progress.score = challengeScore(progress, match.current.key, match.current.durationMs); progress.completed = true; }
    match.scores.set(player.id, (match.scores.get(player.id) ?? 0) + progress.score);
  }
  emitState(io, match);
  emitArcadeRoom(io, match.room, 'challenge-rush:challenge:end', { matchId: match.id, scores: scorePayload(match) }, match);
  schedule(match, RESULT_PAUSE_MS, () => nextChallenge(io, match));
}

function nextChallenge(io: Server, match: Match): void {
  if (matches.get(match.id) !== match || match.phase === 'ended') return;
  if (match.index + 1 >= match.order.length) return finishMatch(io, match);
  match.index += 1;
  match.phase = 'countdown';
  match.current = challengePayload(match.order[match.index], (match.seed + match.index * 7919) >>> 0);
  match.progress = new Map(match.players.map((player) => [player.id, freshProgress()]));
  emitState(io, match);
  schedule(match, arcadeTiming.countdownMs, () => beginChallenge(io, match));
}

function cleanupMatch(io: Server, match: Match): void {
  for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
  match.reconnectTimers.clear();
  matches.delete(match.id);
  for (const socketId of match.socketIds.values()) io.sockets.sockets.get(socketId)?.leave(match.room);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
}

function finishMatch(io: Server, match: Match, reason = 'completed'): void {
  if (match.phase === 'ended') return;
  match.phase = 'ended'; clearTimer(match);
  const scores = scorePayload(match);
  const winnerId = reason === 'completed' ? winnerIdForScores(scores.filter((score) => !score.forfeited)) : null;
  endArcadeSession(real(match.players), 'challenge-rush', match);
  recordArcadeResult({ gameType: 'challenge-rush', winnerId, players: match.players, scores: scores.map((score) => ({ ...score, isWinner: winnerId !== null && score.playerId === winnerId })), reason, startedAt: match.startedAt, scope: match });
  emitArcadeRoom(io, match.room, 'challenge-rush:match:end', { matchId: match.id, winnerId, scores, draw: winnerId === null && reason === 'completed', reason }, match);
  broadcastArcadeKiosk(io, { gameType: 'challenge-rush', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: 'ended', scores });
  setTimeout(() => cleanupMatch(io, match), END_REVEAL_MS).unref();
}

function attachSocket(io: Server, socket: Socket, match: Match, playerId: string): void {
  const previousTimer = match.reconnectTimers.get(playerId);
  if (previousTimer) clearTimeout(previousTimer);
  match.reconnectTimers.delete(playerId);
  const previousSocketId = match.socketIds.get(playerId);
  if (previousSocketId && previousSocketId !== socket.id) io.sockets.sockets.get(previousSocketId)?.leave(match.room);
  match.socketIds.set(playerId, socket.id);
  socket.join(match.room);
  socket.emit('challenge-rush:match:start', { matchId: match.id, host: match.host, players: match.players, challengeCount: match.order.length, reconnectToken: match.reconnectTokens.get(playerId), reconnected: true });
  emitState(io, match, socket);
  if (match.phase === 'playing') emitTrial(io, match, playerId, socket);
}

function startMatch(io: Server, lobby: Lobby): Match {
  const id = nanoid(); const room = `challenge-rush:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const seed = Math.floor(Math.random() * 0x7fffffff); const order = challengeOrder(seed);
  const match: Match = { id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players], socketIds: new Map(lobby.socketIds), order, index: -1, phase: 'countdown', seed, current: challengePayload(order[0], seed), progress: new Map(), scores: new Map(lobby.players.map((player) => [player.id, 0])), startedAt: Date.now(), timer: null, deadlineAt: null, pausedRemainingMs: null, paused: false, reconnectTimers: new Map(), reconnectTokens: new Map(lobby.players.map((player) => [player.id, nanoid()])), forfeited: new Set() };
  matches.set(id, match); releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); emitLobbies(io);
  startArcadeSession(real(match.players), 'challenge-rush', match);
  for (const player of match.players) {
    const playerSocket = io.sockets.sockets.get(match.socketIds.get(player.id) ?? '');
    if (playerSocket && canUseLobby(playerSocket, match)) playerSocket.emit('challenge-rush:match:start', { matchId: id, host: match.host, players: match.players, challengeCount: order.length, reconnectToken: match.reconnectTokens.get(player.id) });
  }
  nextChallenge(io, match); return match;
}

function removeDisconnectedLobbySocket(io: Server, socketId: string): void {
  for (const [id, lobby] of lobbies) {
    const player = [...lobby.socketIds.entries()].find(([, connectedSocketId]) => connectedSocketId === socketId);
    if (!player) continue;
    if (player[0] === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((entry) => entry.id), 'challenge-rush', id); lobbies.delete(id); }
    else { releaseLobbyMembership(player[0], 'challenge-rush', id); lobby.players = lobby.players.filter((entry) => entry.id !== player[0]); lobby.socketIds.delete(player[0]); lobby.ready.delete(player[0]); }
  }
  emitLobbies(io);
}

export function registerChallengeRushSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const sendLobbies = () => { const scope = socketArcadeScope(socket); if (scope) socket.emit('challenge-rush:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); };
    sendLobbies(); socket.on('challenge-rush:lobbies:get', sendLobbies); socket.on('scope:subscribe', sendLobbies); socket.on('room:subscribe', sendLobbies);
    const authPlayerId = socket.data.authPlayerId;
    if (typeof authPlayerId === 'string') for (const match of matches.values()) if (match.players.some((player) => player.id === authPlayerId) && canUseLobby(socket, match)) attachSocket(io, socket, match, authPlayerId);
    socket.on('challenge-rush:match:reconnect', (payload: { matchId?: string; playerId?: string; reconnectToken?: string }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; const playerId = payload?.playerId; const authenticated = typeof socket.data.authPlayerId === 'string'; const identityMatches = authenticated ? socket.data.authPlayerId === playerId : (!socket.data.challengeRushPlayerId || socket.data.challengeRushPlayerId === playerId); if (!match || !playerId || !match.players.some((player) => player.id === playerId) || payload.reconnectToken !== match.reconnectTokens.get(playerId) || !identityMatches || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match-Wiederaufnahme verweigert.' }); if (!authenticated) socket.data.challengeRushPlayerId = playerId; attachSocket(io, socket, match, playerId); ack?.({ ok: true }); });
    socket.on('challenge-rush:trial:get', (payload: { matchId?: string; playerId?: string; challengeIndex?: number }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; const playerId = payload?.playerId; if (!match || match.phase !== 'playing' || !playerId || !owns(socket, playerId) || match.socketIds.get(playerId) !== socket.id || !canUseLobby(socket, match) || !isCurrentChallenge(payload.challengeIndex ?? -1, match.index)) return ack?.({ ok: false, error: 'Trial konnte nicht aktualisiert werden.' }); emitTrial(io, match, playerId, socket); ack?.({ ok: true }); });

    socket.on('challenge-rush:lobby:create', (payload: { playerId?: string }, ack?: (r: unknown) => void) => { const player = playerById(payload?.playerId); const scope = player ? socketArcadeScope(socket, player.id) : null; if (!player || !scope || !bindPlayer(socket, player.id)) return ack?.({ ok: false, error: 'Spieler- oder Gruppenzugriff verweigert.' }); const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now() }; if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' }); lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id }); });
    socket.on('challenge-rush:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; const player = playerById(payload?.playerId); if (!lobby || !player || !canJoinLobby(socket, lobby, player.id) || !bindPlayer(socket, player.id)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' }); if (!lobby.players.some((entry) => entry.id === player.id) && lobby.players.length >= MAX_PLAYERS) return ack?.({ ok: false, error: 'Lobby ist voll.' }); if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' }); if (!lobby.players.some((entry) => entry.id === player.id)) lobby.players.push(player); lobby.socketIds.set(player.id, socket.id); emitLobbies(io); ack?.({ ok: true }); });
    socket.on('challenge-rush:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' }); if (payload.playerId === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); } else { releaseLobbyMembership(payload.playerId, 'challenge-rush', lobby.id); lobby.players = lobby.players.filter((player) => player.id !== payload.playerId); lobby.socketIds.delete(payload.playerId); lobby.ready.delete(payload.playerId); } emitLobbies(io); ack?.({ ok: true }); });
    socket.on('challenge-rush:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId) || !setLobbyReady(lobby, payload.playerId, payload.ready)) return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' }); emitLobbies(io); ack?.({ ok: true }); });
    socket.on('challenge-rush:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId) || payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' }); if (lobby.players.length < 1 || lobby.players.some((player) => !isLobbyReady(lobby, player.id))) return ack?.({ ok: false, error: 'Alle Mitspieler müssen bereit sein.' }); const match = startMatch(io, lobby); ack?.({ ok: true, matchId: match.id }); });
    socket.on('challenge-rush:challenge:input', (payload: { matchId?: string; playerId?: string; challengeIndex?: number; trialId?: string; action?: string; value?: unknown }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null; const p = match && payload.playerId ? match.progress.get(payload.playerId) : null;
      if (!match || match.phase !== 'playing' || match.paused || !p || !owns(socket, payload.playerId) || match.socketIds.get(payload.playerId!) !== socket.id || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
      const progress = () => ({ ok: true, progress: progressPayload(p), trial: trialPayload(p) });
      if (!isCurrentChallenge(payload.challengeIndex ?? -1, match.index)) return ack?.({ ...progress(), ignored: true, reason: 'stale-challenge' });
      if (p.trial && (typeof payload.trialId !== 'string' || payload.trialId !== p.trial.trialId)) return ack?.({ ...progress(), ignored: true, reason: 'stale-trial' });
      const now = Date.now(); if (p.completed) return ack?.({ ...progress(), duplicate: true }); if (now - p.lastInputAt < 30) return ack?.({ ...progress(), ignored: true }); p.lastInputAt = now;
      if (match.current.key === 'cps') { if (payload.action !== 'click') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) }); p.clicks += 1; return ack?.({ ...progress(), accepted: true }); }

      const trial = p.trial;
      if (!trial) return ack?.({ ok: false, error: 'Kein aktiver Trial.' });
      const elapsed = Math.min(trialElapsed(p, now), match.current.durationMs);
      if (trial.phase === 'preview' && elapsed < trial.phaseMs) {
        if (match.current.key === 'traffic-light' && payload.action === 'click') {
          finishPlayerTrial(io, match, p, payload.playerId!, 0, false, 1);
          return ack?.({ ...progress(), accepted: true, correct: false, falseStart: true });
        }
        return ack?.({ ok: false, error: 'Die Vorschau läuft noch.', progress: progressPayload(p) });
      }
      if (trial.phase === 'preview') trial.phase = 'input';
      const responseElapsed = Math.max(0, elapsed - trial.phaseMs);
      if (typeof trial.inputMs === 'number' && (responseElapsed >= trial.inputMs || payload.action === 'timeout')) {
        if (payload.action === 'timeout' && responseElapsed + 50 < trial.inputMs) return ack?.({ ...progress(), ignored: true, reason: 'early-timeout' });
        finishPlayerTrial(io, match, p, payload.playerId!, 0, false, 1);
        return ack?.({ ...progress(), accepted: true, correct: false, timedOut: true });
      }

      if (match.current.key === 'reaction-circle') {
        const point = payload.value && typeof payload.value === 'object' ? payload.value as { x?: unknown; y?: unknown } : {};
        const target = trial.expected as { x?: number; y?: number };
        const valid = payload.action === 'hit' && typeof point.x === 'number' && typeof point.y === 'number' && Math.abs(point.x - Number(target.x)) <= 12 && Math.abs(point.y - Number(target.y)) <= 12;
        if (!valid) return ack?.({ ok: false, error: 'Ungültiges Ziel.', progress: progressPayload(p) });
        finishPlayerTrial(io, match, p, payload.playerId!, scoreReaction(elapsed), true); return ack?.({ ...progress(), accepted: true });
      }
      if (match.current.key === 'number-salad') {
        const expected = Number((trial.state.correct as number | undefined) ?? 0) + 1;
        if (payload.action !== 'number' || typeof payload.value !== 'number' || !Number.isInteger(payload.value) || payload.value !== expected) { finishPlayerTrial(io, match, p, payload.playerId!, 0, false, 1); return ack?.({ ...progress(), accepted: true }); }
        trial.state.correct = expected; p.partialHits += 1;
        if (expected >= 8) finishPlayerTrial(io, match, p, payload.playerId!, 70 + difficultyFor(p.streak) * 5, true);
        return ack?.({ ...progress(), accepted: true });
      }
      if (match.current.key === 'timing-10') {
        if (payload.action !== 'stop') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) });
        const score = scoreTiming10(elapsed); p.rawScore += score; p.trials += 1; p.streak = score >= 70 ? p.streak + 1 : 0; p.trialIndex += 1; p.trial = null; startPlayerTrial(io, match, p, payload.playerId!); return ack?.({ ...progress(), accepted: true });
      }

      let action = payload.action ?? '';
      let value = payload.value;
      if (match.current.key === 'memory-pairs' && action === 'reveal') {
        const index = value;
        const board = trial.expected as string[];
        const found = Array.isArray(trial.state.found) ? trial.state.found as number[] : [];
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= board.length || found.includes(index)) return ack?.({ ok: false, error: 'Ungültige Karte.', progress: progressPayload(p) });
        const revealed = Array.isArray(trial.state.revealed) ? trial.state.revealed as number[] : [];
        if (revealed.length === 0) {
          trial.state.revealed = [index];
          return ack?.({ ...progress(), accepted: true, correct: null, revealedCards: [{ index, value: board[index] }] });
        }
        if (revealed[0] === index) return ack?.({ ok: false, error: 'Karte ist bereits aufgedeckt.', progress: progressPayload(p) });
        value = [revealed[0], index];
        action = 'pair';
        trial.state.revealed = [];
      }
      const result = validateTrialInput(match.current.key, trial, action, value, responseElapsed);
      if (!result.accepted) return ack?.({ ok: false, error: result.error, progress: progressPayload(p) });
      if ((match.current.key === 'memory-pairs' || match.current.key === 'whack-a-mole') && !result.complete) {
        p.errors += result.errors;
        if (result.correct) p.partialHits += 1;
        const revealedCards = match.current.key === 'memory-pairs' && Array.isArray(value)
          ? value.map((index) => ({ index, value: (trial.expected as string[])[Number(index)] }))
          : undefined;
        return ack?.({ ...progress(), accepted: true, correct: result.correct, revealedCards });
      }
      if (result.complete) finishPlayerTrial(io, match, p, payload.playerId!, result.rawScore, result.correct, result.errors);
      return ack?.({ ...progress(), accepted: true, correct: result.correct });
    });
    socket.on('challenge-rush:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; if (!match || !['countdown', 'playing', 'result'].includes(match.phase) || payload.playerId !== match.host.id || !owns(socket, payload.playerId) || match.socketIds.get(payload.playerId) !== socket.id || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Pause ist in dieser Phase nicht möglich.' }); if (match.paused) resumeMatch(io, match); else pauseMatch(match); emitState(io, match); ack?.({ ok: true, paused: match.paused, remainingMs: match.pausedRemainingMs }); });
    socket.on('challenge-rush:match:end', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; if (!match || match.phase === 'ended' || payload.playerId !== match.host.id || !owns(socket, payload.playerId) || match.socketIds.get(payload.playerId) !== socket.id || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match konnte nicht beendet werden.' }); finishMatch(io, match, 'aborted'); ack?.({ ok: true }); });
    socket.on('disconnect', () => {
      removeDisconnectedLobbySocket(io, socket.id);
      for (const match of matches.values()) for (const [playerId, socketId] of match.socketIds) if (socketId === socket.id) { match.socketIds.delete(playerId); const timer = setTimeout(() => { if (matches.get(match.id) !== match || match.socketIds.has(playerId) || match.phase === 'ended') return; match.reconnectTimers.delete(playerId); match.forfeited.add(playerId); const progress = match.progress.get(playerId); if (progress && !progress.completed) { progress.completed = true; progress.score = 0; } emitState(io, match); if (match.players.every((player) => match.forfeited.has(player.id))) finishMatch(io, match, 'all-forfeited'); }, reconnectGraceMs()); match.reconnectTimers.set(playerId, timer); emitState(io, match); }
    });
  });
}
