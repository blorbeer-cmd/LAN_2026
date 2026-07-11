import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { adminUnlockValid } from '../auth';
import { createWorld, Direction, setDirection, SnakeWorld, stepWorld, SNAKE_HEIGHT, SNAKE_WIDTH } from './snakeLogic';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';

const TICK_MS = 125;
const COUNTDOWN_MS = 3000;
const BOT_ID = 'snake-bot';
const BOT = { id: BOT_ID, name: 'Snake-Bot', avatar: null, color: '#ef5da8' };

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface Match { id: string; room: string; host: Player; players: Player[]; world: SnakeWorld; loop: NodeJS.Timeout | null; running: boolean; paused: boolean; startedAt: number }

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();

function playerById(id?: string): Player | null {
  if (!id) return null;
  return (db.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').get(id) as Player | undefined) ?? null;
}
function publicLobbies() {
  return [...lobbies.values()].map((lobby) => ({
    id: lobby.id,
    host: lobby.host,
    players: lobby.players.map((player) => ({ ...player, ready: isLobbyReady(lobby, player.id) })),
    createdAt: lobby.createdAt,
  }));
}
function emitLobbies(io: Server) { io.emit('snake:lobbies', { lobbies: publicLobbies() }); }

// Open-lobby summary for GET /api/arcade/lobbies — see arcade.ts.
export function openLobbySummaries() {
  return [...lobbies.values()].map((lobby) => ({
    id: lobby.id,
    hostName: lobby.host.name,
    playerCount: lobby.players.length,
    createdAt: lobby.createdAt,
  }));
}
function snapshot(io: Server, match: Match) {
  io.to(match.room).emit('snake:state', { matchId: match.id, world: match.world, running: match.running, paused: match.paused, serverTime: Date.now() });
}
function realPlayerIds(players: Player[]): string[] {
  return players.filter((p) => p.id !== BOT_ID).map((p) => p.id);
}
function finish(io: Server, match: Match, winner: Player | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  endArcadeSession(realPlayerIds(match.players), 'snake');
  const winnerId = winner && winner.id !== BOT_ID ? winner.id : null;
  // Store per-player score entries (playerId/name/score), like every other
  // arcade game, so the stats route can attribute results to players. The
  // live emit below still sends the raw score array the client expects.
  const scoreEntries = match.players.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    score: match.world.snakes[index]?.score ?? 0,
  }));
  db.prepare('INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    nanoid(), 'snake', winnerId, JSON.stringify(match.players), JSON.stringify(scoreEntries), reason, match.startedAt, Date.now()
  );
  io.to(match.room).emit('snake:match:end', { winner, reason, scores: match.world.snakes.map((snake) => snake.score) });
  matches.delete(match.id);
}
function removeFromLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const entry = [...lobby.socketIds].find(([, id]) => id === socketId);
    if (!entry) continue;
    const playerId = entry[0];
    if (playerId === lobby.host.id) lobbies.delete(id);
    else {
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
  if (head.x < 0 || head.y < 0 || head.x >= SNAKE_WIDTH || head.y >= SNAKE_HEIGHT) return false;
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
  const botIndex = match.players.findIndex((player) => player.id === BOT_ID);
  if (botIndex >= 0) setDirection(match.world.snakes[botIndex], botDirection(match.world, botIndex));
}
function startMatch(io: Server, lobby: Lobby) {
  const id = nanoid();
  const room = `snake:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const match: Match = { id, room, host: lobby.host, players: lobby.players, world: createWorld(), loop: null, running: false, paused: false, startedAt: Date.now() };
  matches.set(id, match);
  lobbies.delete(lobby.id);
  emitLobbies(io);
  startArcadeSession(realPlayerIds(match.players), 'snake');
  const beginsAt = Date.now() + COUNTDOWN_MS;
  io.to(room).emit('snake:match:start', { matchId: id, host: match.host, players: match.players, beginsAt });
  snapshot(io, match);
  match.loop = setInterval(() => {
    if (!match.running || match.paused) return;
    steerBot(match);
    const deaths = stepWorld(match.world);
    snapshot(io, match);
    if (deaths.length) {
      const survivor = match.players.find((_, index) => match.world.snakes[index].alive) ?? null;
      finish(io, match, survivor, survivor ? 'completed' : 'draw');
    }
  }, TICK_MS);
  setTimeout(() => { if (matches.get(id) === match) match.running = true; }, COUNTDOWN_MS);
  return id;
}

export function registerSnakeSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('snake:lobbies', { lobbies: publicLobbies() });
    socket.on('snake:lobby:create', (payload: { playerId?: string }, ack?: (result: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Spieler nicht gefunden.' });
      removeFromLobbies(io, socket.id);
      const lobby: Lobby = { id: nanoid(), host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now() };
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('snake:lobby:bot', (payload: { playerId?: string; adminPin?: string }, ack?: (result: unknown) => void) => {
      if (!adminUnlockValid(payload?.adminPin)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Spieler nicht gefunden.' });
      removeFromLobbies(io, socket.id);
      const lobby: Lobby = { id: nanoid(), host: player, players: [player, BOT], socketIds: new Map([[player.id, socket.id]]), ready: new Set([BOT_ID]), createdAt: Date.now() };
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('snake:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      const present = lobby.players.some((entry) => entry.id === player.id);
      if (!present && lobby.players.length >= 2) return ack?.({ ok: false, error: 'Lobby ist voll (1 gegen 1).' });
      removeFromLobbies(io, socket.id);
      if (!present) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('snake:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (lobby && payload.playerId === lobby.host.id) lobbies.delete(lobby.id);
      else if (lobby && payload.playerId) {
        lobby.players = lobby.players.filter((player) => player.id !== payload.playerId);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('snake:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      emitLobbies(io);
      ack?.({ ok: true });
    });
    socket.on('snake:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.players.length !== 2) return ack?.({ ok: false, error: 'Snake ist genau 1 gegen 1.' });
      ack?.({ ok: true, matchId: startMatch(io, lobby) });
    });
    socket.on('snake:input', (payload: { matchId?: string; playerId?: string; direction?: Direction }) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      const index = match?.players.findIndex((player) => player.id === payload.playerId) ?? -1;
      if (!match || index < 0 || match.players[index].id === BOT_ID || !payload.direction || !match.running || match.paused) return;
      setDirection(match.world.snakes[index], payload.direction);
    });
    socket.on('snake:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      match.paused = true;
      io.to(match.room).emit('snake:match:paused');
      snapshot(io, match);
      ack?.({ ok: true });
    });
    socket.on('snake:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      match.paused = false;
      io.to(match.room).emit('snake:match:resumed');
      snapshot(io, match);
      ack?.({ ok: true });
    });
    socket.on('snake:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finish(io, match, null, 'aborted');
      ack?.({ ok: true });
    });
    socket.on('disconnect', () => removeFromLobbies(io, socket.id));
  });
}
