import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { BALL_RADIUS, PADDLE_HEIGHT, PADDLE_WIDTH, PONG_HEIGHT, PONG_WIDTH, PongInput, PongWorld, createWorld, stepWorld } from './pongLogic';
import { broadcastArcadeKiosk } from '../realtime';
import { recordArcadeResult } from './arcadeData';
import { arcadeTiming } from './timing';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';

const TICK_MS = 1000 / 60;
const SNAPSHOT_MS = 50;
const COUNTDOWN_MS = arcadeTiming.countdownMs;
const DEFAULT_TARGET_SCORE = 7;
const BOT_ID = 'pong-bot';
const BOT = { id: BOT_ID, name: 'Pong-Bot', avatar: null, color: '#ef5da8' };

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; groupId: string; eventId: string | null; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface Match {
  id: string;
  groupId: string;
  eventId: string | null;
  room: string;
  host: Player;
  players: Player[];
  socketIds: Map<string, string>;
  world: PongWorld;
  inputs: Map<string, PongInput>;
  scores: Map<string, number>;
  targetScore: number;
  loop: NodeJS.Timeout | null;
  running: boolean;
  paused: boolean;
  startedAt: number;
  lastTick: number;
  lastSnapshot: number;
  rallyResumeAt: number;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const idle = (): PongInput => ({ up: false, down: false });

function playerById(id: unknown): Player | null {
  if (typeof id !== 'string' || !id) return null;
  return (db.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').get(id) as Player | undefined) ?? null;
}

function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()].filter((lobby) => lobby.groupId === groupId && lobby.eventId === eventId).map((lobby) => ({
    id: lobby.id,
    host: lobby.host,
    players: lobby.players.map((player) => ({ ...player, ready: isLobbyReady(lobby, player.id) })),
    createdAt: lobby.createdAt,
  }));
}

function emitLobbies(io: Server) {
  for (const socket of io.sockets.sockets.values()) {
    const scope = socketArcadeScope(socket);
    if (scope) socket.emit('pong:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
  }
}

export function openLobbySummaries(groupId?: string, eventId?: string | null) {
  return [...lobbies.values()].filter((lobby) => !groupId || (lobby.groupId === groupId && (eventId === undefined || lobby.eventId === eventId))).map((lobby) => ({
    id: lobby.id,
    hostName: lobby.host.name,
    playerCount: lobby.players.length,
    createdAt: lobby.createdAt,
  }));
}

function scorePayload(match: Match) {
  return match.players.map((player) => ({ playerId: player.id, name: player.name, score: match.scores.get(player.id) ?? 0 }));
}

function snapshot(io: Server, match: Match) {
  const payload = {
    matchId: match.id,
    serverTime: Date.now(),
    running: match.running,
    paused: match.paused,
    world: match.world,
    scores: scorePayload(match),
    targetScore: match.targetScore,
    render: { width: PONG_WIDTH, height: PONG_HEIGHT, paddleWidth: PADDLE_WIDTH, paddleHeight: PADDLE_HEIGHT, ballRadius: BALL_RADIUS },
  };
  emitArcadeRoom(io, match.room, 'pong:state', payload, match);
  broadcastArcadeKiosk(io, { gameType: 'pong', groupId: match.groupId, eventId: match.eventId, ...payload, players: match.players });
}

function finish(io: Server, match: Match, winner: Player | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  const winnerId = winner?.id === BOT_ID ? null : winner?.id ?? null;
  recordArcadeResult({
    gameType: 'pong',
    winnerId,
    players: match.players,
    scores: scorePayload(match),
    reason,
    startedAt: match.startedAt,
    scope: match,
  });
  emitArcadeRoom(io, match.room, 'pong:match:end', { matchId: match.id, winner, reason, scores: scorePayload(match) }, match);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
  matches.delete(match.id);
}

function steerBot(match: Match) {
  const index = match.players.findIndex((player) => player.id === BOT_ID);
  if (index < 0) return;
  const paddle = match.world.paddles[index];
  const input = match.inputs.get(BOT_ID);
  if (!input) return;
  const ballApproaching = index === 0 ? match.world.ball.vx < 0 : match.world.ball.vx > 0;
  const idleTarget = (PONG_HEIGHT - PADDLE_HEIGHT) / 2;
  const target = ballApproaching ? match.world.ball.y - PADDLE_HEIGHT / 2 : idleTarget;
  const deadZone = ballApproaching ? 24 : 42;
  input.up = target < paddle.y - deadZone;
  input.down = target > paddle.y + deadZone;
}

function startLoop(io: Server, match: Match) {
  match.lastTick = Date.now();
  match.loop = setInterval(() => {
    const now = Date.now();
    const dt = (now - match.lastTick) / 1000;
    match.lastTick = now;
    if (!match.running || match.paused || now < match.rallyResumeAt) return;
    steerBot(match);
    const scorerIndex = stepWorld(
      match.world,
      match.players.map((player) => match.inputs.get(player.id) ?? idle()) as [PongInput, PongInput],
      dt
    );
    if (scorerIndex !== null) {
      const scorer = match.players[scorerIndex];
      const nextScore = (match.scores.get(scorer.id) ?? 0) + 1;
      match.scores.set(scorer.id, nextScore);
      emitArcadeRoom(io, match.room, 'pong:point', { scorer, scores: scorePayload(match) }, match);
      if (nextScore >= match.targetScore) return finish(io, match, scorer, 'completed');
      match.world = createWorld(scorerIndex === 0 ? 'right' : 'left');
      match.rallyResumeAt = now + 900;
      snapshot(io, match);
    }
    if (now - match.lastSnapshot >= SNAPSHOT_MS) {
      match.lastSnapshot = now;
      snapshot(io, match);
    }
  }, TICK_MS);
}

function removeFromLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const entry = [...lobby.socketIds].find(([, sid]) => sid === socketId);
    if (!entry) continue;
    if (entry[0] === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((p) => p.id), 'pong', id); lobbies.delete(id); }
    else {
      releaseLobbyMembership(entry[0], 'pong', id);
      lobby.socketIds.delete(entry[0]);
      lobby.ready.delete(entry[0]);
      lobby.players = lobby.players.filter((player) => player.id !== entry[0]);
    }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

export function registerPongSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const emitSocketLobbies = () => {
      const scope = socketArcadeScope(socket);
      if (scope) socket.emit('pong:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
    };
    emitSocketLobbies();
    socket.on('pong:lobbies:get', emitSocketLobbies);
    socket.on('scope:subscribe', emitSocketLobbies);
    socket.on('room:subscribe', emitSocketLobbies);

    socket.on('pong:lobby:create', (payload: { playerId?: string }, ack?: (result: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const lobby: Lobby = {
        id: nanoid(), ...scope, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'pong', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('pong:lobby:bot', (payload: { playerId?: string }, ack?: (result: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const lobby: Lobby = {
        id: nanoid(), ...scope, host: player, players: [player, BOT], socketIds: new Map([[player.id, socket.id]]), ready: new Set([BOT_ID]), createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'pong', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('pong:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobby gehört zu einer anderen Gruppe.' });
      const present = lobby.players.some((entry) => entry.id === player.id);
      if (!present && lobby.players.length >= 2) return ack?.({ ok: false, error: 'Lobby ist voll (1 gegen 1).' });
      if (!claimLobbyMembership(player.id, 'pong', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      if (!present) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('pong:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (lobby && payload.playerId === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((p) => p.id), 'pong', lobby.id); lobbies.delete(lobby.id); }
      else if (lobby && payload.playerId) {
        releaseLobbyMembership(payload.playerId, 'pong', lobby.id);
        lobby.players = lobby.players.filter((player) => player.id !== payload.playerId);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('pong:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('pong:lobby:start', (payload: { lobbyId?: string; playerId?: string; targetScore?: number }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canUseLobby(socket, lobby)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.players.length !== 2) return ack?.({ ok: false, error: 'Pong ist genau 1 gegen 1.' });
      const targetScore = payload.targetScore ?? DEFAULT_TARGET_SCORE;
      if (!Number.isInteger(targetScore) || targetScore < 1 || targetScore > 30) {
        return ack?.({ ok: false, error: 'Punkteziel muss zwischen 1 und 30 liegen.' });
      }

      const id = nanoid();
      const room = `pong:${id}`;
      for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
      const match: Match = {
        id,
        groupId: lobby.groupId,
        eventId: lobby.eventId,
        room,
        host: lobby.host,
        players: lobby.players,
        socketIds: new Map(lobby.socketIds),
        world: createWorld(),
        inputs: new Map(lobby.players.map((player) => [player.id, idle()])),
        scores: new Map(lobby.players.map((player) => [player.id, 0])),
        targetScore,
        loop: null,
        running: false,
        paused: false,
        startedAt: Date.now(),
        lastTick: Date.now(),
        lastSnapshot: 0,
        rallyResumeAt: 0,
      };
      matches.set(id, match);
      releaseLobbyMemberships(lobby.players.map((p) => p.id), 'pong', lobby.id);
      lobbies.delete(lobby.id);
      emitLobbies(io);
      const beginsAt = Date.now() + COUNTDOWN_MS;
      emitArcadeRoom(io, room, 'pong:match:start', { matchId: id, host: match.host, players: match.players, beginsAt, targetScore }, match);
      snapshot(io, match);
      startLoop(io, match);
      ack?.({ ok: true, matchId: id });
      setTimeout(() => {
        if (matches.get(id) === match) {
          match.running = true;
          match.lastTick = Date.now();
        }
      }, COUNTDOWN_MS);
    });

    socket.on('pong:input', (payload: { matchId?: string; playerId?: string; input?: Partial<PongInput> }) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      const input = payload?.playerId ? match?.inputs.get(payload.playerId) : null;
      if (!match || !canUseLobby(socket, match) || !input || payload.playerId === BOT_ID || !match.running || match.paused) return;
      input.up = payload.input?.up === true;
      input.down = payload.input?.down === true;
    });

    socket.on('pong:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      match.paused = true;
      emitArcadeRoom(io, match.room, 'pong:match:paused', { matchId: match.id }, match);
      snapshot(io, match);
      ack?.({ ok: true });
    });

    socket.on('pong:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      match.paused = false;
      match.lastTick = Date.now();
      emitArcadeRoom(io, match.room, 'pong:match:resumed', { matchId: match.id }, match);
      snapshot(io, match);
      ack?.({ ok: true });
    });

    socket.on('pong:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finish(io, match, null, 'ended-by-host');
      ack?.({ ok: true });
    });

    // Lets a non-host participant end a running match themselves instead of
    // relying on the host (who might be AFK) or a raw disconnect — same
    // outcome as a disconnect mid-match: the match ends, opponent wins.
    socket.on('pong:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const leaver = match.players.find((p) => p.id === payload?.playerId);
      if (!leaver) return ack?.({ ok: false, error: 'Du bist kein Teilnehmer dieses Matches.' });
      finish(io, match, match.players.find((p) => p.id !== leaver.id) ?? null, 'player-left');
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      removeFromLobbies(io, socket.id);
      for (const match of matches.values()) {
        const leaver = [...match.socketIds].find(([, sid]) => sid === socket.id)?.[0];
        if (!leaver) continue;
        finish(io, match, match.players.find((player) => player.id !== leaver) ?? null, 'player-left');
      }
    });
  });
}
