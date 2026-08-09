import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcastArcadeKiosk } from './realtime';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { recordArcadeResult } from './arcadeData';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { challengeRushTiming } from './challengeRushTiming';
import { playerMayUseArcadeAi } from './adminAccess';
import {
  CHALLENGES, challengeOrder, challengePayload, createTrial, difficultyFor, isCurrentChallenge, isReadyForNext,
  isTrialChallenge, planBotChallenge, remainingUntil, scoreRepeatedTrials, seenBeforeSelection, validateTrialInput,
  timedTargetWindowMs,
  scoreAimTrainer, scoreColorWord, scoreCps, scoreMemorySequence, scoreNumberSalad, scoreOddOneOut,
  scoreReaction, scoreTiming10, scoreTrafficLight, scoreWhackAMole, winnerIdForScores, previewTrialData,
  COLOR_WORD_ROUND_COUNT, MEMORY_SEQUENCE_LENGTH, WHACK_A_MOLE_SEQUENCE_LENGTH, AIM_TRAINER_TARGET_COUNT,
  type BotChallengeStep, type ChallengeKey, type ChallengePayload, type InternalTrial, type TrialPayload,
} from './challengeRushLogic';

const MAX_PLAYERS = 15;
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_RESULT_READY_TIMEOUT_MS = 30_000;
const END_REVEAL_MS = 12_000;
const BOT_TICK_MS = 50;
const BOT_ID = 'challenge-rush-bot';
const BOT = { id: BOT_ID, name: 'Challenge-Bot', avatar: null, color: '#9163f5' };
// The bot only ever plays the ten original single-payload challenges (see
// planBotChallenge/isTrialChallenge) — a bot match draws its order from just
// this pool instead of the full forty, so it doesn't spend most matches on
// trial challenges the bot always scores 0 on.
const BOT_CHALLENGE_POOL: ChallengeKey[] = CHALLENGES.filter((challenge) => !isTrialChallenge(challenge.key)).map((challenge) => challenge.key);

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby {
  id: string; groupId: string; eventId: string | null; host: Player; players: Player[];
  socketIds: Map<string, string>; ready: Set<string>; createdAt: number;
  challengeKeys: ChallengeKey[] | null;
}
interface Progress {
  clicks: number; errors: number; correct: number; completed: boolean; score: number;
  startedAt: number; elapsedBeforePause: number; lastInputAt: number;
  rawScore: number; trials: number; streak: number; trialIndex: number; partialHits: number;
  trial: InternalTrial | null; trialStartedAt: number; trialElapsedBeforePause: number;
  seenSymbols: string[]; symbolHistory: string[];
  stepIndex: number; stepDeadlineAt: number | null; stepPausedRemainingMs: number | null;
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
  botLoop: NodeJS.Timeout | null; botPlan: BotChallengeStep[]; botPlanCursor: number;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const challengeCatalog = CHALLENGES.map(({ key, title, description }) => ({ key, title, description }));
const challengeKeySet = new Set<ChallengeKey>(CHALLENGES.map(({ key }) => key));
const real = (players: Player[]) => players.filter((player) => player.id !== BOT_ID).map((player) => player.id);
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
    stepIndex: 0, stepDeadlineAt: null, stepPausedRemainingMs: null,
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
  const difficulty = difficultyFor(progress.streak, progress.trials);
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
    resume, data: trial.phase === 'preview' ? previewTrialData(trial) : inputTrialData(trial),
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
    if (scope) socket.emit('challenge-rush:lobbies', lobbyPayload(scope.groupId, scope.eventId));
  }
}

function scorePayload(match: Match) {
  return match.players.map((player) => ({ playerId: player.id, name: player.name, score: match.scores.get(player.id) ?? 0, connected: match.socketIds.has(player.id), forfeited: match.forfeited.has(player.id), isBot: player.id === BOT_ID }));
}

function progressPayload(progress: Progress) {
  return {
    clicks: progress.clicks, correct: progress.correct, errors: progress.errors, completed: progress.completed, score: progress.score,
    difficulty: difficultyFor(progress.streak, progress.trials), streak: progress.streak, trials: progress.trials, partialHits: progress.partialHits,
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
    return { ...sanitized, data: { ...rest, target: targets[p.stepIndex] ?? null } };
  }
  if (match.current.key === 'whack-a-mole') {
    const { sequence, ...rest } = sanitized.data as { sequence: number[] };
    return { ...sanitized, data: { ...rest, activeHole: sequence[p.stepIndex] ?? null } };
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
  if (match.current.key === 'aim-trainer') { const targets = (match.current.data as { targets: Array<{ x: number; y: number }> }).targets; return { target: targets[p.stepIndex] ?? null }; }
  if (match.current.key === 'whack-a-mole') { const sequence = (match.current.data as { sequence: number[] }).sequence; return { activeHole: sequence[p.stepIndex] ?? null }; }
  if (match.current.key === 'color-word') { const rounds = (match.current.data as { rounds: Array<{ word: string; textColor: string; options: string[] }> }).rounds; return { round: rounds[p.correct + p.errors] ?? null }; }
  return undefined;
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
  } else if (match.current.key === 'cps') {
    if (input.action !== 'click') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    p.clicks += 1;
  } else if (match.current.key === 'number-salad') {
    const expected = p.correct + 1;
    if (input.action !== 'number' || input.value !== expected) p.errors += 1; else p.correct += 1;
    if (p.correct >= 8) { p.score = scoreNumberSalad(p.correct, p.errors, elapsed); p.completed = true; }
  } else if (match.current.key === 'timing-10') {
    if (input.action !== 'stop') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    p.score = scoreTiming10(elapsed); p.completed = true;
  } else if (match.current.key === 'aim-trainer') {
    const targets = match.current.data.targets as Array<{ x: number; y: number }>;
    if (input.action !== 'hit' || !hitsPoint(targets[p.stepIndex] ?? {})) return { ok: false, error: 'Ungültiges Ziel.', progress: progressPayload(p) };
    p.correct += 1; p.stepIndex += 1;
    if (p.stepIndex >= AIM_TRAINER_TARGET_COUNT) { p.score = scoreAimTrainer(p.correct, elapsed); p.completed = true; p.stepDeadlineAt = null; }
    else p.stepDeadlineAt = now + timedTargetWindowMs(match.current.key, p.stepIndex);
  } else if (match.current.key === 'memory-sequence') {
    const sequence = match.current.data.sequence as number[];
    if (input.action !== 'tile' || typeof input.value !== 'number') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    if (elapsed < challengeRushTiming().memoryRevealMs) return { ok: false, error: 'Bitte die Reihenfolge erst abwarten.', progress: progressPayload(p) };
    if (input.value === sequence[p.correct]) p.correct += 1; else p.errors += 1;
    if (p.errors > 0 || p.correct >= MEMORY_SEQUENCE_LENGTH) { p.score = scoreMemorySequence(p.correct); p.completed = true; }
  } else if (match.current.key === 'odd-one-out') {
    if (input.action !== 'select' || typeof input.value !== 'number') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    if (input.value === match.current.data.oddIndex) { p.score = scoreOddOneOut(elapsed, p.errors); p.completed = true; } else p.errors += 1;
  } else if (match.current.key === 'whack-a-mole') {
    const sequence = match.current.data.sequence as number[];
    if (input.action !== 'hit' || typeof input.value !== 'number') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    if (input.value === sequence[p.stepIndex]) {
      p.correct += 1; p.stepIndex += 1;
      if (p.stepIndex < WHACK_A_MOLE_SEQUENCE_LENGTH) p.stepDeadlineAt = now + timedTargetWindowMs(match.current.key, p.stepIndex);
    } else p.errors += 1;
    if (p.stepIndex >= WHACK_A_MOLE_SEQUENCE_LENGTH) { p.score = scoreWhackAMole(p.correct, p.errors, elapsed); p.completed = true; p.stepDeadlineAt = null; }
  } else if (match.current.key === 'traffic-light') {
    if (input.action !== 'click') return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    const greenAtMs = Number(match.current.data.greenAtMs);
    const falseStart = elapsed < greenAtMs;
    p.score = scoreTrafficLight(elapsed - greenAtMs, falseStart);
    if (falseStart) p.errors += 1;
    p.completed = true;
  } else {
    const rounds = match.current.data.rounds as Array<{ textColor: string }>;
    const roundIndex = p.correct + p.errors;
    if (input.action !== 'answer' || typeof input.value !== 'string' || roundIndex >= rounds.length) return { ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) };
    if (input.value === rounds[roundIndex].textColor) p.correct += 1; else p.errors += 1;
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
  return { ok: true, accepted: true, progress: progressPayload(p), next: p.completed ? undefined : nextStepPayload(match, p) };
}

function processTimedStepTimeouts(io: Server, match: Match): void {
  if (match.phase !== 'playing' || match.paused || !['aim-trainer', 'whack-a-mole'].includes(match.current.key)) return;
  const now = Date.now(); const changedPlayers: string[] = [];
  const stepCount = match.current.key === 'aim-trainer' ? AIM_TRAINER_TARGET_COUNT : WHACK_A_MOLE_SEQUENCE_LENGTH;
  for (const [playerId, progress] of match.progress) {
    if (progress.completed || progress.stepDeadlineAt === null || now < progress.stepDeadlineAt) continue;
    progress.errors += 1;
    progress.stepIndex += 1;
    if (progress.stepIndex >= stepCount) {
      const elapsed = Math.min(activeElapsed(progress, now), match.current.durationMs);
      progress.score = match.current.key === 'aim-trainer'
        ? scoreAimTrainer(progress.correct, elapsed)
        : scoreWhackAMole(progress.correct, progress.errors, elapsed);
      progress.completed = true;
      progress.stepDeadlineAt = null;
    } else {
      progress.stepDeadlineAt = now + timedTargetWindowMs(match.current.key, progress.stepIndex);
    }
    changedPlayers.push(playerId);
  }
  if (changedPlayers.length === 0) return;
  if ([...match.progress.values()].every((entry) => entry.completed)) return finishChallenge(io, match);
  for (const playerId of changedPlayers) {
    const socketId = match.socketIds.get(playerId);
    const target = socketId ? io.sockets.sockets.get(socketId) : undefined;
    if (target) emitState(io, match, target, playerId);
  }
}

function runMatchTick(io: Server, match: Match): void {
  if (match.phase !== 'playing' || match.paused) return;
  processTimedStepTimeouts(io, match);
  if (match.phase !== 'playing' || !match.players.some((player) => player.id === BOT_ID)) return;
  const progress = match.progress.get(BOT_ID);
  const step = match.botPlan[match.botPlanCursor];
  if (!progress || progress.completed || !step || activeElapsed(progress) < step.atMs) return;
  const result = applyChallengeInput(io, match, BOT_ID, { challengeIndex: match.index, action: step.action, value: step.value });
  if (result.accepted === true || result.duplicate === true || result.reason === 'stale-challenge') match.botPlanCursor += 1;
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
      if (!progress.completed && progress.stepDeadlineAt !== null) {
        progress.stepPausedRemainingMs = Math.max(0, progress.stepDeadlineAt - now);
        progress.stepDeadlineAt = null;
      }
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
      if (progress.stepPausedRemainingMs !== null) {
        progress.stepDeadlineAt = Date.now() + progress.stepPausedRemainingMs;
        progress.stepPausedRemainingMs = null;
      }
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
    if (!progress.completed && ['aim-trainer', 'whack-a-mole'].includes(match.current.key)) {
      progress.stepDeadlineAt = now + timedTargetWindowMs(match.current.key, progress.stepIndex);
    }
  }
  // planBotChallenge only plans the original ten single-payload challenges;
  // the thirty trial-based ones have no precomputable step list (each trial
  // is generated fresh per player once the previous one completes), so the
  // bot simply stays idle and scores 0 on those for now instead of guessing.
  match.botPlan = planBotChallenge(match.current, { memoryRevealMs: challengeRushTiming().memoryRevealMs });
  match.botPlanCursor = 0;
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
    progress.stepDeadlineAt = null;
    progress.stepPausedRemainingMs = null;
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
  match.botPlan = [];
  match.botPlanCursor = 0;
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
  if (match.botLoop) clearInterval(match.botLoop);
  match.botLoop = null;
  for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
  match.reconnectTimers.clear();
  matches.delete(match.id);
  for (const socketId of match.socketIds.values()) io.sockets.sockets.get(socketId)?.leave(match.room);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
}

function finishMatch(io: Server, match: Match, reason = 'completed'): void {
  if (match.phase === 'ended') return;
  match.phase = 'ended'; clearTimer(match); clearGreenTimer(match);
  if (match.botLoop) clearInterval(match.botLoop);
  match.botLoop = null;
  const scores = scorePayload(match);
  const winnerId = reason === 'completed' ? winnerIdForScores(scores.filter((score) => !score.forfeited)) : null;
  endArcadeSession(real(match.players), 'challenge-rush', match);
  recordArcadeResult({ gameType: 'challenge-rush', winnerId: winnerId === BOT_ID ? null : winnerId, players: match.players, scores: scores.map((score) => ({ ...score, isWinner: winnerId !== null && score.playerId === winnerId })), reason, startedAt: match.startedAt, scope: match });
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
  if (progress && !progress.completed) { progress.completed = true; progress.score = 0; progress.stepDeadlineAt = null; progress.stepPausedRemainingMs = null; }
  if (match.players.some((player) => player.id === BOT_ID) && real(match.players).every((humanId) => match.forfeited.has(humanId))) return finishMatch(io, match, 'no-human-players');
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
  // Only the actual "quick start against the bot" case (a single human plus
  // the bot) narrows the draw to BOT_CHALLENGE_POOL — a bot lobby joined by
  // further humans (challenge-rush:lobby:join has no bot-specific limit, up
  // to MAX_PLAYERS) keeps the full forty-challenge catalog for everyone,
  // same as a normal match; the bot then simply scores 0 on whichever trial
  // challenges come up, same as it already does mid-match after a human
  // reconnects into a lobby that has since grown.
  const soloAgainstBot = lobby.players.some((player) => player.id === BOT_ID) && real(lobby.players).length <= 1;
  const order = lobby.challengeKeys
    ? [...lobby.challengeKeys]
    : soloAgainstBot
      ? challengeOrder(seed, isFastTest() ? BOT_CHALLENGE_POOL.length : 10, BOT_CHALLENGE_POOL)
      : challengeOrder(seed, isFastTest() ? CHALLENGES.length : 10);
  const match: Match = { id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players], socketIds: new Map(lobby.socketIds), order, index: -1, phase: 'countdown', seed, current: runtimeChallengePayload(order[0], seed), progress: new Map(), scores: new Map(lobby.players.map((player) => [player.id, 0])), startedAt: Date.now(), timer: null, deadlineAt: null, pausedRemainingMs: null, paused: false, reconnectTimers: new Map(), forfeited: new Set(), readyNext: new Set(), history: [], greenTimer: null, greenDeadlineAt: null, greenPausedRemainingMs: null, botLoop: null, botPlan: [], botPlanCursor: 0 };
  matches.set(id, match); releaseLobbyMemberships(lobby.players.map((player) => player.id), 'challenge-rush', lobby.id); lobbies.delete(lobby.id); emitLobbies(io);
  match.botLoop = setInterval(() => runMatchTick(io, match), BOT_TICK_MS);
  match.botLoop.unref();
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
    });
    socket.on('challenge-rush:lobby:bot', (payload: { playerId?: string; challengeKeys?: unknown }, ack?: (r: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      const scope = player ? socketArcadeScope(socket, player.id) : null;
      if (!player || !scope) return ack?.({ ok: false, error: 'Spieler- oder Gruppenzugriff verweigert.' });
      if (hasActiveMatch(player.id)) return ack?.({ ok: false, error: 'Beende zuerst dein laufendes Challenge-Rush-Match.' });
      const challengeKeys = normalizeChallengeSelection(payload?.challengeKeys);
      if (challengeKeys === undefined) return ack?.({ ok: false, error: 'Die Aufgabenauswahl ist ungültig.' });
      const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player, BOT], socketIds: new Map([[player.id, socket.id]]), ready: new Set([BOT_ID]), createdAt: Date.now(), challengeKeys };
      if (!claimLobbyMembership(player.id, 'challenge-rush', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' });
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
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
    // The original ten single-payload challenges (reaction-circle, cps, ...)
    // share one authoritative applyChallengeInput, also used by the bot tick
    // below. The thirty trial-based challenges use a repeated
    // generate-a-trial/validate-the-answer cycle that doesn't fit that same
    // shape (each trial is per-player and regenerated on demand), so they
    // stay handled here directly; the bot currently never plays them (see
    // beginChallenge) and so never reaches this branch as BOT_ID.
    socket.on('challenge-rush:challenge:input', (payload: { matchId?: string; playerId?: string; challengeIndex?: number; trialId?: string; action?: string; value?: unknown }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || payload.playerId === BOT_ID || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
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
