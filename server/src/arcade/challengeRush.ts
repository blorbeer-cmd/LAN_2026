import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcastArcadeKiosk } from './realtime';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { recordArcadeResult } from './arcadeData';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { notifyArcadeLobbyOpened, resolveArcadeLobbyPush } from './lobbyPush';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { challengeRushTiming } from './challengeRushTiming';
import { playerMayUseArcadeAi } from './adminAccess';
import {
  CHALLENGES, challengeOrder, challengePayload, createTrial, difficultyFor, isCurrentChallenge, isReadyForNext,
  isTrialChallenge, remainingUntil, scoreRepeatedTrials, validateTrialInput,
  scoreReaction, scoreTiming10, winnerIdForScores, previewTrialData,
  type ChallengeKey, type ChallengePayload, type InternalTrial, type TrialPayload,
} from './challengeRushLogic';

const MAX_PLAYERS = 15;
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_RESULT_READY_TIMEOUT_MS = 30_000;
const END_REVEAL_MS = 12_000;
interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby {
  id: string; groupId: string; eventId: string | null; host: Player; players: Player[];
  socketIds: Map<string, string>; ready: Set<string>; createdAt: number;
  challengeKeys: ChallengeKey[] | null;
}
interface Progress {
  errors: number; correct: number; completed: boolean; score: number;
  startedAt: number; elapsedBeforePause: number; lastInputAt: number;
  rawScore: number; trials: number; streak: number; trialIndex: number;
  trial: InternalTrial | null; trialStartedAt: number; trialElapsedBeforePause: number;
  // Server-side end of the current trial's 'preview' (memorize) phase. Without
  // it the switch to 'input' would depend solely on the client's own
  // setTimeout re-requesting the trial, which browsers throttle or suspend in
  // a backgrounded tab — a phone that locks mid-preview would then sit on the
  // memorize screen until the whole challenge deadline expired. Cleared on
  // pause and re-armed from the already-frozen trial elapsed on resume, the
  // same way the challenge deadline itself is handled.
  previewTimer: NodeJS.Timeout | null;
}
interface HistoryEntry { key: ChallengeKey; title: string; scores: Array<{ playerId: string; name: string; score: number }> }
interface Match {
  id: string; groupId: string; eventId: string | null; room: string; host: Player; players: Player[]; socketIds: Map<string, string>;
  order: ChallengeKey[]; index: number; phase: 'countdown' | 'playing' | 'result' | 'ended'; seed: number;
  current: ReturnType<typeof challengePayload>; progress: Map<string, Progress>; scores: Map<string, number>;
  startedAt: number; timer: NodeJS.Timeout | null; deadlineAt: number | null; pausedRemainingMs: number | null; paused: boolean;
  reconnectTimers: Map<string, NodeJS.Timeout>; forfeited: Set<string>; readyNext: Set<string>; history: HistoryEntry[];
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const challengeCatalog = CHALLENGES.map(({ key, title, description }) => ({ key, title, description }));
const challengeKeySet = new Set<ChallengeKey>(CHALLENGES.map(({ key }) => key));
const playerIds = (players: Player[]) => players.map((player) => player.id);
const playerById = (id: unknown): Player | null => typeof id === 'string' ? (db.prepare('SELECT id,name,avatar,color FROM players WHERE id=?').get(id) as Player | undefined) ?? null : null;
const owns = (socket: Socket, id: unknown): id is string => typeof id === 'string' && Boolean(socketArcadeScope(socket, id));
const hasActiveMatch = (playerId: string): boolean => [...matches.values()].some(
  (match) => match.phase !== 'ended'
    && !match.forfeited.has(playerId)
    && match.players.some((player) => player.id === playerId),
);
const publicLobbies = (groupId: string, eventId: string | null) => [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({ id: l.id, host: l.host, players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })), createdAt: l.createdAt, challengeKeys: l.challengeKeys }));
const reconnectGraceMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(60_000, configured)) : DEFAULT_RECONNECT_GRACE_MS; };
const resultReadyTimeoutMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RESULT_TIMEOUT_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(120_000, configured)) : DEFAULT_RESULT_READY_TIMEOUT_MS; };
const isE2EFastTest = (): boolean => process.env.NODE_ENV === 'test' && process.env.E2E_FAST_TIMERS === '1';
const isFastTest = (): boolean => process.env.NODE_ENV === 'test' && (challengeRushTiming().challengeDurationMs !== null || isE2EFastTest());

function normalizeChallengeSelection(value: unknown): ChallengeKey[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return null;
  if (value.length > CHALLENGES.length) return undefined;
  const unique = [...new Set(value)];
  if (unique.some((key) => typeof key !== 'string' || !challengeKeySet.has(key as ChallengeKey))) return undefined;
  return unique as ChallengeKey[];
}

function lobbyPayload(groupId: string, eventId: string | null) {
  return { lobbies: publicLobbies(groupId, eventId), challenges: challengeCatalog };
}

function runtimeChallengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const payload = challengePayload(key, seed);
  const timing = challengeRushTiming();
  if (timing.challengeDurationMs === null) return payload;
  return { ...payload, durationMs: timing.challengeDurationMs };
}

function freshProgress(completed = false): Progress {
  return {
    errors: 0, correct: 0, completed, score: 0, startedAt: 0, elapsedBeforePause: 0, lastInputAt: 0,
    rawScore: 0, trials: 0, streak: 0, trialIndex: 0, trial: null,
    trialStartedAt: 0, trialElapsedBeforePause: 0, previewTimer: null,
  };
}

function playerSeed(match: Match, playerId: string, trialIndex: number): number {
  let hash = (match.seed ^ Math.imul(match.index + 1, 0x45d9f3b) ^ Math.imul(trialIndex + 1, 0x27d4eb2d)) >>> 0;
  for (let index = 0; index < playerId.length; index += 1) hash = Math.imul(hash ^ playerId.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

function trialElapsed(progress: Progress, now = Date.now()): number {
  return progress.trialElapsedBeforePause + (progress.trialStartedAt > 0 ? Math.max(0, now - progress.trialStartedAt) : 0);
}

function clearPreviewTimer(progress: Progress): void {
  if (progress.previewTimer) clearTimeout(progress.previewTimer);
  progress.previewTimer = null;
}

// Fires the 'preview' → 'input' switch from the server instead of waiting for
// the client to notice its own preview countdown ended and re-request the
// trial. publicTrial() still performs the switch lazily on read, so this timer
// is purely the guaranteed trigger: it makes the transition independent of a
// browser that throttled or suspended its timers while backgrounded.
function schedulePreviewPhase(io: Server, match: Match, playerId: string, progress: Progress): void {
  clearPreviewTimer(progress);
  const trial = progress.trial;
  if (!trial || trial.phase !== 'preview' || match.paused || progress.completed) return;
  const remaining = Math.max(0, trial.phaseMs - trialElapsed(progress));
  progress.previewTimer = setTimeout(() => {
    progress.previewTimer = null;
    if (matches.get(match.id) !== match || match.paused || match.phase !== 'playing') return;
    if (progress.trial !== trial || trial.phase !== 'preview' || progress.completed) return;
    if (publicTrial(progress)?.phase === 'preview') {
      schedulePreviewPhase(io, match, playerId, progress);
      return;
    }
    emitTrial(io, match, playerId);
  }, remaining);
  progress.previewTimer.unref();
}

function createPlayerTrial(io: Server, match: Match, playerId: string, progress: Progress): void {
  const difficulty = difficultyFor(progress.streak, progress.trials);
  const trial = createTrial(match.current.key, playerSeed(match, playerId, progress.trialIndex), progress.trialIndex, difficulty);
  const previewOverride = challengeRushTiming().previewMs;
  if (previewOverride !== null && trial.phase === 'preview') trial.phaseMs = previewOverride;
  clearPreviewTimer(progress);
  progress.trial = trial;
  progress.trialStartedAt = Date.now();
  progress.trialElapsedBeforePause = 0;
  schedulePreviewPhase(io, match, playerId, progress);
}

function inputTrialData(trial: InternalTrial): Record<string, unknown> {
  const type = String(trial.data.type ?? '');
  if (type === 'matrix') return { type, size: trial.data.size, highlightCount: (trial.expected as unknown[]).length };
  if (type === 'delayed-recall') return { type, prompt: trial.data.prompt, options: trial.data.options };
  return { ...trial.data };
}

function publicTrial(progress: Progress, now = Date.now()): TrialPayload | null {
  const trial = progress.trial;
  if (!trial) return null;
  let elapsed = trialElapsed(progress, now);
  if (trial.phase === 'preview' && elapsed >= trial.phaseMs) {
    trial.phase = 'input';
    progress.trialStartedAt = now;
    progress.trialElapsedBeforePause = 0;
    elapsed = 0;
  }
  return {
    trialId: trial.trialId, index: trial.index, difficulty: trial.difficulty, phase: trial.phase,
    phaseMs: trial.phaseMs, phaseRemainingMs: trial.phase === 'preview' ? Math.max(0, trial.phaseMs - elapsed) : 0,
    inputMs: trial.inputMs, inputRemainingMs: trial.phase === 'input' ? Math.max(0, trial.inputMs - elapsed) : trial.inputMs,
    resume: {}, data: trial.phase === 'preview' ? previewTrialData(trial) : inputTrialData(trial),
  };
}

function emitTrial(io: Server, match: Match, playerId: string): void {
  const socketId = match.socketIds.get(playerId);
  const progress = match.progress.get(playerId);
  if (!socketId || !progress || !isTrialChallenge(match.current.key) || match.phase !== 'playing') return;
  io.sockets.sockets.get(socketId)?.emit('challenge-rush:trial', { matchId: match.id, challengeIndex: match.index, trial: publicTrial(progress) });
}

function finishPlayerTrial(io: Server, match: Match, playerId: string, progress: Progress, result: ReturnType<typeof validateTrialInput>): void {
  progress.rawScore += result.rawScore;
  progress.trials += 1;
  progress.errors += result.errors;
  if (result.correct) {
    progress.correct += 1;
    progress.streak += 1;
  } else {
    progress.streak = 0;
  }
  progress.trialIndex += 1;
  // The existing API/E2E fast-timer profile treats one completed trial as a
  // complete challenge so the full catalog lifecycle remains practical in
  // CI. Production (where challengeDurationMs is null) always continues
  // generating trials until the shared 30-second deadline.
  if (isFastTest()) {
    progress.score = scoreRepeatedTrials(progress.rawScore, progress.trials, progress.correct, match.current.durationMs);
    progress.completed = true;
    clearPreviewTimer(progress);
    progress.trial = null;
    if ([...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
    return;
  }
  if (match.phase === 'playing' && !match.paused && !match.forfeited.has(playerId)) {
    createPlayerTrial(io, match, playerId, progress);
    emitTrial(io, match, playerId);
  } else {
    clearPreviewTimer(progress);
  }
}

function emitLobbies(io: Server): void {
  for (const socket of io.sockets.sockets.values()) {
    const scope = socketArcadeScope(socket);
    if (scope) socket.emit('challenge-rush:lobbies', lobbyPayload(scope.groupId, scope.eventId));
  }
}

function scorePayload(match: Match) {
  return match.players.map((player) => ({ playerId: player.id, name: player.name, score: match.scores.get(player.id) ?? 0, connected: match.socketIds.has(player.id), forfeited: match.forfeited.has(player.id) }));
}

function progressPayload(progress: Progress) {
  return {
    correct: progress.correct, errors: progress.errors, completed: progress.completed, score: progress.score,
    difficulty: difficultyFor(progress.streak, progress.trials), streak: progress.streak, trials: progress.trials,
  };
}

// Sent to every player so a reload/reconnect mid-challenge can restore the
// client's own step counter from the server instead of silently restarting
// it at 0 while the server has already moved past step 0 (see the frontend's
// syncProgressFromServer).
function matchProgressPayload(match: Match) {
  return match.players.map((player) => ({ playerId: player.id, ...progressPayload(match.progress.get(player.id)!) }));
}

// The wire-visible challenge payload: never the answer/target data for a
// round that hasn't started yet (data is withheld entirely during
// 'countdown').
function sanitizeChallengeForClient(match: Match): ChallengePayload {
  // The seed deterministically regenerates the entire challenge payload
  // (challengePayload/seededRandom), so it must never reach the client —
  // otherwise it would defeat the per-player round trimming in
  // challengeForPlayer, since anyone holding it can just recompute the
  // withheld rounds locally instead of waiting for the server to reveal
  // them. The client never reads `seed`, so it's always zeroed out rather
  // than conditionally included.
  if (match.phase === 'countdown') return { ...match.current, seed: 0, data: {} };
  return { ...match.current, seed: 0 };
}

function challengeForPlayer(match: Match, playerId: string): ChallengePayload {
  const sanitized = sanitizeChallengeForClient(match);
  if (match.phase !== 'playing') return sanitized;
  if (!match.progress.has(playerId)) return sanitized;
  if (isTrialChallenge(match.current.key)) return { ...sanitized, data: {} };
  return sanitized;
}

interface ChallengeInput {
  challengeIndex?: number;
  action?: string;
  value?: number | string | { x?: number; y?: number };
}

function applyChallengeInput(io: Server, match: Match, playerId: string, input: ChallengeInput): Record<string, unknown> {
  const p = match.progress.get(playerId);
  if (match.phase !== 'playing' || match.paused || !p || match.forfeited.has(playerId)) return { ok: false, error: 'Eingabe nicht möglich.' };
  const progress = () => ({ ok: true, progress: progressPayload(p) });
  if (!isCurrentChallenge(input.challengeIndex ?? -1, match.index)) return { ...progress(), ignored: true, reason: 'stale-challenge' };
  const now = Date.now();
  if (p.completed) return { ...progress(), duplicate: true };
  if (now - p.lastInputAt < 30) return { ...progress(), ignored: true };
  p.lastInputAt = now;
  const elapsed = Math.min(activeElapsed(p, now), match.current.durationMs);
  const pointValue = (): { x?: number; y?: number } => (input.value && typeof input.value === 'object' ? input.value : {});
  const hitsPoint = (target: { x?: unknown; y?: unknown }): boolean => {
    const point = pointValue();
    return typeof point.x === 'number' && typeof point.y === 'number' && Math.abs(point.x - Number(target.x)) <= 12 && Math.abs(point.y - Number(target.y)) <= 12;
  };
  if (match.current.key === 'reaction-circle') {
    if (input.action !== 'hit' || !hitsPoint(match.current.data as { x: number; y: number })) return { ok: false, error: 'Ungültiges Ziel.', progress: progressPayload(p) };
    p.score = scoreReaction(elapsed); p.completed = true;
  } else if (match.current.key === 'timing-10') {
    if (input.action !== 'stop') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    p.score = scoreTiming10(elapsed); p.completed = true;
  } else {
    return { ok: false, error: 'Nicht unterstützte Challenge.', progress: progressPayload(p) };
  }
  if ([...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
  return { ok: true, accepted: true, progress: progressPayload(p) };
}

function activeElapsed(progress: Progress, now = Date.now()): number {
  return progress.elapsedBeforePause + (progress.startedAt > 0 ? Math.max(0, now - progress.startedAt) : 0);
}

// Timer and deadline always move together: a state emitted while no timer is
// pending must report "no deadline" instead of the previous phase's leftover
// one (an old deadline would surface as a wrong countdown in the clients).
function clearTimer(match: Match): void {
  if (match.timer) clearTimeout(match.timer);
  match.timer = null;
  match.deadlineAt = null;
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
      if (!progress.completed && progress.startedAt > 0) {
        progress.elapsedBeforePause += now - progress.startedAt;
        progress.startedAt = 0;
        if (progress.trialStartedAt > 0) {
          progress.trialElapsedBeforePause += now - progress.trialStartedAt;
          progress.trialStartedAt = 0;
        }
      }
      // The trial's own elapsed is frozen above, so the preview timer needs no
      // separate remaining-ms bookkeeping: resumeMatch re-arms it from that
      // frozen elapsed.
      clearPreviewTimer(progress);
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
  if (match.phase === 'playing') {
    for (const [playerId, progress] of match.progress) {
      if (progress.completed) continue;
      progress.startedAt = Date.now();
      if (progress.trial) progress.trialStartedAt = Date.now();
      schedulePreviewPhase(io, match, playerId, progress);
      emitTrial(io, match, playerId);
    }
  }
  if (match.phase === 'countdown') schedule(match, remaining, () => beginChallenge(io, match));
  else if (match.phase === 'playing') schedule(match, remaining, () => finishChallenge(io, match));
  else if (match.phase === 'result') schedule(match, remaining, () => nextChallenge(io, match));
}

function publicState(match: Match, playerId: string) {
  return {
    matchId: match.id, phase: match.phase, challengeIndex: match.index, challengeCount: match.order.length,
    challenge: challengeForPlayer(match, playerId), scores: scorePayload(match), paused: match.paused,
    remainingMs: match.paused ? match.pausedRemainingMs : remainingUntil(match.deadlineAt, Date.now()),
    history: match.history, readyNext: match.phase === 'result' ? [...match.readyNext] : [],
    progress: matchProgressPayload(match),
  };
}

function emitState(io: Server, match: Match, target?: Socket, targetPlayerId?: string): void {
  if (target && targetPlayerId) {
    target.emit('challenge-rush:state', publicState(match, targetPlayerId));
  } else {
    for (const [playerId, socketId] of match.socketIds) {
      const socket = io.sockets.sockets.get(socketId);
      socket?.emit('challenge-rush:state', publicState(match, playerId));
    }
  }
  broadcastArcadeKiosk(io, { gameType: 'challenge-rush', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: match.phase, challenge: match.current.title, challengeIndex: match.index, challengeCount: match.order.length, scores: scorePayload(match), paused: match.paused });
}

function beginChallenge(io: Server, match: Match): void {
  if (match.phase !== 'countdown' || match.paused) return;
  match.phase = 'playing';
  const now = Date.now();
  for (const [playerId, progress] of match.progress) {
    progress.startedAt = now;
    progress.elapsedBeforePause = 0;
    if (isTrialChallenge(match.current.key) && !progress.completed) createPlayerTrial(io, match, playerId, progress);
  }
  schedule(match, match.current.durationMs, () => finishChallenge(io, match));
  emitState(io, match);
  if (isTrialChallenge(match.current.key)) for (const playerId of match.socketIds.keys()) emitTrial(io, match, playerId);
}

// Score for a player who never reached their own completion condition before
// the shared challenge deadline hit (e.g. didn't hit every aim target). Time-
// only challenges without a completable end state (reaction-circle) fall
// through to 0, matching "no reaction recorded".
function timeoutScore(key: ChallengeKey, progress: Progress, elapsedMs: number): number {
  if (isTrialChallenge(key)) return scoreRepeatedTrials(progress.rawScore, progress.trials, progress.correct, elapsedMs);
  if (key === 'timing-10') return scoreTiming10(elapsedMs);
  return 0;
}

function finishChallenge(io: Server, match: Match): void {
  if (match.phase !== 'playing' || match.paused) return;
  match.phase = 'result';
  clearTimer(match);
  match.readyNext = new Set();
  for (const player of match.players) {
    const progress = match.progress.get(player.id)!;
    if (!progress.completed) {
      const elapsed = Math.min(activeElapsed(progress), match.current.durationMs);
      progress.score = timeoutScore(match.current.key, progress, elapsed);
      progress.completed = true;
    }
    clearPreviewTimer(progress);
    match.scores.set(player.id, (match.scores.get(player.id) ?? 0) + progress.score);
  }
  match.history.push({ key: match.current.key, title: match.current.title, scores: match.players.map((player) => ({ playerId: player.id, name: player.name, score: match.progress.get(player.id)!.score })) });
  // Players confirm they've seen the result via challenge-rush:challenge:ready;
  // this is only the reliability fallback so an AFK/forgotten click can't stall the match forever.
  // Armed before the emit so the announced remainingMs belongs to this phase.
  schedule(match, resultReadyTimeoutMs(), () => nextChallenge(io, match));
  emitState(io, match);
  emitArcadeRoom(io, match.room, 'challenge-rush:challenge:end', { matchId: match.id, scores: scorePayload(match) }, match);
}

function nextChallenge(io: Server, match: Match): void {
  if (matches.get(match.id) !== match || match.phase === 'ended') return;
  if (match.index + 1 >= match.order.length) return finishMatch(io, match);
  match.index += 1;
  match.phase = 'countdown';
  match.current = runtimeChallengePayload(match.order[match.index], (match.seed + match.index * 7919) >>> 0);
  // A forfeited player's Progress entry is rebuilt below like everyone
  // else's, but starts pre-completed at score 0 instead of `completed: false`
  // — otherwise it would silently accept real input again next round and,
  // since match.players is never pruned, keep contributing to their overall
  // score despite having left.
  match.progress = new Map(match.players.map((player) => {
    const forfeited = match.forfeited.has(player.id);
    return [player.id, freshProgress(forfeited)];
  }));
  // Preserve a host pause across the result -> countdown transition. Scheduling
  // here while paused would consume the reading time in the background and
  // leave resumeMatch with the previous result phase's remaining duration.
  const countdownMs = challengeRushTiming().countdownMs;
  if (match.paused) {
    clearTimer(match);
    match.pausedRemainingMs = countdownMs;
  } else {
    schedule(match, countdownMs, () => beginChallenge(io, match));
  }
  emitState(io, match);
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
  for (const progress of match.progress.values()) clearPreviewTimer(progress);
  const scores = scorePayload(match);
  const winnerId = reason === 'completed' ? winnerIdForScores(scores.filter((score) => !score.forfeited)) : null;
  endArcadeSession(playerIds(match.players), 'challenge-rush', match);
  recordArcadeResult({ gameType: 'challenge-rush', winnerId, players: match.players, scores: scores.map((score) => ({ ...score, isWinner: winnerId !== null && score.playerId === winnerId })), reason, startedAt: match.startedAt, scope: match });
  emitArcadeRoom(io, match.room, 'challenge-rush:match:end', { matchId: match.id, winnerId, scores, draw: winnerId === null && reason === 'completed', reason, history: match.history }, match);
  broadcastArcadeKiosk(io, { gameType: 'challenge-rush', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: 'ended', scores });
  setTimeout(() => cleanupMatch(io, match), END_REVEAL_MS).unref();
}

// Shared by an explicit "Verlassen" click, the reconnect-grace timeout and a
// raw disconnect: the leaving player's current attempt is scored as 0 and
// they no longer block challenge completion or the ready gate, but the match
// keeps going for everyone else unless they were the last one left.
function forfeitPlayer(io: Server, match: Match, playerId: string): void {
  if (match.phase === 'ended' || match.forfeited.has(playerId)) return;
  const timer = match.reconnectTimers.get(playerId);
  if (timer) { clearTimeout(timer); match.reconnectTimers.delete(playerId); }
  match.forfeited.add(playerId);
  const socketId = match.socketIds.get(playerId);
  if (socketId) {
    match.socketIds.delete(playerId);
    io.sockets.sockets.get(socketId)?.leave(match.room);
  }
  const progress = match.progress.get(playerId);
  if (progress) { clearPreviewTimer(progress); if (!progress.completed) { progress.completed = true; progress.score = 0; } }
  if (match.players.every((player) => match.forfeited.has(player.id))) return finishMatch(io, match, 'all-forfeited');
  emitState(io, match);
  if (match.phase === 'playing' && [...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
  else if (match.phase === 'result' && isReadyForNext(scorePayload(match), match.readyNext)) nextChallenge(io, match);
}

function attachSocket(io: Server, socket: Socket, match: Match, playerId: string): boolean {
  if (match.forfeited.has(playerId)) return false;
  const previousTimer = match.reconnectTimers.get(playerId);
  if (previousTimer) clearTimeout(previousTimer);
  match.reconnectTimers.delete(playerId);
  match.socketIds.set(playerId, socket.id);
  socket.join(match.room);
  socket.emit('challenge-rush:match:start', { matchId: match.id, host: match.host, players: match.players, challengeCount: match.order.length, reconnected: true });
  emitState(io, match, socket, playerId);
  emitTrial(io, match, playerId);
  return true;
}

function startMatch(io: Server, lobby: Lobby): Match {
  const id = nanoid(); const room = `challenge-rush:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const order = lobby.challengeKeys
    ? [...lobby.challengeKeys]
    : challengeOrder(seed, isFastTest() ? CHALLENGES.length : 10);
  const match: Match = { id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players], socketIds: new Map(lobby.socketIds), order, index: -1, phase: 'countdown', seed, current: runtimeChallengePayload(order[0], seed), progress: new Map(), scores: new Map(lobby.players.map((player) => [player.id, 0])), startedAt: Date.now(), timer: null, deadlineAt: null, pausedRemainingMs: null, paused: false, reconnectTimers: new Map(), forfeited: new Set(), readyNext: new Set(), history: [] };
  matches.set(id, match); releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); resolveArcadeLobbyPush('challenge-rush', lobby); emitLobbies(io);
  startArcadeSession(playerIds(match.players), 'challenge-rush', match); emitArcadeRoom(io, room, 'challenge-rush:match:start', { matchId: id, host: match.host, players: match.players, challengeCount: order.length }, match); nextChallenge(io, match); return match;
}

function removeDisconnectedLobbySocket(io: Server, socketId: string): void {
  for (const [id, lobby] of lobbies) {
    const player = [...lobby.socketIds.entries()].find(([, connectedSocketId]) => connectedSocketId === socketId);
    if (!player) continue;
    if (player[0] === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((entry) => entry.id), 'challenge-rush', id); lobbies.delete(id); resolveArcadeLobbyPush('challenge-rush', lobby); }
    else { releaseLobbyMembership(player[0], 'challenge-rush', id); lobby.players = lobby.players.filter((entry) => entry.id !== player[0]); lobby.socketIds.delete(player[0]); lobby.ready.delete(player[0]); }
  }
  emitLobbies(io);
}

export function registerChallengeRushSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const sendLobbies = () => { const scope = socketArcadeScope(socket); if (scope) socket.emit('challenge-rush:lobbies', lobbyPayload(scope.groupId, scope.eventId)); };
    sendLobbies(); socket.on('challenge-rush:lobbies:get', sendLobbies); socket.on('scope:subscribe', sendLobbies); socket.on('room:subscribe', sendLobbies);
    const authPlayerId = socket.data.authPlayerId;
    if (typeof authPlayerId === 'string') for (const match of matches.values()) if (match.players.some((player) => player.id === authPlayerId)) attachSocket(io, socket, match, authPlayerId);
    socket.on('challenge-rush:match:reconnect', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; if (!match || !payload.playerId || !match.players.some((player) => player.id === payload.playerId) || !socketArcadeScope(socket, payload.playerId) || !attachSocket(io, socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Match-Wiederaufnahme verweigert.' }); ack?.({ ok: true }); });

    socket.on('challenge-rush:lobby:create', (payload: { playerId?: string; challengeKeys?: unknown }, ack?: (r: unknown) => void) => {
      const player = playerById(payload?.playerId);
      const scope = player ? socketArcadeScope(socket, player.id) : null;
      if (!player || !scope) return ack?.({ ok: false, error: 'Spieler- oder Gruppenzugriff verweigert.' });
      if (hasActiveMatch(player.id)) return ack?.({ ok: false, error: 'Beende zuerst dein laufendes Challenge-Rush-Match.' });
      const selectionRequested = Object.prototype.hasOwnProperty.call(payload ?? {}, 'challengeKeys');
      if (selectionRequested && !playerMayUseArcadeAi(player.id)) return ack?.({ ok: false, error: 'Die Aufgabenauswahl ist nur für Admins.' });
      const challengeKeys = normalizeChallengeSelection(payload?.challengeKeys);
      if (challengeKeys === undefined) return ack?.({ ok: false, error: 'Die Aufgabenauswahl ist ungültig.' });
      const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now(), challengeKeys };
      if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' });
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
      notifyArcadeLobbyOpened('challenge-rush', lobby);
    });
    socket.on('challenge-rush:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player || !canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (hasActiveMatch(player.id)) return ack?.({ ok: false, error: 'Beende zuerst dein laufendes Challenge-Rush-Match.' });
      if (!lobby.players.some((entry) => entry.id === player.id) && lobby.players.length >= MAX_PLAYERS) return ack?.({ ok: false, error: 'Lobby ist voll.' });
      if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' });
      if (!lobby.players.some((entry) => entry.id === player.id)) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('challenge-rush:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' }); if (payload.playerId === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); resolveArcadeLobbyPush('challenge-rush', lobby); } else { releaseLobbyMembership(payload.playerId, 'challenge-rush', lobby.id); lobby.players = lobby.players.filter((player) => player.id !== payload.playerId); lobby.socketIds.delete(payload.playerId); lobby.ready.delete(payload.playerId); } emitLobbies(io); ack?.({ ok: true }); });
    socket.on('challenge-rush:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId) || !setLobbyReady(lobby, payload.playerId, payload.ready)) return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' }); emitLobbies(io); ack?.({ ok: true }); });
    socket.on('challenge-rush:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId) || payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' }); if (lobby.players.length < 1 || lobby.players.some((player) => !isLobbyReady(lobby, player.id))) return ack?.({ ok: false, error: 'Alle Mitspieler müssen bereit sein.' }); const match = startMatch(io, lobby); ack?.({ ok: true, matchId: match.id }); });
    socket.on('challenge-rush:trial:get', (payload: { matchId?: string; playerId?: string; challengeIndex?: number }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      const progress = match && payload.playerId ? match.progress.get(payload.playerId) : null;
      if (!match || match.phase !== 'playing' || !progress || !owns(socket, payload.playerId) || !canUseLobby(socket, match) || !isCurrentChallenge(payload.challengeIndex ?? -1, match.index) || !isTrialChallenge(match.current.key)) {
        return ack?.({ ok: false, error: 'Trial nicht verfügbar.' });
      }
      const trial = publicTrial(progress);
      socket.emit('challenge-rush:trial', { matchId: match.id, challengeIndex: match.index, trial });
      ack?.({ ok: true, trial });
    });
    // Reaction and timing use one authoritative direct-input path. The
    // remaining challenges use per-player trials generated and validated by
    // the server.
    socket.on('challenge-rush:challenge:input', (payload: { matchId?: string; playerId?: string; challengeIndex?: number; trialId?: string; action?: string; value?: unknown }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
      if (!isTrialChallenge(match.current.key)) return ack?.(applyChallengeInput(io, match, payload.playerId as string, payload as ChallengeInput));
      const p = match.progress.get(payload.playerId as string);
      if (match.phase !== 'playing' || match.paused || !p || match.forfeited.has(payload.playerId as string)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
      const progress = () => ({ ok: true, progress: progressPayload(p) });
      if (!isCurrentChallenge(payload.challengeIndex ?? -1, match.index)) return ack?.({ ...progress(), ignored: true, reason: 'stale-challenge' });
      const visibleTrial = publicTrial(p);
      if (!p.trial || !visibleTrial || payload.trialId !== p.trial.trialId) return ack?.({ ...progress(), ignored: true, reason: 'stale-trial', trial: visibleTrial });
      const now = Date.now();
      if (p.trial.phase === 'preview') return ack?.({ ok: false, error: 'Die Vorschau läuft noch.', progress: progressPayload(p), trial: visibleTrial });
      // The throttle floor has to gate a claimed 'timeout' just like every
      // other action: a client can assert action:'timeout' regardless of
      // its actual elapsed time, so without this check first, spamming
      // that action would forfeit-and-regenerate trials (each a SHA-256-
      // backed createTrial call) at unlimited speed instead of at most
      // once per 30ms.
      if (now - p.lastInputAt < 30) return ack?.({ ...progress(), ignored: true, trial: visibleTrial });
      p.lastInputAt = now;
      if (payload.action === 'timeout' || trialElapsed(p, now) >= p.trial.inputMs) {
        finishPlayerTrial(io, match, payload.playerId as string, p, { accepted: true, complete: true, correct: false, errors: 1, rawScore: 0, error: 'Zeit abgelaufen.' });
        return ack?.({ ok: true, accepted: true, timedOut: true, progress: progressPayload(p), trial: publicTrial(p) });
      }
      const result = validateTrialInput(match.current.key, p.trial, payload.action ?? '', payload.value);
      if (!result.accepted) return ack?.({ ok: false, error: result.error, progress: progressPayload(p), trial: publicTrial(p) });
      if (result.complete) finishPlayerTrial(io, match, payload.playerId as string, p, result);
      return ack?.({ ok: true, accepted: true, correct: result.correct, progress: progressPayload(p), trial: publicTrial(p) });
    });
    socket.on('challenge-rush:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; if (!match || !['countdown', 'playing', 'result'].includes(match.phase) || payload.playerId !== match.host.id || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Pause ist in dieser Phase nicht möglich.' }); if (match.paused) resumeMatch(io, match); else pauseMatch(match); emitState(io, match); ack?.({ ok: true, paused: match.paused, remainingMs: match.pausedRemainingMs }); });
    socket.on('challenge-rush:challenge:ready', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'result' || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Bereit-Status nicht möglich.' });
      const playerId = payload.playerId as string;
      if (!match.players.some((player) => player.id === playerId) || match.forfeited.has(playerId)) return ack?.({ ok: false, error: 'Bereit-Status nicht möglich.' });
      match.readyNext.add(playerId);
      emitState(io, match);
      if (isReadyForNext(scorePayload(match), match.readyNext)) nextChallenge(io, match);
      ack?.({ ok: true });
    });
    socket.on('challenge-rush:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase === 'ended' || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Verlassen nicht möglich.' });
      const playerId = payload.playerId as string;
      if (!match.players.some((player) => player.id === playerId)) return ack?.({ ok: false, error: 'Du bist kein Teilnehmer dieses Matches.' });
      forfeitPlayer(io, match, playerId);
      ack?.({ ok: true });
    });
    socket.on('challenge-rush:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase === 'ended' || payload.playerId !== match.host.id || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finishMatch(io, match, 'ended-by-host');
      ack?.({ ok: true });
    });
    socket.on('disconnect', () => {
      removeDisconnectedLobbySocket(io, socket.id);
      for (const match of matches.values()) for (const [playerId, socketId] of match.socketIds) if (socketId === socket.id) { match.socketIds.delete(playerId); const timer = setTimeout(() => { if (matches.get(match.id) !== match || match.socketIds.has(playerId) || match.phase === 'ended') return; match.reconnectTimers.delete(playerId); forfeitPlayer(io, match, playerId); }, reconnectGraceMs()); match.reconnectTimers.set(playerId, timer); emitState(io, match); }
    });
  });
}
