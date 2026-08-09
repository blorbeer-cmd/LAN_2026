import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import {
  createWorld,
  Direction,
  isInsideSafeBounds,
  setDirection,
  snakeArenaBotCount,
  SNAKE_ARENA_MAX_PLAYERS,
  SNAKE_ARENA_MIN_PLAYERS,
  SNAKE_HEIGHT,
  SNAKE_WIDTH,
  SnakeMode,
  SnakeWorld,
  stepWorld,
} from './snakeLogic';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { broadcastArcadeKiosk } from './realtime';
import { recordArcadeResult } from './arcadeData';
import { arcadeTiming } from './timing';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';

const TICK_MS = 125;
const COUNTDOWN_MS = arcadeTiming.countdownMs;
const BOT_ID = 'snake-bot';
const BOT = { id: BOT_ID, name: 'Snake-Bot', avatar: null, color: '#ef5da8' };
const BOT_ID_PREFIX = 'snake-bot-';

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; groupId: string; eventId: string | null; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; mode: SnakeMode; createdAt: number }
interface Match { id: string; groupId: string; eventId: string | null; room: string; host: Player; players: Player[]; socketIds: Map<string, string>; departedPlayerIds: Set<string>; mode: SnakeMode; world: SnakeWorld; loop: NodeJS.Timeout | null; running: boolean; paused: boolean; startedAt: number }

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();

function isSnakeBotId(playerId: string): boolean {
  return playerId === BOT_ID || playerId.startsWith(BOT_ID_PREFIX);
}

function arenaBots(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${BOT_ID_PREFIX}${index + 1}`,
    name: `Snake-Bot ${index + 1}`,
    avatar: null,
    color: '#ef5da8',
  }));
}

function playerById(id?: string): Player | null {
  if (!id) return null;
  return (db.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').get(id) as Player | undefined) ?? null;
}
function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()].filter((lobby) => lobby.groupId === groupId && lobby.eventId === eventId).map((lobby) => ({
    id: lobby.id,
    host: lobby.host,
    players: lobby.players.map((player) => ({ ...player, ready: isLobbyReady(lobby, player.id) })),
    mode: lobby.mode,
    playerLimit: lobby.mode === 'arena' ? SNAKE_ARENA_MAX_PLAYERS : 2,
    createdAt: lobby.createdAt,
  }));
}
function emitLobbies(io: Server) { for (const socket of io.sockets.sockets.values()) { const scope = socketArcadeScope(socket); if (scope) socket.emit('snake:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); } }

// Open-lobby summary for GET /api/arcade/lobbies — see arcade.ts.
export function openLobbySummaries(groupId?: string, eventId?: string | null) {
  return [...lobbies.values()].filter((lobby) => !groupId || (lobby.groupId === groupId && (eventId === undefined || lobby.eventId === eventId))).map((lobby) => ({
    id: lobby.id,
    hostName: lobby.host.name,
    playerCount: lobby.players.length,
    mode: lobby.mode,
    createdAt: lobby.createdAt,
  }));
}
function snapshot(io: Server, match: Match) {
  const scores = match.players.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    score: match.world.snakes[index]?.score ?? 0,
    isBot: isSnakeBotId(player.id),
  }));
  const payload = {
    matchId: match.id,
    world: match.world,
    running: match.running,
    paused: match.paused,
    host: match.host,
    serverTime: Date.now(),
    scores,
    render: { width: SNAKE_WIDTH, height: SNAKE_HEIGHT },
  };
  emitArcadeRoom(io, match.room, 'snake:state', payload, match);
  broadcastArcadeKiosk(io, { gameType: 'snake', groupId: match.groupId, eventId: match.eventId, ...payload, players: match.players });
}
function realPlayerIds(players: Player[]): string[] {
  return players.filter((p) => !isSnakeBotId(p.id)).map((p) => p.id);
}
function finish(io: Server, match: Match, winner: Player | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  endArcadeSession(realPlayerIds(match.players).filter((playerId) => !match.departedPlayerIds.has(playerId)), 'snake', match);
  const winnerId = winner && !isSnakeBotId(winner.id) ? winner.id : null;
  // Store per-player score entries (playerId/name/score), like every other
  // arcade game, so the stats route can attribute results to players. The
  // live emit below still sends the raw score array the client expects.
  const scoreEntries = match.players.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    score: match.world.snakes[index]?.score ?? 0,
    isBot: isSnakeBotId(player.id),
  }));
  recordArcadeResult({
    gameType: 'snake',
    winnerId,
    players: match.players,
    scores: scoreEntries,
    reason,
    startedAt: match.startedAt,
    scope: match,
  });
  emitArcadeRoom(io, match.room, 'snake:match:end', { winner, reason, scores: match.world.snakes.map((snake) => snake.score) }, match);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
  matches.delete(match.id);
}
function matchPlayerIdForSocket(match: Match, socket: Socket): string | null {
  return [...match.socketIds].find(([, socketId]) => socketId === socket.id)?.[0] ?? null;
}
function removeMatchPlayer(io: Server, match: Match, playerId: string): void {
  const leaverIndex = match.players.findIndex((player) => player.id === playerId);
  if (leaverIndex < 0) return;
  const socketId = match.socketIds.get(playerId);
  match.socketIds.delete(playerId);
  if (socketId) io.sockets.sockets.get(socketId)?.leave(match.room);
  if (match.mode !== 'arena') {
    finish(io, match, match.players.find((player) => player.id !== playerId) ?? null, 'player-left');
    return;
  }
  endArcadeSession([playerId], 'snake', match);
  match.departedPlayerIds.add(playerId);
  match.world.snakes[leaverIndex].alive = false;
  const livingPlayers = match.players.filter((_, index) => match.world.snakes[index].alive);
  if (!livingPlayers.some((player) => !isSnakeBotId(player.id))) {
    finish(io, match, null, 'no-human-players');
    return;
  }
  if (match.host.id === playerId && livingPlayers[0]) match.host = livingPlayers[0];
  if (livingPlayers.length <= 1) finish(io, match, livingPlayers[0] ?? null, livingPlayers.length ? 'completed' : 'draw');
  else snapshot(io, match);
}
function removeFromLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const entry = [...lobby.socketIds].find(([, id]) => id === socketId);
    if (!entry) continue;
    const playerId = entry[0];
    if (playerId === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((p) => p.id), 'snake', id); lobbies.delete(id); }
    else {
      releaseLobbyMembership(playerId, 'snake', id);
      lobby.players = lobby.players.filter((player) => player.id !== playerId);
      lobby.socketIds.delete(playerId);
      lobby.ready.delete(playerId);
    }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

function isSafe(world: SnakeWorld, snakeIndex: number, direction: Direction) {
  const snake = world.snakes[snakeIndex];
  const vector = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
  const head = { x: snake.body[0].x + vector[0], y: snake.body[0].y + vector[1] };
  if (!isInsideSafeBounds(head, world.safeBounds)) return false;
  return !world.snakes.some((other, otherIndex) => other.body.some((part, partIndex) => {
    // Moving into the own tail is safe when this turn does not grow.
    if (otherIndex === snakeIndex && partIndex === other.body.length - 1 && !(head.x === world.food.x && head.y === world.food.y)) return false;
    return part.x === head.x && part.y === head.y;
  }));
}
function botDirection(world: SnakeWorld, snakeIndex: number): Direction {
  const snake = world.snakes[snakeIndex];
  const head = snake.body[0];
  const horizontal: Direction = world.food.x < head.x ? 'left' : 'right';
  const vertical: Direction = world.food.y < head.y ? 'up' : 'down';
  const candidates = [Math.abs(world.food.x - head.x) >= Math.abs(world.food.y - head.y) ? horizontal : vertical, snake.direction, horizontal, vertical, 'up', 'right', 'down', 'left'] as Direction[];
  const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  return candidates.find((direction, candidateIndex, list) => direction !== opposite[snake.direction] && list.indexOf(direction) === candidateIndex && isSafe(world, snakeIndex, direction)) ?? snake.direction;
}
function steerBot(match: Match) {
  match.players.forEach((player, botIndex) => {
    if (isSnakeBotId(player.id)) setDirection(match.world.snakes[botIndex], botDirection(match.world, botIndex));
  });
}
function startMatch(io: Server, lobby: Lobby) {
  const id = nanoid();
  const room = `snake:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const match: Match = {
    id,
    groupId: lobby.groupId,
    eventId: lobby.eventId,
    room,
    host: lobby.host,
    players: lobby.players,
    socketIds: new Map(lobby.socketIds),
    departedPlayerIds: new Set(),
    mode: lobby.mode,
    world: createWorld(lobby.players.length, lobby.mode),
    loop: null,
    running: false,
    paused: false,
    startedAt: Date.now(),
  };
  matches.set(id, match);
  releaseLobbyMemberships(lobby.players.map((p) => p.id), 'snake', lobby.id);
  lobbies.delete(lobby.id);
  emitLobbies(io);
  startArcadeSession(realPlayerIds(match.players), 'snake', match);
  const beginsAt = Date.now() + COUNTDOWN_MS;
  emitArcadeRoom(io, room, 'snake:match:start', { matchId: id, host: match.host, players: match.players, mode: match.mode, beginsAt }, match);
  snapshot(io, match);
  match.loop = setInterval(() => {
    if (!match.running || match.paused) return;
    steerBot(match);
    const deaths = stepWorld(match.world);
    snapshot(io, match);
    if (deaths.length && match.world.snakes.filter((snake) => snake.alive).length <= 1) {
      const survivor = match.players.find((_, index) => match.world.snakes[index].alive) ?? null;
      finish(io, match, survivor, survivor ? 'completed' : 'draw');
    }
  }, TICK_MS);
  setTimeout(() => { if (matches.get(id) === match) match.running = true; }, COUNTDOWN_MS);
  return id;
}

export function registerSnakeSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const emitSocketLobbies = () => { const scope = socketArcadeScope(socket); if (scope) socket.emit('snake:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); };
    emitSocketLobbies();
    socket.on('snake:lobbies:get', emitSocketLobbies);
    socket.on('scope:subscribe', emitSocketLobbies);
    socket.on('room:subscribe', emitSocketLobbies);
    socket.on('snake:lobby:create', (payload: { playerId?: string; mode?: SnakeMode }, ack?: (result: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Spieler nicht gefunden.' });
      if (payload?.mode !== undefined && payload.mode !== 'classic' && payload.mode !== 'arena') return ack?.({ ok: false, error: 'Unbekannter Snake-Modus.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), mode: payload.mode ?? 'classic', createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'snake', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('snake:lobby:bot', (payload: { playerId?: string; mode?: SnakeMode }, ack?: (result: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Spieler nicht gefunden.' });
      if (payload?.mode !== undefined && payload.mode !== 'classic' && payload.mode !== 'arena') return ack?.({ ok: false, error: 'Unbekannter Snake-Modus.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const mode = payload.mode ?? 'classic';
      const bots = mode === 'arena' ? arenaBots(snakeArenaBotCount(mode)) : [BOT];
      const lobby: Lobby = { id: nanoid(), ...scope, host: player, players: [player, ...bots], socketIds: new Map([[player.id, socket.id]]), ready: new Set(bots.map((bot) => bot.id)), mode, createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'snake', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('snake:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobby gehört zu einer anderen Gruppe.' });
      const present = lobby.players.some((entry) => entry.id === player.id);
      const playerLimit = lobby.mode === 'arena' ? SNAKE_ARENA_MAX_PLAYERS : 2;
      if (!present && lobby.players.length >= playerLimit) return ack?.({ ok: false, error: lobby.mode === 'arena' ? 'Arena-Lobby ist voll (max. 8 Spieler).' : 'Lobby ist voll (1 gegen 1).' });
      if (!claimLobbyMembership(player.id, 'snake', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      if (!present) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('snake:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (lobby && payload.playerId === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((p) => p.id), 'snake', lobby.id); lobbies.delete(lobby.id); }
      else if (lobby && payload.playerId) {
        releaseLobbyMembership(payload.playerId, 'snake', lobby.id);
        lobby.players = lobby.players.filter((player) => player.id !== payload.playerId);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('snake:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('snake:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.mode === 'classic' && lobby.players.length !== 2) return ack?.({ ok: false, error: 'Klassisches Snake ist genau 1 gegen 1.' });
      if (lobby.mode === 'arena' && (lobby.players.length < SNAKE_ARENA_MIN_PLAYERS || lobby.players.length > SNAKE_ARENA_MAX_PLAYERS)) {
        return ack?.({ ok: false, error: 'Snake Arena braucht 3 bis 8 Spieler.' });
      }
      ack?.({ ok: true, matchId: startMatch(io, lobby) });
    });
    socket.on('snake:input', (payload: { matchId?: string; playerId?: string; direction?: Direction }) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      const index = match?.players.findIndex((player) => player.id === payload.playerId) ?? -1;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== matchPlayerIdForSocket(match, socket) || index < 0 || isSnakeBotId(match.players[index].id) || !payload.direction || !match.running || match.paused) return;
      setDirection(match.world.snakes[index], payload.direction);
    });
    socket.on('snake:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== matchPlayerIdForSocket(match, socket) || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      match.paused = true;
      emitArcadeRoom(io, match.room, 'snake:match:paused', undefined, match);
      snapshot(io, match);
      ack?.({ ok: true });
    });
    socket.on('snake:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== matchPlayerIdForSocket(match, socket) || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      match.paused = false;
      emitArcadeRoom(io, match.room, 'snake:match:resumed', undefined, match);
      snapshot(io, match);
      ack?.({ ok: true });
    });
    socket.on('snake:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== matchPlayerIdForSocket(match, socket) || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finish(io, match, null, 'aborted');
      ack?.({ ok: true });
    });
    // Explicit leave and disconnect are both immediate forfeits. Arena
    // matches continue while at least two snakes remain.
    socket.on('snake:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const socketPlayerId = matchPlayerIdForSocket(match, socket);
      if (!socketPlayerId || payload?.playerId !== socketPlayerId) return ack?.({ ok: false, error: 'Du kannst nur dein eigenes Match verlassen.' });
      removeMatchPlayer(io, match, socketPlayerId);
      ack?.({ ok: true });
    });
    socket.on('disconnect', () => {
      removeFromLobbies(io, socket.id);
      for (const match of [...matches.values()]) {
        const playerId = matchPlayerIdForSocket(match, socket);
        if (playerId) removeMatchPlayer(io, match, playerId);
      }
    });
  });
}
