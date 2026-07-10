import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { BlobbyInput, BlobbyWorld, createWorld, stepWorld } from './blobbyLogic';

const TICK_MS = 1000 / 60;
const SNAPSHOT_MS = 50;
const COUNTDOWN_MS = 3000;
const TARGET_SCORE = 7;

interface PlayerRef { id: string; name: string }
interface Lobby { id: string; host: PlayerRef; players: PlayerRef[]; socketIds: Map<string, string>; createdAt: number }
interface Match {
  id: string; room: string; host: PlayerRef; players: PlayerRef[]; socketIds: Map<string, string>;
  world: BlobbyWorld; inputs: Map<string, BlobbyInput>; scores: Map<string, number>;
  loop: NodeJS.Timeout | null; running: boolean; paused: boolean; lastTick: number; lastSnapshot: number; startedAt: number;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const idle = (): BlobbyInput => ({ left: false, right: false, jump: false });

function playerById(id: unknown): PlayerRef | null {
  if (typeof id !== 'string' || !id) return null;
  return (db.prepare('SELECT id, name FROM players WHERE id = ?').get(id) as PlayerRef | undefined) ?? null;
}
function publicLobbies() {
  return [...lobbies.values()].map((l) => ({ id: l.id, host: l.host, players: l.players, createdAt: l.createdAt }));
}
function emitLobbies(io: Server) { io.emit('blobby:lobbies', { lobbies: publicLobbies() }); }
function scorePayload(match: Match) {
  return match.players.map((p) => ({ playerId: p.id, name: p.name, score: match.scores.get(p.id) ?? 0 }));
}
function snapshot(io: Server, match: Match) {
  io.to(match.room).emit('blobby:state', {
    matchId: match.id, serverTime: Date.now(), running: match.running, paused: match.paused,
    world: match.world, scores: scorePayload(match), targetScore: TARGET_SCORE,
  });
}
function finish(io: Server, match: Match, winner: PlayerRef | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  db.prepare(`INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nanoid(), 'blobby', winner?.id ?? null, JSON.stringify(match.players), JSON.stringify(scorePayload(match)), reason, match.startedAt, Date.now()
  );
  io.to(match.room).emit('blobby:match:end', { matchId: match.id, winner, reason, scores: scorePayload(match) });
  matches.delete(match.id);
}
function resetRally(match: Match, serveSide: 'left' | 'right') {
  match.world = createWorld(serveSide);
  for (const p of match.players) match.inputs.set(p.id, idle());
}
function startLoop(io: Server, match: Match) {
  match.lastTick = Date.now();
  match.loop = setInterval(() => {
    const now = Date.now();
    const dt = (now - match.lastTick) / 1000;
    match.lastTick = now;
    if (!match.running || match.paused) return;
    const landed = stepWorld(match.world, match.players.map((p) => match.inputs.get(p.id) ?? idle()) as [BlobbyInput, BlobbyInput], dt);
    // Jump is an edge-triggered action; movement remains held until key-up.
    for (const input of match.inputs.values()) input.jump = false;
    if (landed) {
      const scorerIndex = landed === 'left' ? 1 : 0;
      const scorer = match.players[scorerIndex];
      const next = (match.scores.get(scorer.id) ?? 0) + 1;
      match.scores.set(scorer.id, next);
      io.to(match.room).emit('blobby:point', { scorer, scores: scorePayload(match) });
      if (next >= TARGET_SCORE) return finish(io, match, scorer, 'completed');
      resetRally(match, scorerIndex === 0 ? 'left' : 'right');
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
    if (entry[0] === lobby.host.id) lobbies.delete(id);
    else { lobby.socketIds.delete(entry[0]); lobby.players = lobby.players.filter((p) => p.id !== entry[0]); }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

export function registerBlobbySockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('blobby:lobbies', { lobbies: publicLobbies() });
    socket.on('blobby:lobbies:get', () => socket.emit('blobby:lobbies', { lobbies: publicLobbies() }));
    socket.on('blobby:lobby:create', (payload: { playerId?: string }, ack?: (r: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      removeFromLobbies(io, socket.id);
      const lobby: Lobby = { id: nanoid(), host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), createdAt: Date.now() };
      lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('blobby:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      const present = lobby.players.some((p) => p.id === player.id);
      if (!present && lobby.players.length >= 2) return ack?.({ ok: false, error: 'Lobby ist voll (1v1).' });
      removeFromLobbies(io, socket.id);
      if (!present) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id); emitLobbies(io); ack?.({ ok: true });
    });
    socket.on('blobby:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || typeof payload.playerId !== 'string') return ack?.({ ok: true });
      if (lobby.host.id === payload.playerId) lobbies.delete(lobby.id);
      else { lobby.players = lobby.players.filter((p) => p.id !== payload.playerId); lobby.socketIds.delete(payload.playerId); }
      emitLobbies(io); ack?.({ ok: true });
    });
    socket.on('blobby:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.players.length !== 2) return ack?.({ ok: false, error: 'Blobby Volley ist genau 1 gegen 1.' });
      const id = nanoid(); const room = `blobby:${id}`;
      for (const sid of lobby.socketIds.values()) io.sockets.sockets.get(sid)?.join(room);
      const match: Match = {
        id, room, host: lobby.host, players: lobby.players, socketIds: new Map(lobby.socketIds), world: createWorld(),
        inputs: new Map(lobby.players.map((p) => [p.id, idle()])), scores: new Map(lobby.players.map((p) => [p.id, 0])),
        loop: null, running: false, paused: false, lastTick: Date.now(), lastSnapshot: 0, startedAt: Date.now(),
      };
      matches.set(id, match); lobbies.delete(lobby.id); emitLobbies(io);
      const beginsAt = Date.now() + COUNTDOWN_MS;
      io.to(room).emit('blobby:match:start', { matchId: id, host: match.host, players: match.players, beginsAt, targetScore: TARGET_SCORE });
      snapshot(io, match); startLoop(io, match); ack?.({ ok: true, matchId: id });
      setTimeout(() => { if (matches.get(id) === match) { match.running = true; match.lastTick = Date.now(); } }, COUNTDOWN_MS);
    });
    socket.on('blobby:input', (payload: { matchId?: string; playerId?: string; input?: Partial<BlobbyInput> }) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
      const input = typeof payload.playerId === 'string' ? match?.inputs.get(payload.playerId) : null;
      if (!match || !input || match.paused || !match.running) return;
      input.left = payload.input?.left === true;
      input.right = payload.input?.right === true;
      if (payload.input?.jump === true) input.jump = true;
    });
    socket.on('blobby:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload.playerId !== match.host.id) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finish(io, match, null, 'ended-by-host'); ack?.({ ok: true });
    });
    socket.on('disconnect', () => {
      removeFromLobbies(io, socket.id);
      for (const match of matches.values()) {
        const leaver = [...match.socketIds].find(([, sid]) => sid === socket.id)?.[0];
        if (!leaver) continue;
        finish(io, match, match.players.find((p) => p.id !== leaver) ?? null, 'player-left');
      }
    });
  });
}
