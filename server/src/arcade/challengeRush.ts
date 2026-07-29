import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcastArcadeKiosk } from '../realtime';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { recordArcadeResult } from './arcadeData';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { challengeRushTiming } from './challengeRushTiming';
import {
  CHALLENGES, challengeOrder, challengePayload, createTrial, difficultyFor, isCurrentChallenge, isReadyForNext,
  isTrialChallenge, remainingUntil, scoreRepeatedTrials, seenBeforeSelection, validateTrialInput,
  scoreAimTrainer, scoreColorWord, scoreCps, scoreMemorySequence, scoreNumberSalad, scoreOddOneOut,
  scoreReaction, scoreTiming10, scoreTrafficLight, scoreWhackAMole, winnerIdForScores,
  COLOR_WORD_ROUND_COUNT, MEMORY_SEQUENCE_LENGTH, WHACK_A_MOLE_SEQUENCE_LENGTH, AIM_TRAINER_TARGET_COUNT,
  type ChallengeKey, type ChallengePayload, type InternalTrial, type TrialPayload,
} from './challengeRushLogic';

const MAX_PLAYERS = 15;
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_RESULT_READY_TIMEOUT_MS = 20_000;
const END_REVEAL_MS = 12_000;

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; groupId: string; eventId: string | null; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface Progress {
  clicks: number; errors: number; correct: number; completed: boolean; score: number;
  startedAt: number; elapsedBeforePause: number; lastInputAt: number;
  rawScore: number; trials: number; streak: number; trialIndex: number; partialHits: number;
  trial: InternalTrial | null; trialStartedAt: number; trialElapsedBeforePause: number;
  seenSymbols: string[]; symbolHistory: string[];
}
interface HistoryEntry { key: ChallengeKey; title: string; scores: Array<{ playerId: string; name: string; score: number }> }
interface Match {
  id: string; groupId: string; eventId: string | null; room: string; host: Player; players: Player[]; socketIds: Map<string, string>;
  order: ChallengeKey[]; index: number; phase: 'countdown' | 'playing' | 'result' | 'ended'; seed: number;
  current: ReturnType<typeof challengePayload>; progress: Map<string, Progress>; scores: Map<string, number>;
  startedAt: number; timer: NodeJS.Timeout | null; deadlineAt: number | null; pausedRemainingMs: number | null; paused: boolean;
  reconnectTimers: Map<string, NodeJS.Timeout>; forfeited: Set<string>; readyNext: Set<string>; history: HistoryEntry[];
  // Separate from `timer`/`deadlineAt` (which drive the challenge's overall
  // deadline): a second, independently pausable countdown that only exists
  // while the current challenge is 'traffic-light', so the exact green
  // moment is a server push instead of client-known data (see
  // scheduleGreenLight below).
  greenTimer: NodeJS.Timeout | null; greenDeadlineAt: number | null; greenPausedRemainingMs: number | null;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const real = (players: Player[]) => players.filter((player) => !player.id.startsWith('bot-')).map((player) => player.id);
const playerById = (id: unknown): Player | null => typeof id === 'string' ? (db.prepare('SELECT id,name,avatar,color FROM players WHERE id=?').get(id) as Player | undefined) ?? null : null;
const owns = (socket: Socket, id: unknown): id is string => typeof id === 'string' && Boolean(socketArcadeScope(socket, id));
const publicLobbies = (groupId: string, eventId: string | null) => [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({ id: l.id, host: l.host, players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })), createdAt: l.createdAt }));
const reconnectGraceMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(60_000, configured)) : DEFAULT_RECONNECT_GRACE_MS; };
const resultReadyTimeoutMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RESULT_TIMEOUT_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(120_000, configured)) : DEFAULT_RESULT_READY_TIMEOUT_MS; };
const isE2EFastTest = (): boolean => process.env.NODE_ENV === 'test' && process.env.E2E_FAST_TIMERS === '1';
const isFastTest = (): boolean => process.env.NODE_ENV === 'test' && (challengeRushTiming().challengeDurationMs !== null || isE2EFastTest());

function runtimeChallengePayload(key: ChallengeKey, seed: number): ChallengePayload {
  const payload = challengePayload(key, seed);
  const timing = challengeRushTiming();
  if (timing.challengeDurationMs === null) return payload;
  const data = key === 'traffic-light'
    ? { ...payload.data, greenAtMs: timing.trafficLightGreenMs }
    : payload.data;
  return { ...payload, durationMs: timing.challengeDurationMs, data };
}

function freshProgress(completed = false): Progress {
  return {
    clicks: 0, errors: 0, correct: 0, completed, score: 0, startedAt: 0, elapsedBeforePause: 0, lastInputAt: 0,
    rawScore: 0, trials: 0, streak: 0, trialIndex: 0, partialHits: 0, trial: null,
    trialStartedAt: 0, trialElapsedBeforePause: 0, seenSymbols: [], symbolHistory: [],
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

function createPlayerTrial(match: Match, playerId: string, progress: Progress): void {
  const difficulty = difficultyFor(progress.streak);
  const trial = createTrial(match.current.key, playerSeed(match, playerId, progress.trialIndex), progress.trialIndex, difficulty, progress.symbolHistory);
  if (match.current.key === 'seen-before') {
    const selected = seenBeforeSelection(Boolean(trial.expected), progress.seenSymbols, progress.trialIndex);
    progress.seenSymbols = selected.seenSymbols;
    trial.data = { ...trial.data, symbol: selected.symbol };
    trial.expected = selected.repeated;
  } else if (match.current.key === 'n-back') {
    const symbol = String(trial.data.symbol ?? '');
    if (symbol) progress.symbolHistory.push(symbol);
  }
  progress.trial = trial;
  progress.trialStartedAt = Date.now();
  progress.trialElapsedBeforePause = 0;
}

function inputTrialData(trial: InternalTrial): Record<string, unknown> {
  const type = String(trial.data.type ?? '');
  if (type === 'sequence') return { type, size: trial.data.size, sequenceLength: (trial.expected as unknown[]).length };
  if (type === 'matrix') return { type, size: trial.data.size, highlightCount: (trial.expected as unknown[]).length };
  if (type === 'number-blind') return { type, size: trial.data.size, numberCount: (trial.expected as unknown[]).length };
  if (type === 'path') return { type, size: trial.data.size, pathLength: (trial.expected as unknown[]).length };
  if (type === 'missing') return { type, items: trial.data.items, options: trial.data.options };
  if (type === 'delayed-recall') return { type, prompt: trial.data.prompt, options: trial.data.options };
  if (type === 'suitcase') return { type, position: trial.data.position, options: trial.data.options };
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
  const board = Array.isArray(trial.expected) ? trial.expected as string[] : [];
  const found = Array.isArray(trial.state.found) ? trial.state.found as number[] : [];
  const revealed = Array.isArray(trial.state.revealed) ? trial.state.revealed as number[] : [];
  const resume = String(trial.data.type ?? '') === 'pairs'
    ? {
        found, revealed,
        foundCards: found.map((index) => ({ index, value: board[index] })),
        revealedCards: revealed.map((index) => ({ index, value: board[index] })),
        revealSeq: Number(trial.state.revealSeq ?? 0),
      }
    : {};
  return {
    trialId: trial.trialId, index: trial.index, difficulty: trial.difficulty, phase: trial.phase,
    phaseMs: trial.phaseMs, phaseRemainingMs: trial.phase === 'preview' ? Math.max(0, trial.phaseMs - elapsed) : 0,
    inputMs: trial.inputMs, inputRemainingMs: trial.phase === 'input' ? Math.max(0, trial.inputMs - elapsed) : trial.inputMs,
    resume, data: trial.phase === 'preview' ? { ...trial.data } : inputTrialData(trial),
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
  progress.partialHits += result.complete ? 0 : Number(result.correct);
  if (result.correct) {
    progress.correct += 1;
    progress.streak += 1;
  } else {
    progress.streak = 0;
  }
  progress.trialIndex += 1;
  // The existing API/E2E fast-timer profile treats one completed trial as a
  // complete challenge so the full forty-game lifecycle remains practical in
  // CI. Production (where challengeDurationMs is null) always continues
  // generating trials until the shared 30-second deadline.
  if (isFastTest()) {
    progress.score = scoreRepeatedTrials(progress.rawScore, progress.trials, progress.correct, progress.partialHits, match.current.durationMs);
    progress.completed = true;
    progress.trial = null;
    if ([...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
    return;
  }
  if (match.phase === 'playing' && !match.paused && !match.forfeited.has(playerId)) {
    createPlayerTrial(match, playerId, progress);
    emitTrial(io, match, playerId);
  }
}

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
  return {
    clicks: progress.clicks, correct: progress.correct, errors: progress.errors, completed: progress.completed, score: progress.score,
    difficulty: difficultyFor(progress.streak), streak: progress.streak, trials: progress.trials, partialHits: progress.partialHits,
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
// 'countdown'), and never traffic-light's exact green delay at any point —
// that transition is a dedicated server push (see scheduleGreenLight)
// instead of client-computed data, so no script can pre-calculate the exact
// reaction window.
function sanitizeChallengeForClient(match: Match): ChallengePayload {
  // The seed deterministically regenerates the entire challenge payload
  // (challengePayload/seededRandom), so it must never reach the client —
  // otherwise it would defeat every other redaction below and the
  // per-player step trimming in challengeForPlayer, since anyone holding it
  // can just recompute the withheld targets/sequence/rounds/greenAtMs
  // locally instead of waiting for the server to reveal them. The client
  // never reads `seed`, so it's always zeroed out rather than conditionally
  // included.
  if (match.phase === 'countdown') return { ...match.current, seed: 0, data: {} };
  if (match.current.key === 'traffic-light') {
    const { greenAtMs: _greenAtMs, ...safeData } = match.current.data as { greenAtMs?: number };
    return { ...match.current, seed: 0, data: safeData };
  }
  return { ...match.current, seed: 0 };
}

// Per-recipient view of the current challenge: aim-trainer, whack-a-mole and
// color-word each hold a full array of future targets/holes/rounds server-
// side, but a player is only ever meant to see the one they're currently on
// — sending the whole array during 'playing' would let a script read every
// remaining answer at once and blast through the 30ms input floor for a
// guaranteed-perfect score. memory-sequence and odd-one-out are
// intentionally excluded: the former's whole point is the player seeing and
// memorizing the sequence via the reveal animation, and the latter's
// oddIndex is required just to render which tile looks different.
function challengeForPlayer(match: Match, playerId: string): ChallengePayload {
  const sanitized = sanitizeChallengeForClient(match);
  if (match.phase !== 'playing') return sanitized;
  const p = match.progress.get(playerId);
  if (!p) return sanitized;
  if (isTrialChallenge(match.current.key)) return { ...sanitized, data: {} };
  if (match.current.key === 'aim-trainer') {
    const { targets, ...rest } = sanitized.data as { targets: Array<{ x: number; y: number }> };
    return { ...sanitized, data: { ...rest, target: targets[p.correct] ?? null } };
  }
  if (match.current.key === 'whack-a-mole') {
    const { sequence, ...rest } = sanitized.data as { sequence: number[] };
    return { ...sanitized, data: { ...rest, activeHole: sequence[p.correct] ?? null } };
  }
  if (match.current.key === 'color-word') {
    const { rounds, ...rest } = sanitized.data as { rounds: Array<{ word: string; textColor: string; options: string[] }> };
    return { ...sanitized, data: { ...rest, round: rounds[p.correct + p.errors] ?? null } };
  }
  return sanitized;
}

// The next step's data for whichever challenge just accepted an input —
// merged into the client's local state from the input ack (see
// registerChallengeRushSockets' challenge-rush:challenge:input handler)
// instead of waiting for a full state broadcast, since individual accepted
// inputs don't otherwise trigger one.
function nextStepPayload(match: Match, p: Progress): Record<string, unknown> | undefined {
  if (match.current.key === 'aim-trainer') { const targets = (match.current.data as { targets: Array<{ x: number; y: number }> }).targets; return { target: targets[p.correct] ?? null }; }
  if (match.current.key === 'whack-a-mole') { const sequence = (match.current.data as { sequence: number[] }).sequence; return { activeHole: sequence[p.correct] ?? null }; }
  if (match.current.key === 'color-word') { const rounds = (match.current.data as { rounds: Array<{ word: string; textColor: string; options: string[] }> }).rounds; return { round: rounds[p.correct + p.errors] ?? null }; }
  return undefined;
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

function clearGreenTimer(match: Match): void {
  if (match.greenTimer) clearTimeout(match.greenTimer);
  match.greenTimer = null;
}

function scheduleGreenLight(io: Server, match: Match, delayMs: number): void {
  clearGreenTimer(match);
  const delay = Math.max(0, delayMs);
  match.greenDeadlineAt = Date.now() + delay;
  match.greenTimer = setTimeout(() => {
    match.greenTimer = null;
    match.greenDeadlineAt = null;
    emitArcadeRoom(io, match.room, 'challenge-rush:traffic-light:green', { matchId: match.id, challengeIndex: match.index }, match);
  }, delay);
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
    }
  }
  match.pausedRemainingMs = match.deadlineAt === null ? null : Math.max(0, match.deadlineAt - Date.now());
  clearTimer(match);
  if (match.greenTimer) {
    match.greenPausedRemainingMs = match.greenDeadlineAt === null ? null : Math.max(0, match.greenDeadlineAt - Date.now());
    clearGreenTimer(match);
  }
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
      emitTrial(io, match, playerId);
    }
  }
  if (match.phase === 'countdown') schedule(match, remaining, () => beginChallenge(io, match));
  else if (match.phase === 'playing') schedule(match, remaining, () => finishChallenge(io, match));
  else if (match.phase === 'result') schedule(match, remaining, () => nextChallenge(io, match));
  if (match.phase === 'playing' && match.greenPausedRemainingMs !== null) {
    const remainingGreen = match.greenPausedRemainingMs;
    match.greenPausedRemainingMs = null;
    scheduleGreenLight(io, match, remainingGreen);
  }
}

// trafficLightGreen tells every player whether the light has already turned
// green, independent of any single client having received (or missed, via a
// reload/reconnect) the one-shot 'challenge-rush:traffic-light:green' push —
// it's derived from whether the green timer has already fired, not from the
// hidden greenAtMs delay itself, so it reveals nothing before the fact.
function publicState(match: Match, playerId: string) {
  return {
    matchId: match.id, phase: match.phase, challengeIndex: match.index, challengeCount: match.order.length,
    challenge: challengeForPlayer(match, playerId), scores: scorePayload(match), paused: match.paused,
    remainingMs: match.paused ? match.pausedRemainingMs : remainingUntil(match.deadlineAt, Date.now()),
    history: match.history, readyNext: match.phase === 'result' ? [...match.readyNext] : [],
    progress: matchProgressPayload(match),
    trafficLightGreen: match.phase === 'playing' && match.current.key === 'traffic-light' && match.greenTimer === null && match.greenPausedRemainingMs === null,
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
    if (isTrialChallenge(match.current.key) && !progress.completed) createPlayerTrial(match, playerId, progress);
  }
  schedule(match, match.current.durationMs, () => finishChallenge(io, match));
  if (match.current.key === 'traffic-light') {
    const greenAtMs = Number((match.current.data as { greenAtMs?: number }).greenAtMs ?? 0);
    scheduleGreenLight(io, match, greenAtMs);
  }
  emitState(io, match);
  if (isTrialChallenge(match.current.key)) for (const playerId of match.socketIds.keys()) emitTrial(io, match, playerId);
}

// Score for a player who never reached their own completion condition before
// the shared challenge deadline hit (e.g. didn't hit every aim target). Time-
// only challenges without a completable end state (reaction-circle, traffic-
// light) fall through to 0, matching "no reaction recorded".
function timeoutScore(key: ChallengeKey, progress: Progress, elapsedMs: number): number {
  if (isTrialChallenge(key)) return scoreRepeatedTrials(progress.rawScore, progress.trials, progress.correct, progress.partialHits, elapsedMs);
  if (key === 'cps') return scoreCps(progress.clicks);
  if (key === 'number-salad') return scoreNumberSalad(progress.correct, progress.errors, elapsedMs);
  if (key === 'timing-10') return scoreTiming10(elapsedMs);
  if (key === 'aim-trainer') return scoreAimTrainer(progress.correct, elapsedMs);
  if (key === 'memory-sequence') return scoreMemorySequence(progress.correct);
  if (key === 'whack-a-mole') return scoreWhackAMole(progress.correct, progress.errors, elapsedMs);
  if (key === 'color-word') return scoreColorWord(progress.correct, progress.errors, elapsedMs);
  return 0;
}

function finishChallenge(io: Server, match: Match): void {
  if (match.phase !== 'playing' || match.paused) return;
  match.phase = 'result';
  clearTimer(match);
  clearGreenTimer(match);
  match.greenPausedRemainingMs = null;
  match.readyNext = new Set();
  for (const player of match.players) {
    const progress = match.progress.get(player.id)!;
    if (!progress.completed) {
      const elapsed = Math.min(activeElapsed(progress), match.current.durationMs);
      progress.score = timeoutScore(match.current.key, progress, elapsed);
      progress.completed = true;
    }
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
  // Arm the countdown before announcing the phase: the clients derive their
  // 3-2-1 overlay from this state's remainingMs, so it has to already be the
  // countdown deadline and not the result phase's ready-timeout.
  schedule(match, challengeRushTiming().countdownMs, () => beginChallenge(io, match));
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
  match.phase = 'ended'; clearTimer(match); clearGreenTimer(match);
  const scores = scorePayload(match);
  const winnerId = reason === 'completed' ? winnerIdForScores(scores.filter((score) => !score.forfeited)) : null;
  endArcadeSession(real(match.players), 'challenge-rush', match);
  recordArcadeResult({ gameType: 'challenge-rush', winnerId, players: match.players, scores: scores.map((score) => ({ ...score, isWinner: winnerId !== null && score.playerId === winnerId })), reason, startedAt: match.startedAt, scope: match });
  emitArcadeRoom(io, match.room, 'challenge-rush:match:end', { matchId: match.id, winnerId, scores, draw: winnerId === null && reason === 'completed', history: match.history }, match);
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
  const progress = match.progress.get(playerId);
  if (progress && !progress.completed) { progress.completed = true; progress.score = 0; }
  if (match.players.every((player) => match.forfeited.has(player.id))) return finishMatch(io, match, 'all-forfeited');
  emitState(io, match);
  if (match.phase === 'playing' && [...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
  else if (match.phase === 'result' && isReadyForNext(scorePayload(match), match.readyNext)) nextChallenge(io, match);
}

function attachSocket(io: Server, socket: Socket, match: Match, playerId: string): void {
  const previousTimer = match.reconnectTimers.get(playerId);
  if (previousTimer) clearTimeout(previousTimer);
  match.reconnectTimers.delete(playerId);
  match.socketIds.set(playerId, socket.id);
  socket.join(match.room);
  socket.emit('challenge-rush:match:start', { matchId: match.id, host: match.host, players: match.players, challengeCount: match.order.length, reconnected: true });
  emitState(io, match, socket, playerId);
  emitTrial(io, match, playerId);
}

function startMatch(io: Server, lobby: Lobby): Match {
  const id = nanoid(); const room = `challenge-rush:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const order = challengeOrder(seed, isFastTest() ? CHALLENGES.length : 10);
  const match: Match = { id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players], socketIds: new Map(lobby.socketIds), order, index: -1, phase: 'countdown', seed, current: runtimeChallengePayload(order[0], seed), progress: new Map(), scores: new Map(lobby.players.map((player) => [player.id, 0])), startedAt: Date.now(), timer: null, deadlineAt: null, pausedRemainingMs: null, paused: false, reconnectTimers: new Map(), forfeited: new Set(), readyNext: new Set(), history: [], greenTimer: null, greenDeadlineAt: null, greenPausedRemainingMs: null };
  matches.set(id, match); releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); emitLobbies(io);
  startArcadeSession(real(match.players), 'challenge-rush', match); emitArcadeRoom(io, room, 'challenge-rush:match:start', { matchId: id, host: match.host, players: match.players, challengeCount: order.length }, match); nextChallenge(io, match); return match;
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
    if (typeof authPlayerId === 'string') for (const match of matches.values()) if (match.players.some((player) => player.id === authPlayerId)) attachSocket(io, socket, match, authPlayerId);
    socket.on('challenge-rush:match:reconnect', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const match = payload?.matchId ? matches.get(payload.matchId) : null; if (!match || !payload.playerId || !match.players.some((player) => player.id === payload.playerId) || !socketArcadeScope(socket, payload.playerId)) return ack?.({ ok: false, error: 'Match-Wiederaufnahme verweigert.' }); attachSocket(io, socket, match, payload.playerId); ack?.({ ok: true }); });

    socket.on('challenge-rush:lobby:create', (payload: { playerId?: string }, ack?: (r: unknown) => void) => { const player = playerById(payload?.playerId); const scope = player ? socketArcadeScope(socket, player.id) : null; if (!player || !scope) return ack?.({ ok: false, error: 'Spieler- oder Gruppenzugriff verweigert.' }); const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now() }; if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' }); lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id }); });
    socket.on('challenge-rush:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; const player = playerById(payload?.playerId); if (!lobby || !player || !canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' }); if (!lobby.players.some((entry) => entry.id === player.id) && lobby.players.length >= MAX_PLAYERS) return ack?.({ ok: false, error: 'Lobby ist voll.' }); if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' }); if (!lobby.players.some((entry) => entry.id === player.id)) lobby.players.push(player); lobby.socketIds.set(player.id, socket.id); emitLobbies(io); ack?.({ ok: true }); });
    socket.on('challenge-rush:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => { const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null; if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' }); if (payload.playerId === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); } else { releaseLobbyMembership(payload.playerId, 'challenge-rush', lobby.id); lobby.players = lobby.players.filter((player) => player.id !== payload.playerId); lobby.socketIds.delete(payload.playerId); lobby.ready.delete(payload.playerId); } emitLobbies(io); ack?.({ ok: true }); });
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
    socket.on('challenge-rush:challenge:input', (payload: { matchId?: string; playerId?: string; challengeIndex?: number; trialId?: string; action?: string; value?: unknown }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null; const p = match && payload.playerId ? match.progress.get(payload.playerId) : null;
      if (!match || match.phase !== 'playing' || match.paused || !p || !owns(socket, payload.playerId) || !canUseLobby(socket, match) || match.forfeited.has(payload.playerId as string)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
      const progress = () => ({ ok: true, progress: progressPayload(p) });
      if (!isCurrentChallenge(payload.challengeIndex ?? -1, match.index)) return ack?.({ ...progress(), ignored: true, reason: 'stale-challenge' });
      if (isTrialChallenge(match.current.key)) {
        const visibleTrial = publicTrial(p);
        if (!p.trial || !visibleTrial || payload.trialId !== p.trial.trialId) return ack?.({ ...progress(), ignored: true, reason: 'stale-trial', trial: visibleTrial });
        const now = Date.now();
        if (now - p.lastInputAt < 30) return ack?.({ ...progress(), ignored: true, trial: visibleTrial });
        p.lastInputAt = now;
        if (p.trial.phase === 'preview') return ack?.({ ok: false, error: 'Die Vorschau läuft noch.', progress: progressPayload(p), trial: visibleTrial });
        if (payload.action === 'timeout' || trialElapsed(p, now) >= p.trial.inputMs) {
          finishPlayerTrial(io, match, payload.playerId as string, p, { accepted: true, complete: true, correct: false, errors: 1, rawScore: 0, error: 'Zeit abgelaufen.' });
          return ack?.({ ok: true, accepted: true, timedOut: true, progress: progressPayload(p), trial: publicTrial(p) });
        }
        if (match.current.key === 'memory-pairs' && payload.action === 'reveal') {
          const cardIndex = payload.value;
          const board = p.trial.expected as string[];
          const found = Array.isArray(p.trial.state.found) ? p.trial.state.found as number[] : [];
          const revealed = Array.isArray(p.trial.state.revealed) ? p.trial.state.revealed as number[] : [];
          if (!Number.isInteger(cardIndex) || Number(cardIndex) < 0 || Number(cardIndex) >= board.length || found.includes(Number(cardIndex)) || revealed.includes(Number(cardIndex))) {
            return ack?.({ ok: false, error: 'Ungültige Karte.', progress: progressPayload(p), trial: publicTrial(p) });
          }
          revealed.push(Number(cardIndex));
          p.trial.state.revealed = revealed;
          p.trial.state.revealSeq = Number(p.trial.state.revealSeq ?? 0) + 1;
          const revealedCards = revealed.map((index) => ({ index, value: board[index] }));
          const revealSeq = Number(p.trial.state.revealSeq);
          if (revealed.length < 2) return ack?.({ ok: true, accepted: true, progress: progressPayload(p), trial: publicTrial(p), revealedCards, revealSeq });
          const result = validateTrialInput(match.current.key, p.trial, 'pair', [...revealed]);
          p.trial.state.revealed = [];
          const fastRound = isFastTest();
          if (result.complete || fastRound) finishPlayerTrial(io, match, payload.playerId as string, p, fastRound ? { ...result, complete: true } : result);
          else {
            p.rawScore += result.rawScore;
            p.errors += result.errors;
            if (result.correct) p.partialHits += 1;
          }
          return ack?.({ ok: true, accepted: result.accepted, correct: result.correct, progress: progressPayload(p), trial: publicTrial(p), revealedCards, revealSeq });
        }
        const result = validateTrialInput(match.current.key, p.trial, payload.action ?? '', payload.value);
        if (!result.accepted) return ack?.({ ok: false, error: result.error, progress: progressPayload(p), trial: publicTrial(p) });
        if (result.complete) finishPlayerTrial(io, match, payload.playerId as string, p, result);
        else {
          p.rawScore += result.rawScore;
          p.errors += result.errors;
          if (result.correct) p.partialHits += 1;
        }
        return ack?.({ ok: true, accepted: true, correct: result.correct, progress: progressPayload(p), trial: publicTrial(p) });
      }
      const now = Date.now(); if (p.completed) return ack?.({ ...progress(), duplicate: true }); if (now - p.lastInputAt < 30) return ack?.({ ...progress(), ignored: true }); p.lastInputAt = now;
      const elapsed = Math.min(activeElapsed(p, now), match.current.durationMs);
      const pointValue = (): { x?: number; y?: number } => (payload.value && typeof payload.value === 'object' ? payload.value : {});
      const hitsPoint = (target: { x?: unknown; y?: unknown }): boolean => { const point = pointValue(); return typeof point.x === 'number' && typeof point.y === 'number' && Math.abs(point.x - Number(target.x)) <= 12 && Math.abs(point.y - Number(target.y)) <= 12; };
      if (match.current.key === 'reaction-circle') { if (payload.action !== 'hit' || !hitsPoint(match.current.data as { x: number; y: number })) return ack?.({ ok: false, error: 'Ungültiges Ziel.', progress: progressPayload(p) }); p.score = scoreReaction(elapsed); p.completed = true; }
      else if (match.current.key === 'cps') { if (payload.action !== 'click') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) }); p.clicks += 1; }
      else if (match.current.key === 'number-salad') { const expected = p.correct + 1; if (payload.action !== 'number' || payload.value !== expected) p.errors += 1; else p.correct += 1; if (p.correct >= 8) { p.score = scoreNumberSalad(p.correct, p.errors, elapsed); p.completed = true; } }
      else if (match.current.key === 'timing-10') { if (payload.action !== 'stop') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) }); p.score = scoreTiming10(elapsed); p.completed = true; }
      else if (match.current.key === 'aim-trainer') {
        const targets = match.current.data.targets as Array<{ x: number; y: number }>;
        if (payload.action !== 'hit' || !hitsPoint(targets[p.correct] ?? {})) return ack?.({ ok: false, error: 'Ungültiges Ziel.', progress: progressPayload(p) });
        p.correct += 1;
        if (p.correct >= AIM_TRAINER_TARGET_COUNT) { p.score = scoreAimTrainer(p.correct, elapsed); p.completed = true; }
      }
      else if (match.current.key === 'memory-sequence') {
        const sequence = match.current.data.sequence as number[];
        if (payload.action !== 'tile' || typeof payload.value !== 'number') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) });
        // The full sequence is already in the wire payload for the reveal
        // animation, so a scripted client could otherwise answer the instant
        // 'playing' starts and always score 100 — reject taps before the
        // reveal has actually finished.
        if (elapsed < challengeRushTiming().memoryRevealMs) return ack?.({ ok: false, error: 'Bitte die Reihenfolge erst abwarten.', progress: progressPayload(p) });
        if (payload.value === sequence[p.correct]) p.correct += 1; else p.errors += 1;
        if (p.errors > 0 || p.correct >= MEMORY_SEQUENCE_LENGTH) { p.score = scoreMemorySequence(p.correct); p.completed = true; }
      }
      else if (match.current.key === 'odd-one-out') {
        if (payload.action !== 'select' || typeof payload.value !== 'number') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) });
        if (payload.value === match.current.data.oddIndex) { p.score = scoreOddOneOut(elapsed, p.errors); p.completed = true; } else p.errors += 1;
      }
      else if (match.current.key === 'whack-a-mole') {
        const sequence = match.current.data.sequence as number[];
        if (payload.action !== 'hit' || typeof payload.value !== 'number') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) });
        if (payload.value === sequence[p.correct]) p.correct += 1; else p.errors += 1;
        if (p.correct >= WHACK_A_MOLE_SEQUENCE_LENGTH) { p.score = scoreWhackAMole(p.correct, p.errors, elapsed); p.completed = true; }
      }
      else if (match.current.key === 'traffic-light') {
        if (payload.action !== 'click') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) });
        const greenAtMs = Number(match.current.data.greenAtMs);
        const falseStart = elapsed < greenAtMs;
        p.score = scoreTrafficLight(elapsed - greenAtMs, falseStart);
        if (falseStart) p.errors += 1;
        p.completed = true;
      }
      else if (match.current.key === 'color-word') {
        const rounds = match.current.data.rounds as Array<{ textColor: string }>;
        const roundIndex = p.correct + p.errors;
        if (payload.action !== 'answer' || typeof payload.value !== 'string' || roundIndex >= rounds.length) return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) });
        if (payload.value === rounds[roundIndex].textColor) p.correct += 1; else p.errors += 1;
        if (p.correct + p.errors >= COLOR_WORD_ROUND_COUNT) { p.score = scoreColorWord(p.correct, p.errors, elapsed); p.completed = true; }
      }
      // Browser E2E exercises the real renderer/click wiring for all forty
      // challenges. One valid interaction is enough there; production still
      // uses the complete 30-second or challenge-specific completion rules.
      if (isE2EFastTest() && !p.completed) {
        p.score = timeoutScore(match.current.key, p, elapsed);
        p.completed = true;
      }
      if ([...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
      ack?.({ ok: true, accepted: true, progress: progressPayload(p), next: p.completed ? undefined : nextStepPayload(match, p) });
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
