import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { randomInt } from 'node:crypto';
import { db } from '../db';
import { broadcastArcadeKiosk } from './realtime';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { recordArcadeResult } from './arcadeData';
import { canJoinLobby, canUseLobby, emitArcadeRoom, emitArcadeSocket, socketArcadeScope, socketCanUseArcadeScope } from './scope';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { notifyArcadeLobbyOpened, resolveArcadeLobbyPush } from './lobbyPush';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { arcadeTiming } from './timing';
import { registerSocketConnection } from '../socketConnections';
import {
  CHIMP_MAX_STRIKES, applyChimpClick, applyChimpInactivity, chimpRating, continueChimpRun, finishChimpReveal,
  isImplausibleChimpInput, rankChimpResults, startChimpRun, type ChimpRun,
} from './chimpLogic';
import { chimpLeaderboard, type ChimpRunScore } from './chimpLeaderboard';

// Chimp Test (docs/CHIMP-TEST-ARCADE-KONZEPT.md): everyone starts together,
// then plays an own, independent run. Each run is stored on its own as a solo
// result; the round ranking at the end is display-only and never persisted.

const MAX_PLAYERS = 15;

export interface ChimpTiming {
  revealMs: number;
  inactivityMs: number;
  interstitialMs: number;
  matchLimitMs: number;
  reconnectGraceMs: number;
}

const PRODUCTION_TIMING: ChimpTiming = {
  revealMs: 1_500,
  inactivityMs: 60_000,
  interstitialMs: 30_000,
  matchLimitMs: 10 * 60_000,
  reconnectGraceMs: 15_000,
};

// The socket suite (ARCADE_FAST_TIMERS) shortens the reveal so strike paths do
// not wait 1.5 s each. Individual deadlines can be overridden by a test that
// asserts exactly that deadline. Everything is ignored outside NODE_ENV=test.
export function resolveChimpTiming(env: NodeJS.ProcessEnv): ChimpTiming {
  if (env.NODE_ENV !== 'test') return PRODUCTION_TIMING;
  const override = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const socketSuite = env.ARCADE_FAST_TIMERS === '1';
  return {
    revealMs: override(env.CHIMP_REVEAL_MS, socketSuite ? 30 : PRODUCTION_TIMING.revealMs),
    inactivityMs: override(env.CHIMP_INACTIVITY_MS, PRODUCTION_TIMING.inactivityMs),
    interstitialMs: override(env.CHIMP_INTERSTITIAL_MS, PRODUCTION_TIMING.interstitialMs),
    matchLimitMs: override(env.CHIMP_MATCH_LIMIT_MS, PRODUCTION_TIMING.matchLimitMs),
    reconnectGraceMs: override(env.CHIMP_RECONNECT_GRACE_MS, PRODUCTION_TIMING.reconnectGraceMs),
  };
}

const timing = (): ChimpTiming => resolveChimpTiming(process.env);

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby {
  id: string; groupId: string; eventId: string | null; host: Player; players: Player[];
  socketIds: Map<string, string>; ready: Set<string>; createdAt: number;
}
type RunEndReason = 'strikes' | 'max' | 'time-limit' | 'ended-by-host' | 'left' | 'disconnect' | 'invalid';
// What the player learns when the own run ends. Kept on the run so a reload
// during a still running round shows the same result details again.
interface RunEndDetails { invalid: boolean; previousBest: number | null; newBest: boolean; rank: number | null }
interface PlayerRun {
  run: ChimpRun;
  levelToken: string;
  // Active time of the current attempt: frozen part plus the running part.
  attemptElapsed: number;
  attemptRunningSince: number;
  firstClickAt: number;
  // Wall clock of the last completed level: the leaderboard's final tie-break,
  // frozen together with strikesAtLevel and activeMsAtLevel.
  levelCompletedAt: number | null;
  timer: NodeJS.Timeout | null;
  ended: RunEndReason | null;
  endDetails: RunEndDetails | null;
}
interface Match {
  id: string; groupId: string; eventId: string | null; room: string; host: Player; players: Player[];
  socketIds: Map<string, string>; seed: number; phase: 'countdown' | 'playing' | 'ended';
  runs: Map<string, PlayerRun>; startedAt: number; timer: NodeJS.Timeout | null; deadlineAt: number | null;
  paused: boolean; pausedRemainingMs: number | null; reconnectTimers: Map<string, NodeJS.Timeout>;
  hostWatch: NodeJS.Timeout | null;
  // Set while finishMatch closes the remaining runs, so the last of them does
  // not finish the match a second time with the wrong reason.
  closing: boolean;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();

const playerById = (id: unknown): Player | null => typeof id === 'string' ? (db.prepare('SELECT id,name,avatar,color FROM players WHERE id=?').get(id) as Player | undefined) ?? null : null;
const owns = (socket: Socket, id: unknown): id is string => typeof id === 'string' && Boolean(socketArcadeScope(socket, id));
const isRunning = (entry: PlayerRun | undefined): boolean => Boolean(entry && entry.ended === null);
const hasActiveRun = (playerId: string): boolean => [...matches.values()].some(
  (match) => match.phase !== 'ended' && isRunning(match.runs.get(playerId)),
);

function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()]
    .filter((lobby) => lobby.groupId === groupId && lobby.eventId === eventId)
    .map((lobby) => ({ id: lobby.id, host: lobby.host, players: lobby.players.map((player) => ({ ...player, ready: isLobbyReady(lobby, player.id) })), createdAt: lobby.createdAt }));
}

export function openLobbySummaries(groupId?: string, eventId?: string | null) {
  return [...lobbies.values()]
    .filter((lobby) => !groupId || (lobby.groupId === groupId && (eventId === undefined || lobby.eventId === eventId)))
    .map((lobby) => ({ id: lobby.id, hostName: lobby.host.name, playerCount: lobby.players.length, createdAt: lobby.createdAt }));
}

function emitLobbies(io: Server): void {
  for (const socket of io.sockets.sockets.values()) {
    const scope = socketArcadeScope(socket);
    if (scope) socket.emit('chimp:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
  }
}

function attemptElapsed(entry: PlayerRun, now = Date.now()): number {
  return entry.attemptElapsed + (entry.attemptRunningSince > 0 ? Math.max(0, now - entry.attemptRunningSince) : 0);
}

function freezeAttempt(entry: PlayerRun, now = Date.now()): void {
  entry.attemptElapsed = attemptElapsed(entry, now);
  entry.attemptRunningSince = 0;
}

function clearRunTimer(entry: PlayerRun): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
}

function beginAttempt(entry: PlayerRun): void {
  entry.levelToken = nanoid();
  entry.attemptElapsed = 0;
  entry.attemptRunningSince = Date.now();
  entry.firstClickAt = 0;
}

function runResult(entry: PlayerRun) {
  const { run } = entry;
  return {
    level: run.bestLevel,
    strikesAtLevel: run.strikesAtLevel,
    activeMsAtLevel: run.activeMsAtLevel,
    totalStrikes: run.strikes,
    totalActiveMs: run.totalActiveMs,
    rating: chimpRating(run.bestLevel),
  };
}

function runStatus(match: Match, playerId: string, entry: PlayerRun): string {
  if (entry.ended === 'left') return 'left';
  if (entry.ended !== null) return 'out';
  return match.socketIds.has(playerId) ? 'playing' : 'disconnected';
}

// Public standings: never cells or numbers, only progress counters.
function standingsPayload(match: Match) {
  return match.players.map((player) => {
    const entry = match.runs.get(player.id);
    const run = entry?.run;
    return {
      playerId: player.id,
      name: player.name,
      level: run?.level ?? 0,
      bestLevel: run?.bestLevel ?? 0,
      strikes: run?.strikes ?? 0,
      clicked: run && (run.phase === 'input' || run.phase === 'memorize') ? run.clicked : 0,
      status: entry ? runStatus(match, player.id, entry) : 'playing',
      invalid: entry?.ended === 'invalid',
    };
  });
}

// The own run only. Numbers are sent while memorizing; once the attempt has
// started only the still hidden cells go out, sorted so their order reveals
// nothing.
function ownRunPayload(entry: PlayerRun) {
  const { run } = entry;
  const base = {
    phase: entry.ended !== null ? 'out' : run.phase,
    level: run.level,
    strikes: run.strikes,
    maxStrikes: CHIMP_MAX_STRIKES,
    bestLevel: run.bestLevel,
    clicked: run.clicked,
    levelToken: entry.levelToken,
    lastOutcome: run.lastOutcome,
  };
  if (entry.ended === null && run.phase === 'memorize') {
    return { ...base, numbers: run.layout.map((cell, index) => ({ cell, number: index + 1 })) };
  }
  if (entry.ended === null && run.phase === 'input') {
    return { ...base, hiddenCells: run.layout.slice(run.clicked).sort((a, b) => a - b) };
  }
  if (entry.ended !== null) return { ...base, result: runResult(entry), endReason: entry.ended, endDetails: entry.endDetails };
  return base;
}

function matchStatePayload(match: Match, playerId: string) {
  const entry = match.runs.get(playerId);
  return {
    matchId: match.id,
    phase: match.phase,
    paused: match.paused,
    remainingMs: match.paused ? match.pausedRemainingMs : match.deadlineAt === null ? null : Math.max(0, match.deadlineAt - Date.now()),
    host: match.host,
    players: match.players,
    standings: standingsPayload(match),
    me: entry && match.phase !== 'countdown' ? ownRunPayload(entry) : null,
  };
}

// Personal pushes re-check the socket's current group/event scope on every
// delivery, like room broadcasts: a participant who switched events or lost
// access keeps a stale socket id in the match but must receive nothing.
function emitToPlayer(io: Server, match: Match, playerId: string, event: string, payload: unknown): void {
  const socketId = match.socketIds.get(playerId);
  if (socketId) emitArcadeSocket(io, socketId, event, payload, match);
}

function emitOwnState(io: Server, match: Match, playerId: string): void {
  emitToPlayer(io, match, playerId, 'chimp:state', matchStatePayload(match, playerId));
}

function emitAllStates(io: Server, match: Match): void {
  for (const player of match.players) emitOwnState(io, match, player.id);
  emitKiosk(io, match);
}

function emitStandings(io: Server, match: Match): void {
  emitArcadeRoom(io, match.room, 'chimp:standings', { matchId: match.id, standings: standingsPayload(match) }, match);
  emitKiosk(io, match);
}

function emitKiosk(io: Server, match: Match, extra: Record<string, unknown> = {}): void {
  const standings = standingsPayload(match);
  broadcastArcadeKiosk(io, {
    gameType: 'chimp',
    matchId: match.id,
    groupId: match.groupId,
    eventId: match.eventId,
    phase: match.phase,
    paused: match.paused,
    players: match.players.map((player) => ({ id: player.id, name: player.name })),
    scores: standings.map((entry) => ({ playerId: entry.playerId, name: entry.name, score: entry.bestLevel, level: entry.level, strikes: entry.strikes, clicked: entry.clicked, status: entry.status })),
    ...extra,
  });
}

function clearMatchTimer(match: Match): void {
  if (match.timer) clearTimeout(match.timer);
  match.timer = null;
  match.deadlineAt = null;
}

function scheduleMatch(match: Match, delayMs: number, callback: () => void): void {
  clearMatchTimer(match);
  const delay = Math.max(0, delayMs);
  match.deadlineAt = Date.now() + delay;
  match.timer = setTimeout(() => { match.timer = null; match.deadlineAt = null; callback(); }, delay);
  match.timer.unref();
}

const isCurrent = (match: Match): boolean => matches.get(match.id) === match && match.phase !== 'ended';

// Arms the deadline of the player's current phase. Memorizing has none.
function armRunTimer(io: Server, match: Match, playerId: string, entry: PlayerRun, delayMs?: number): void {
  clearRunTimer(entry);
  if (entry.ended !== null || match.paused || match.phase !== 'playing') return;
  const { run } = entry;
  const config = timing();
  const fire = (callback: () => void, ms: number) => {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!isCurrent(match) || match.paused || entry.ended !== null) return;
      callback();
    }, ms);
    entry.timer.unref();
  };
  if (run.phase === 'input') {
    fire(() => {
      applyChimpInactivity(run, attemptElapsed(entry));
      freezeAttempt(entry);
      afterStrike(io, match, playerId, entry);
    }, delayMs ?? config.inactivityMs);
  } else if (run.phase === 'reveal') {
    fire(() => endReveal(io, match, playerId, entry), delayMs ?? config.revealMs);
  } else if (run.phase === 'interstitial') {
    fire(() => continueRun(io, match, playerId, entry), delayMs ?? config.interstitialMs);
  }
}

function afterStrike(io: Server, match: Match, playerId: string, entry: PlayerRun): void {
  const reveal = entry.run.reveal;
  // Only the affected player ever receives the solution of the finished attempt.
  if (reveal) emitToPlayer(io, match, playerId, 'chimp:reveal', { matchId: match.id, ...reveal });
  armRunTimer(io, match, playerId, entry);
  emitOwnState(io, match, playerId);
  emitStandings(io, match);
}

function endReveal(io: Server, match: Match, playerId: string, entry: PlayerRun): void {
  finishChimpReveal(entry.run);
  if (entry.run.phase === 'out') return endRun(io, match, playerId, 'strikes');
  armRunTimer(io, match, playerId, entry);
  emitOwnState(io, match, playerId);
}

function continueRun(io: Server, match: Match, playerId: string, entry: PlayerRun): boolean {
  if (!continueChimpRun(entry.run, match.seed, playerId)) return false;
  beginAttempt(entry);
  armRunTimer(io, match, playerId, entry);
  emitOwnState(io, match, playerId);
  emitStandings(io, match);
  return true;
}

function personalBest(match: Match, playerId: string): number | null {
  if (!match.eventId) return null;
  return chimpLeaderboard(match.groupId, match.eventId).find((entry) => entry.playerId === playerId)?.level ?? null;
}

// Ends one run, stores it as its own solo result and tells the player. A run
// that never got past the countdown is not a result.
function endRun(io: Server, match: Match, playerId: string, reason: RunEndReason): void {
  const entry = match.runs.get(playerId);
  if (!entry || entry.ended !== null) return;
  clearRunTimer(entry);
  freezeAttempt(entry);
  entry.ended = reason;
  entry.run.phase = 'out';
  entry.run.reveal = null;
  const player = match.players.find((candidate) => candidate.id === playerId)!;
  endArcadeSession([playerId], 'chimp', match);
  if (match.phase === 'playing') {
    const result = runResult(entry);
    const previousBest = personalBest(match, playerId);
    const score: ChimpRunScore = {
      playerId, name: player.name, mode: 'solo', level: result.level, outcome: reason === 'invalid' ? 'invalid' : 'valid',
      strikesAtLevel: result.strikesAtLevel, activeMsAtLevel: result.activeMsAtLevel,
      achievedAt: entry.levelCompletedAt, totalStrikes: result.totalStrikes, totalActiveMs: result.totalActiveMs,
    };
    recordArcadeResult({
      gameType: 'chimp',
      winnerId: null,
      players: [player],
      scores: [score],
      reason,
      startedAt: match.startedAt,
      matchId: `${match.id}:${playerId}`,
      scope: match,
    });
    entry.endDetails = {
      invalid: reason === 'invalid',
      previousBest,
      newBest: reason !== 'invalid' && (previousBest === null || result.level > previousBest),
      rank: match.eventId ? chimpLeaderboard(match.groupId, match.eventId).find((row) => row.playerId === playerId)?.place ?? null : null,
    };
    emitToPlayer(io, match, playerId, 'chimp:run:end', { matchId: match.id, reason, result, ...entry.endDetails });
  }
  emitOwnState(io, match, playerId);
  emitStandings(io, match);
  if (!match.closing && [...match.runs.values()].every((candidate) => candidate.ended !== null)) finishMatch(io, match, 'completed');
}

// Invalid runs are listed below the ranked ones without a place.
function roundRanking(match: Match) {
  const results = match.players.map((player) => {
    const entry = match.runs.get(player.id)!;
    return { playerId: player.id, name: player.name, ...runResult(entry), endReason: entry.ended };
  });
  const invalid = results.filter((entry) => entry.endReason === 'invalid').map((entry) => ({ ...entry, place: null }));
  return [...rankChimpResults(results.filter((entry) => entry.endReason !== 'invalid')), ...invalid];
}

function finishMatch(io: Server, match: Match, reason: 'completed' | 'time-limit' | 'ended-by-host'): void {
  if (match.phase === 'ended' || match.closing) return;
  const playing = match.phase === 'playing';
  match.closing = true;
  // Open runs keep the level they reached when the host ends the round or
  // the time limit hits.
  for (const [playerId, entry] of match.runs) {
    if (entry.ended === null && reason !== 'completed') endRun(io, match, playerId, reason);
  }
  match.phase = 'ended';
  match.paused = false;
  match.pausedRemainingMs = null;
  clearMatchTimer(match);
  stopHostWatch(match);
  for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
  match.reconnectTimers.clear();
  // The round ranking only exists for a shared round, and is never stored.
  const ranking = playing && match.players.length > 1 ? roundRanking(match) : null;
  emitArcadeRoom(io, match.room, 'chimp:match:end', { matchId: match.id, reason, ranking }, match);
  emitKiosk(io, match, { phase: 'ended', ranking });
  setTimeout(() => cleanupMatch(io, match), arcadeTiming.endRevealMs).unref();
}

function cleanupMatch(io: Server, match: Match): void {
  if (matches.get(match.id) !== match) return;
  stopHostWatch(match);
  matches.delete(match.id);
  for (const socketId of match.socketIds.values()) io.sockets.sockets.get(socketId)?.leave(match.room);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
}

function beginPlaying(io: Server, match: Match): void {
  if (match.phase !== 'countdown' || match.paused || !isCurrent(match)) return;
  match.phase = 'playing';
  for (const entry of match.runs.values()) beginAttempt(entry);
  scheduleMatch(match, timing().matchLimitMs, () => finishMatch(io, match, 'time-limit'));
  emitAllStates(io, match);
}

function pauseMatch(match: Match): void {
  if (match.paused || match.phase === 'ended') return;
  const now = Date.now();
  for (const entry of match.runs.values()) {
    clearRunTimer(entry);
    if (entry.ended === null) freezeAttempt(entry, now);
  }
  match.pausedRemainingMs = match.deadlineAt === null ? null : Math.max(0, match.deadlineAt - now);
  clearMatchTimer(match);
  match.paused = true;
}

// Every run continues with the very same attempt in the same phase.
function resumeMatch(io: Server, match: Match): void {
  if (!match.paused || match.phase === 'ended') return;
  match.paused = false;
  const remaining = match.pausedRemainingMs ?? 0;
  match.pausedRemainingMs = null;
  if (match.phase === 'countdown') return scheduleMatch(match, remaining, () => beginPlaying(io, match));
  scheduleMatch(match, remaining, () => finishMatch(io, match, 'time-limit'));
  const now = Date.now();
  for (const [playerId, entry] of match.runs) {
    if (entry.ended !== null) continue;
    if (entry.run.phase === 'memorize' || entry.run.phase === 'input') entry.attemptRunningSince = now;
    armRunTimer(io, match, playerId, entry);
  }
}

// Whether the player's match socket may still act in the match's group and
// event. A socket that switched events or lost event access stays connected
// but can neither pause nor end the round.
function canReachMatch(io: Server, match: Match, playerId: string): boolean {
  const socketId = match.socketIds.get(playerId);
  const socket = socketId ? io.sockets.sockets.get(socketId) : undefined;
  return Boolean(socket && socketCanUseArcadeScope(socket, match));
}

// A host who is gone for good (left, past the reconnect grace or without the
// match scope) must not freeze the round: the controls pass to the first
// player who can still reach the match, still playing ones first, and a pause
// the host left behind is lifted so the match time limit runs again.
function handOverHost(io: Server, match: Match): void {
  if (!isCurrent(match)) return;
  const reachable = match.players.filter((player) => player.id !== match.host.id && canReachMatch(io, match, player.id));
  const next = reachable.find((player) => match.runs.get(player.id)?.ended === null) ?? reachable[0];
  if (!next && !match.paused) return;
  if (next) match.host = next;
  if (match.paused) resumeMatch(io, match);
  emitAllStates(io, match);
}

function stopHostWatch(match: Match): void {
  if (match.hostWatch) clearInterval(match.hostWatch);
  match.hostWatch = null;
}

// A disconnected host is handled by the reconnect grace in the disconnect
// handler. A host whose socket stays connected but leaves the match scope
// (event switch, lost event access) fires no event here, so the match checks
// that host periodically and hands over after the same grace.
function watchHost(io: Server, match: Match): void {
  const graceMs = timing().reconnectGraceMs;
  let lost: { hostId: string; since: number } | null = null;
  match.hostWatch = setInterval(() => {
    if (!isCurrent(match)) return stopHostWatch(match);
    const hostId = match.host.id;
    if (!match.socketIds.has(hostId) || canReachMatch(io, match, hostId)) {
      lost = null;
      return;
    }
    const now = Date.now();
    if (lost?.hostId !== hostId) lost = { hostId, since: now };
    else if (now - lost.since >= graceMs) {
      lost = null;
      handOverHost(io, match);
    }
  }, Math.max(10, Math.round(graceMs / 3)));
  match.hostWatch.unref();
}

function attachSocket(io: Server, socket: Socket, match: Match, playerId: string): boolean {
  const entry = match.runs.get(playerId);
  if (!entry || entry.ended === 'left' || match.phase === 'ended') return false;
  const previousTimer = match.reconnectTimers.get(playerId);
  if (previousTimer) clearTimeout(previousTimer);
  match.reconnectTimers.delete(playerId);
  match.socketIds.set(playerId, socket.id);
  socket.join(match.room);
  // A reconnect during the reveal skips straight to the interstitial; the
  // attempt itself is never replaced.
  if (entry.ended === null && entry.run.phase === 'reveal' && !match.paused && match.phase === 'playing') {
    clearRunTimer(entry);
    finishChimpReveal(entry.run);
    if ((entry.run.phase as string) === 'out') {
      socket.emit('chimp:match:start', { matchId: match.id, host: match.host, players: match.players, reconnected: true });
      endRun(io, match, playerId, 'strikes');
      return true;
    }
    armRunTimer(io, match, playerId, entry);
  }
  socket.emit('chimp:match:start', { matchId: match.id, host: match.host, players: match.players, reconnected: true });
  socket.emit('chimp:state', matchStatePayload(match, playerId));
  emitStandings(io, match);
  return true;
}

function startMatch(io: Server, lobby: Lobby): Match {
  const id = nanoid();
  const room = `chimp:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const seed = randomInt(0, 0x7fffffff);
  const match: Match = {
    id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players],
    socketIds: new Map(lobby.socketIds), seed, phase: 'countdown',
    runs: new Map(lobby.players.map((player) => [player.id, {
      run: startChimpRun(seed, player.id), levelToken: '', attemptElapsed: 0, attemptRunningSince: 0, firstClickAt: 0,
      levelCompletedAt: null, timer: null, ended: null, endDetails: null,
    }])),
    startedAt: Date.now(), timer: null, deadlineAt: null, paused: false, pausedRemainingMs: null, reconnectTimers: new Map(),
    hostWatch: null, closing: false,
  };
  matches.set(id, match);
  releaseLobbyMemberships(lobby.players.map((player) => player.id), 'chimp', lobby.id);
  lobbies.delete(lobby.id);
  resolveArcadeLobbyPush('chimp', lobby);
  emitLobbies(io);
  startArcadeSession(match.players.map((player) => player.id), 'chimp', match);
  emitArcadeRoom(io, room, 'chimp:match:start', { matchId: id, host: match.host, players: match.players }, match);
  scheduleMatch(match, arcadeTiming.countdownMs, () => beginPlaying(io, match));
  watchHost(io, match);
  emitAllStates(io, match);
  return match;
}

function handleClick(io: Server, match: Match, playerId: string, levelToken: unknown, cell: unknown) {
  const entry = match.runs.get(playerId);
  if (match.phase !== 'playing' || match.paused || !entry || entry.ended !== null) return { ok: false, error: 'Eingabe nicht möglich.' };
  if (typeof levelToken !== 'string' || levelToken !== entry.levelToken) return { ok: true, ignored: true, reason: 'stale-attempt', me: ownRunPayload(entry) };
  const { run } = entry;
  const result = applyChimpClick(run, cell, attemptElapsed(entry));
  if (result === 'invalid') return { ok: false, error: 'Ungültiges Feld.', me: ownRunPayload(entry) };
  if (result === 'ignored') return { ok: true, ignored: true, me: ownRunPayload(entry) };
  const now = Date.now();
  if (entry.firstClickAt === 0) entry.firstClickAt = now;
  if (result === 'correct') {
    armRunTimer(io, match, playerId, entry);
    emitStandings(io, match);
    return { ok: true, result, me: ownRunPayload(entry) };
  }
  freezeAttempt(entry, now);
  if (result === 'strike') {
    afterStrike(io, match, playerId, entry);
    return { ok: true, result, me: ownRunPayload(entry) };
  }
  // level-complete
  entry.levelCompletedAt = now;
  if (isImplausibleChimpInput(run.level, now - entry.firstClickAt)) {
    endRun(io, match, playerId, 'invalid');
    return { ok: true, result: 'invalid-run', me: ownRunPayload(entry) };
  }
  if (run.phase === 'out') {
    endRun(io, match, playerId, 'max');
    return { ok: true, result, me: ownRunPayload(entry) };
  }
  armRunTimer(io, match, playerId, entry);
  emitOwnState(io, match, playerId);
  emitStandings(io, match);
  return { ok: true, result, me: ownRunPayload(entry) };
}

function removeLobbyMember(io: Server, lobby: Lobby, playerId: string): void {
  if (playerId === lobby.host.id) {
    releaseLobbyMemberships(lobby.players.map((player) => player.id), 'chimp', lobby.id);
    lobbies.delete(lobby.id);
    resolveArcadeLobbyPush('chimp', lobby);
  } else {
    releaseLobbyMembership(playerId, 'chimp', lobby.id);
    lobby.players = lobby.players.filter((player) => player.id !== playerId);
    lobby.socketIds.delete(playerId);
    lobby.ready.delete(playerId);
  }
  emitLobbies(io);
}

type Ack = ((result: unknown) => void) | undefined;
const matchFor = (payload: { matchId?: unknown } | undefined): Match | null => (typeof payload?.matchId === 'string' ? matches.get(payload.matchId) ?? null : null);

export function registerChimpSockets(io: Server): () => void {
  return registerSocketConnection(io, 'arcade-chimp', (socket: Socket) => {
    const sendLobbies = () => {
      const scope = socketArcadeScope(socket);
      if (scope) socket.emit('chimp:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
    };
    sendLobbies();
    socket.on('chimp:lobbies:get', sendLobbies);
    socket.on('scope:subscribe', sendLobbies);
    socket.on('room:subscribe', sendLobbies);
    const authPlayerId = socket.data.authPlayerId;
    if (typeof authPlayerId === 'string') {
      for (const match of matches.values()) if (match.runs.has(authPlayerId) && canUseLobby(socket, match)) attachSocket(io, socket, match, authPlayerId);
    }

    socket.on('chimp:match:reconnect', (payload: { matchId?: string; playerId?: string }, ack: Ack) => {
      const match = matchFor(payload);
      if (!match || !owns(socket, payload?.playerId) || !canUseLobby(socket, match) || !attachSocket(io, socket, match, payload.playerId as string)) {
        return ack?.({ ok: false, error: 'Match-Wiederaufnahme verweigert.' });
      }
      ack?.({ ok: true });
    });

    socket.on('chimp:lobby:create', (payload: { playerId?: string }, ack: Ack) => {
      const player = playerById(payload?.playerId);
      const scope = player ? socketArcadeScope(socket, player.id) : null;
      if (!player || !scope) return ack?.({ ok: false, error: 'Spieler- oder Community-Zugriff verweigert.' });
      if (hasActiveRun(player.id)) return ack?.({ ok: false, error: 'Beende zuerst deinen laufenden Chimp Test.' });
      const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'chimp', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' });
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
      notifyArcadeLobbyOpened('chimp', lobby);
    });

    socket.on('chimp:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack: Ack) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player || !canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (hasActiveRun(player.id)) return ack?.({ ok: false, error: 'Beende zuerst deinen laufenden Chimp Test.' });
      const member = lobby.players.some((entry) => entry.id === player.id);
      if (!member && lobby.players.length >= MAX_PLAYERS) return ack?.({ ok: false, error: 'Lobby ist voll.' });
      if (!claimLobbyMembership(player.id, 'chimp', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer Arcade-Lobby.' });
      if (!member) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('chimp:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack: Ack) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload?.playerId) || !lobby.players.some((player) => player.id === payload.playerId)) {
        return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      }
      removeLobbyMember(io, lobby, payload.playerId as string);
      ack?.({ ok: true });
    });

    socket.on('chimp:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack: Ack) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload?.playerId) || !setLobbyReady(lobby, payload.playerId, payload.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('chimp:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack: Ack) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !owns(socket, payload?.playerId) || payload.playerId !== lobby.host.id) {
        return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      }
      if (lobby.players.some((player) => !isLobbyReady(lobby, player.id))) return ack?.({ ok: false, error: 'Alle Mitspieler müssen bereit sein.' });
      const match = startMatch(io, lobby);
      ack?.({ ok: true, matchId: match.id });
    });

    socket.on('chimp:click', (payload: { matchId?: string; playerId?: string; levelToken?: unknown; cell?: unknown }, ack: Ack) => {
      const match = matchFor(payload);
      if (!match || !owns(socket, payload?.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
      ack?.(handleClick(io, match, payload.playerId as string, payload.levelToken, payload.cell));
    });

    socket.on('chimp:continue', (payload: { matchId?: string; playerId?: string; levelToken?: unknown }, ack: Ack) => {
      const match = matchFor(payload);
      const playerId = payload?.playerId;
      const entry = match && typeof playerId === 'string' ? match.runs.get(playerId) : undefined;
      if (!match || !entry || !owns(socket, playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Weiter nicht möglich.' });
      if (match.phase !== 'playing' || match.paused || entry.ended !== null) return ack?.({ ok: false, error: 'Weiter nicht möglich.' });
      // The token of the finished attempt makes a double "Weiter" a no-op
      // instead of skipping the next level's memorize phase.
      if (payload.levelToken !== entry.levelToken || entry.run.phase !== 'interstitial') return ack?.({ ok: true, ignored: true, me: ownRunPayload(entry) });
      continueRun(io, match, playerId as string, entry);
      ack?.({ ok: true, me: ownRunPayload(entry) });
    });

    socket.on('chimp:match:pause', (payload: { matchId?: string; playerId?: string }, ack: Ack) => {
      const match = matchFor(payload);
      if (!match || match.phase === 'ended' || payload?.playerId !== match.host.id || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) {
        return ack?.({ ok: false, error: 'Pause ist in dieser Phase nicht möglich.' });
      }
      if (match.paused) resumeMatch(io, match);
      else pauseMatch(match);
      emitAllStates(io, match);
      ack?.({ ok: true, paused: match.paused });
    });

    socket.on('chimp:match:finish', (payload: { matchId?: string; playerId?: string }, ack: Ack) => {
      const match = matchFor(payload);
      if (!match || match.phase === 'ended' || payload?.playerId !== match.host.id || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) {
        return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      }
      finishMatch(io, match, 'ended-by-host');
      ack?.({ ok: true });
    });

    socket.on('chimp:match:leave', (payload: { matchId?: string; playerId?: string }, ack: Ack) => {
      const match = matchFor(payload);
      const playerId = payload?.playerId;
      const entry = match && typeof playerId === 'string' ? match.runs.get(playerId) : undefined;
      if (!match || !entry || match.phase === 'ended' || !owns(socket, playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Verlassen nicht möglich.' });
      if (entry.ended === null) endRun(io, match, playerId as string, 'left');
      if (isCurrent(match)) {
        match.socketIds.delete(playerId as string);
        socket.leave(match.room);
        if (playerId === match.host.id) handOverHost(io, match);
      }
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      for (const [id, lobby] of lobbies) {
        const member = [...lobby.socketIds.entries()].find(([, socketId]) => socketId === socket.id);
        if (member && lobbies.get(id) === lobby) removeLobbyMember(io, lobby, member[0]);
      }
      for (const match of matches.values()) {
        for (const [playerId, socketId] of match.socketIds) {
          if (socketId !== socket.id) continue;
          match.socketIds.delete(playerId);
          const entry = match.runs.get(playerId);
          const isHost = playerId === match.host.id;
          if (!entry || match.phase === 'ended' || (entry.ended !== null && !isHost)) continue;
          // The run keeps its attempt and its active time keeps running; only
          // a player who does not return within the grace period is out. A
          // host whose own run is already over still holds the controls, so
          // they are handed over the same way.
          const timer = setTimeout(() => {
            match.reconnectTimers.delete(playerId);
            if (!isCurrent(match) || match.socketIds.has(playerId)) return;
            if (entry.ended === null) endRun(io, match, playerId, 'disconnect');
            if (match.host.id === playerId) handOverHost(io, match);
          }, timing().reconnectGraceMs);
          timer.unref();
          match.reconnectTimers.set(playerId, timer);
          emitStandings(io, match);
        }
      }
    });
  });
}
