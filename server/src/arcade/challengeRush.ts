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
import { CHALLENGES, challengePayload, isCurrentChallenge, isReadyForNext, remainingUntil, scoreCps, scoreNumberSalad, scoreReaction, scoreTiming10, winnerIdForScores, type ChallengeKey } from './challengeRushLogic';

const MAX_PLAYERS = 15;
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_RESULT_READY_TIMEOUT_MS = 20_000;
const END_REVEAL_MS = 12_000;

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; groupId: string; eventId: string | null; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface Progress { clicks: number; errors: number; correct: number; completed: boolean; score: number; startedAt: number; elapsedBeforePause: number; lastInputAt: number }
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
const real = (players: Player[]) => players.filter((player) => !player.id.startsWith('bot-')).map((player) => player.id);
const playerById = (id: unknown): Player | null => typeof id === 'string' ? (db.prepare('SELECT id,name,avatar,color FROM players WHERE id=?').get(id) as Player | undefined) ?? null : null;
const owns = (socket: Socket, id: unknown): id is string => typeof id === 'string' && Boolean(socketArcadeScope(socket, id));
const publicLobbies = (groupId: string, eventId: string | null) => [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({ id: l.id, host: l.host, players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })), createdAt: l.createdAt }));
const reconnectGraceMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RECONNECT_GRACE_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(60_000, configured)) : DEFAULT_RECONNECT_GRACE_MS; };
const resultReadyTimeoutMs = (): number => { const configured = Number(process.env.CHALLENGE_RUSH_RESULT_TIMEOUT_MS); return Number.isFinite(configured) ? Math.max(50, Math.min(120_000, configured)) : DEFAULT_RESULT_READY_TIMEOUT_MS; };

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
  return { clicks: progress.clicks, correct: progress.correct, errors: progress.errors, completed: progress.completed, score: progress.score };
}

function activeElapsed(progress: Progress, now = Date.now()): number {
  return progress.elapsedBeforePause + (progress.startedAt > 0 ? Math.max(0, now - progress.startedAt) : 0);
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
  if (match.phase === 'playing') for (const progress of match.progress.values()) if (!progress.completed) progress.startedAt = Date.now();
  if (match.phase === 'countdown') schedule(match, remaining, () => beginChallenge(io, match));
  else if (match.phase === 'playing') schedule(match, remaining, () => finishChallenge(io, match));
  else if (match.phase === 'result') schedule(match, remaining, () => nextChallenge(io, match));
}

function publicState(match: Match) {
  return {
    matchId: match.id, phase: match.phase, challengeIndex: match.index, challengeCount: match.order.length,
    challenge: match.current, scores: scorePayload(match), paused: match.paused,
    remainingMs: match.paused ? match.pausedRemainingMs : remainingUntil(match.deadlineAt, Date.now()),
    history: match.history, readyNext: match.phase === 'result' ? [...match.readyNext] : [],
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
  for (const progress of match.progress.values()) { progress.startedAt = now; progress.elapsedBeforePause = 0; }
  schedule(match, match.current.durationMs, () => finishChallenge(io, match));
  emitState(io, match);
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
      progress.score = match.current.key === 'cps' ? scoreCps(progress.clicks) : match.current.key === 'number-salad' ? scoreNumberSalad(progress.correct, progress.errors, elapsed) : match.current.key === 'timing-10' ? scoreTiming10(elapsed) : 0;
      progress.completed = true;
    }
    match.scores.set(player.id, (match.scores.get(player.id) ?? 0) + progress.score);
  }
  match.history.push({ key: match.current.key, title: match.current.title, scores: match.players.map((player) => ({ playerId: player.id, name: player.name, score: match.progress.get(player.id)!.score })) });
  emitState(io, match);
  emitArcadeRoom(io, match.room, 'challenge-rush:challenge:end', { matchId: match.id, scores: scorePayload(match) }, match);
  // Players confirm they've seen the result via challenge-rush:challenge:ready;
  // this is only the reliability fallback so an AFK/forgotten click can't stall the match forever.
  schedule(match, resultReadyTimeoutMs(), () => nextChallenge(io, match));
}

function nextChallenge(io: Server, match: Match): void {
  if (matches.get(match.id) !== match || match.phase === 'ended') return;
  if (match.index + 1 >= match.order.length) return finishMatch(io, match);
  match.index += 1;
  match.phase = 'countdown';
  match.current = challengePayload(match.order[match.index], (match.seed + match.index * 7919) >>> 0);
  match.progress = new Map(match.players.map((player) => [player.id, { clicks: 0, errors: 0, correct: 0, completed: false, score: 0, startedAt: 0, elapsedBeforePause: 0, lastInputAt: 0 }]));
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
  emitState(io, match, socket);
}

function startMatch(io: Server, lobby: Lobby): Match {
  const id = nanoid(); const room = `challenge-rush:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const seed = Math.floor(Math.random() * 0x7fffffff); const order = CHALLENGES.map((challenge) => challenge.key);
  const match: Match = { id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players], socketIds: new Map(lobby.socketIds), order, index: -1, phase: 'countdown', seed, current: challengePayload(order[0], seed), progress: new Map(), scores: new Map(lobby.players.map((player) => [player.id, 0])), startedAt: Date.now(), timer: null, deadlineAt: null, pausedRemainingMs: null, paused: false, reconnectTimers: new Map(), forfeited: new Set(), readyNext: new Set(), history: [] };
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
    socket.on('challenge-rush:challenge:input', (payload: { matchId?: string; playerId?: string; challengeIndex?: number; action?: string; value?: number | { x?: number; y?: number } }, ack?: (r: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null; const p = match && payload.playerId ? match.progress.get(payload.playerId) : null;
      if (!match || match.phase !== 'playing' || match.paused || !p || !owns(socket, payload.playerId) || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Eingabe nicht möglich.' });
      const progress = () => ({ ok: true, progress: progressPayload(p) });
      if (!isCurrentChallenge(payload.challengeIndex ?? -1, match.index)) return ack?.({ ...progress(), ignored: true, reason: 'stale-challenge' });
      const now = Date.now(); if (p.completed) return ack?.({ ...progress(), duplicate: true }); if (now - p.lastInputAt < 30) return ack?.({ ...progress(), ignored: true }); p.lastInputAt = now;
      const elapsed = Math.min(activeElapsed(p, now), match.current.durationMs);
      if (match.current.key === 'reaction-circle') { const point = payload.value && typeof payload.value === 'object' ? payload.value : {}; const target = match.current.data; const validPoint = typeof point.x === 'number' && typeof point.y === 'number' && Math.abs(point.x - Number(target.x)) <= 12 && Math.abs(point.y - Number(target.y)) <= 12; if (payload.action !== 'hit' || !validPoint) return ack?.({ ok: false, error: 'Ungültiges Ziel.', progress: progressPayload(p) }); p.score = scoreReaction(elapsed); p.completed = true; }
      else if (match.current.key === 'cps') { if (payload.action !== 'click') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) }); p.clicks += 1; }
      else if (match.current.key === 'number-salad') { const expected = p.correct + 1; if (payload.action !== 'number' || payload.value !== expected) p.errors += 1; else p.correct += 1; if (p.correct >= 8) { p.score = scoreNumberSalad(p.correct, p.errors, elapsed); p.completed = true; } }
      else if (match.current.key === 'timing-10') { if (payload.action !== 'stop') return ack?.({ ok: false, error: 'Ungültige Eingabe.', progress: progressPayload(p) }); p.score = scoreTiming10(elapsed); p.completed = true; }
      if ([...match.progress.values()].every((entry) => entry.completed)) finishChallenge(io, match);
      ack?.({ ok: true, accepted: true, progress: progressPayload(p) });
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
