import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { BALL_RADIUS, PADDLE_HEIGHT, PADDLE_WIDTH, PONG_HEIGHT, PONG_WIDTH, PongInput, PongMode, PongTeam, PongWorld, createWorld, pongPointScorerName, stepWorld } from './pongLogic';
import { broadcastArcadeKiosk } from './realtime';
import { recordArcadeResult } from './arcadeData';
import { arcadeTiming } from './timing';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';

const TICK_MS = 1000 / 60;
const SNAPSHOT_MS = 50;
const COUNTDOWN_MS = arcadeTiming.countdownMs;
const DEFAULT_DUEL_TARGET_SCORE = 7;
const DEFAULT_DOUBLES_TARGET_SCORE = 21;
const BOT_ID = 'pong-bot';
const BOT = { id: BOT_ID, name: 'Pong-Bot', avatar: null, color: '#ef5da8' };
const BOT_ID_PREFIX = 'pong-bot-';

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface LobbyPlayer extends Player { team: PongTeam }
interface Lobby { id: string; groupId: string; eventId: string | null; mode: PongMode; host: LobbyPlayer; players: LobbyPlayer[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface Match {
  id: string;
  groupId: string;
  eventId: string | null;
  room: string;
  mode: PongMode;
  host: LobbyPlayer;
  players: LobbyPlayer[];
  socketIds: Map<string, string>;
  world: PongWorld;
  inputs: Map<string, PongInput>;
  scores: Map<PongTeam, number>;
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
const playerLimit = (mode: PongMode) => mode === 'doubles' ? 4 : 2;
const opposingTeam = (team: PongTeam): PongTeam => team === 'left' ? 'right' : 'left';

function isBotId(playerId: string): boolean {
  return playerId === BOT_ID || playerId.startsWith(BOT_ID_PREFIX);
}

function doublesBots(): LobbyPlayer[] {
  return [
    { id: `${BOT_ID_PREFIX}1`, name: 'Pong-Bot Partner', avatar: null, color: '#ef5da8', team: 'left' },
    { id: `${BOT_ID_PREFIX}2`, name: 'Pong-Bot Gegner 1', avatar: null, color: '#ef5da8', team: 'right' },
    { id: `${BOT_ID_PREFIX}3`, name: 'Pong-Bot Gegner 2', avatar: null, color: '#ef5da8', team: 'right' },
  ];
}

function playerById(id: unknown): Player | null {
  if (typeof id !== 'string' || !id) return null;
  return (db.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').get(id) as Player | undefined) ?? null;
}

function lobbyPlayer(player: Player, team: PongTeam): LobbyPlayer {
  return { ...player, team };
}

function socketControlsPlayer(socket: Socket, resource: { socketIds: Map<string, string> }, playerId: unknown): playerId is string {
  return typeof playerId === 'string' && resource.socketIds.get(playerId) === socket.id;
}

function teamSize(lobby: Lobby, team: PongTeam): number {
  return lobby.players.filter((player) => player.team === team).length;
}

function availableTeam(lobby: Lobby, requested: unknown): PongTeam | null {
  const perTeam = lobby.mode === 'doubles' ? 2 : 1;
  if ((requested === 'left' || requested === 'right') && teamSize(lobby, requested) < perTeam) return requested;
  if (requested !== undefined && requested !== 'auto') return null;
  const left = teamSize(lobby, 'left');
  const right = teamSize(lobby, 'right');
  if (left >= perTeam && right >= perTeam) return null;
  return left <= right && left < perTeam ? 'left' : 'right';
}

function lobbyCanStart(lobby: Lobby): boolean {
  const perTeam = lobby.mode === 'doubles' ? 2 : 1;
  return lobby.players.length === playerLimit(lobby.mode)
    && teamSize(lobby, 'left') === perTeam
    && teamSize(lobby, 'right') === perTeam
    && lobby.players.every((player) => isLobbyReady(lobby, player.id));
}

function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()].filter((lobby) => lobby.groupId === groupId && lobby.eventId === eventId).map((lobby) => ({
    id: lobby.id,
    mode: lobby.mode,
    host: lobby.host,
    players: lobby.players.map((player) => ({ ...player, ready: isLobbyReady(lobby, player.id) })),
    playerLimit: playerLimit(lobby.mode),
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
    playerLimit: playerLimit(lobby.mode),
    mode: lobby.mode,
    createdAt: lobby.createdAt,
  }));
}

function scorePayload(match: Match, winnerTeam?: PongTeam | null) {
  return match.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    team: player.team,
    score: match.scores.get(player.team) ?? 0,
    isBot: isBotId(player.id),
    ...(winnerTeam ? { isWinner: player.team === winnerTeam } : {}),
  }));
}

function snapshot(io: Server, match: Match) {
  const payload = {
    matchId: match.id,
    mode: match.mode,
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

function finish(io: Server, match: Match, winnerTeam: PongTeam | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  const winners = winnerTeam ? match.players.filter((player) => player.team === winnerTeam) : [];
  const winner = winners[0] ?? null;
  const resultScores = scorePayload(match, winnerTeam);
  recordArcadeResult({
    gameType: 'pong',
    winnerId: match.mode === 'duel' && winner && !isBotId(winner.id) ? winner.id : null,
    players: match.players,
    scores: resultScores,
    reason,
    startedAt: match.startedAt,
    scope: match,
  });
  emitArcadeRoom(io, match.room, 'pong:match:end', {
    matchId: match.id,
    winner,
    winners,
    winnerTeam,
    reason,
    scores: resultScores,
  }, match);
  broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId });
  matches.delete(match.id);
}

function steerBot(match: Match) {
  for (const paddle of match.world.paddles) {
    if (!paddle.playerId || !isBotId(paddle.playerId)) continue;
    const input = match.inputs.get(paddle.playerId);
    if (!input) continue;
    const ballApproaching = paddle.team === 'left' ? match.world.ball.vx < 0 : match.world.ball.vx > 0;
    const idleTarget = (PONG_HEIGHT - PADDLE_HEIGHT) / 2;
    const target = ballApproaching ? match.world.ball.y - PADDLE_HEIGHT / 2 : idleTarget;
    const deadZone = ballApproaching ? 24 : 42;
    input.up = target < paddle.y - deadZone;
    input.down = target > paddle.y + deadZone;
  }
}

function startLoop(io: Server, match: Match) {
  match.lastTick = Date.now();
  match.loop = setInterval(() => {
    const now = Date.now();
    const dt = (now - match.lastTick) / 1000;
    match.lastTick = now;
    if (!match.running || match.paused || now < match.rallyResumeAt) return;
    steerBot(match);
    const scoringTeam = stepWorld(
      match.world,
      match.world.paddles.map((paddle) => match.inputs.get(paddle.playerId ?? '') ?? idle()),
      dt
    );
    if (scoringTeam !== null) {
      const nextScore = (match.scores.get(scoringTeam) ?? 0) + 1;
      match.scores.set(scoringTeam, nextScore);
      emitArcadeRoom(io, match.room, 'pong:point', {
        scorer: {
          team: scoringTeam,
          name: pongPointScorerName(match.mode, scoringTeam, match.players),
        },
        scores: scorePayload(match),
      }, match);
      if (nextScore >= match.targetScore) return finish(io, match, scoringTeam, 'completed');
      match.world = createWorld(
        opposingTeam(scoringTeam),
        match.mode,
        match.players.map((player) => player.id)
      );
      for (const player of match.players) match.inputs.set(player.id, idle());
      match.rallyResumeAt = now + 1000;
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

    socket.on('pong:lobby:create', (payload: { playerId?: string; mode?: string }, ack?: (result: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const mode = payload?.mode ?? 'duel';
      if (mode !== 'duel' && mode !== 'doubles') return ack?.({ ok: false, error: 'Modus ist ungültig.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const host = lobbyPlayer(player, 'left');
      const lobby: Lobby = {
        id: nanoid(), ...scope, mode, host, players: [host], socketIds: new Map([[host.id, socket.id]]), ready: new Set(), createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'pong', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('pong:lobby:bot', (payload: { playerId?: string; mode?: PongMode }, ack?: (result: unknown) => void) => {
      if (!playerMayUseArcadeAi(payload?.playerId)) return ack?.({ ok: false, error: 'KI-Modus ist nur für Admins.' });
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const mode = payload.mode ?? 'duel';
      if (mode !== 'duel' && mode !== 'doubles') return ack?.({ ok: false, error: 'Modus ist ungültig.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const host = lobbyPlayer(player, 'left');
      const bots = mode === 'doubles' ? doublesBots() : [lobbyPlayer(BOT, 'right')];
      const lobby: Lobby = {
        id: nanoid(), ...scope, mode, host, players: [host, ...bots], socketIds: new Map([[host.id, socket.id]]), ready: new Set(bots.map((bot) => bot.id)), createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'pong', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('pong:lobby:join', (payload: { lobbyId?: string; playerId?: string; team?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobby gehört zu einer anderen Gruppe.' });
      const present = lobby.players.some((entry) => entry.id === player.id);
      const team = present ? lobby.players.find((entry) => entry.id === player.id)!.team : availableTeam(lobby, payload?.team);
      if (!present && (!team || lobby.players.length >= playerLimit(lobby.mode))) return ack?.({ ok: false, error: 'Team ist voll.' });
      if (!claimLobbyMembership(player.id, 'pong', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      if (!present && team) lobby.players.push(lobbyPlayer(player, team));
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('pong:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !socketControlsPlayer(socket, lobby, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
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
      if (!lobby || !canUseLobby(socket, lobby) || !socketControlsPlayer(socket, lobby, payload.playerId) || !setLobbyReady(lobby, payload?.playerId, payload?.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('pong:lobby:start', (payload: { lobbyId?: string; playerId?: string; targetScore?: number }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canUseLobby(socket, lobby)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (payload.playerId !== lobby.host.id || !socketControlsPlayer(socket, lobby, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (!lobbyCanStart(lobby)) {
        return ack?.({ ok: false, error: lobby.mode === 'doubles' ? 'Doppel braucht zwei bereite Teams.' : 'Duell braucht zwei bereite Spieler.' });
      }
      const targetScore = payload.targetScore ?? (lobby.mode === 'doubles' ? DEFAULT_DOUBLES_TARGET_SCORE : DEFAULT_DUEL_TARGET_SCORE);
      if (!Number.isInteger(targetScore) || targetScore < 1 || targetScore > 30) {
        return ack?.({ ok: false, error: 'Punkteziel muss zwischen 1 und 30 liegen.' });
      }

      const id = nanoid();
      const room = `pong:${id}`;
      for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
      const players = [...lobby.players].sort((a, b) => a.team.localeCompare(b.team));
      const match: Match = {
        id,
        groupId: lobby.groupId,
        eventId: lobby.eventId,
        room,
        mode: lobby.mode,
        host: lobby.host,
        players,
        socketIds: new Map(lobby.socketIds),
        world: createWorld('right', lobby.mode, players.map((player) => player.id)),
        inputs: new Map(lobby.players.map((player) => [player.id, idle()])),
        scores: new Map<PongTeam, number>([['left', 0], ['right', 0]]),
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
      emitArcadeRoom(io, room, 'pong:match:start', { matchId: id, mode: match.mode, host: match.host, players: match.players, beginsAt, targetScore }, match);
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

    socket.on('pong:input', (payload: { matchId?: string; playerId?: string; input?: Partial<PongInput> }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      const input = payload?.playerId ? match?.inputs.get(payload.playerId) : null;
      if (!match || !canUseLobby(socket, match) || !socketControlsPlayer(socket, match, payload.playerId) || !input || isBotId(payload.playerId) || !match.running || match.paused) {
        return ack?.({ ok: false, error: 'Eingabe nicht erlaubt.' });
      }
      input.up = payload.input?.up === true;
      input.down = payload.input?.down === true;
      ack?.({ ok: true });
    });

    socket.on('pong:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== match.host.id || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      match.paused = true;
      emitArcadeRoom(io, match.room, 'pong:match:paused', { matchId: match.id }, match);
      snapshot(io, match);
      ack?.({ ok: true });
    });

    socket.on('pong:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== match.host.id || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      match.paused = false;
      match.lastTick = Date.now();
      emitArcadeRoom(io, match.room, 'pong:match:resumed', { matchId: match.id }, match);
      snapshot(io, match);
      ack?.({ ok: true });
    });

    socket.on('pong:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || payload.playerId !== match.host.id || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
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
      if (!leaver || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Du bist kein Teilnehmer dieses Matches.' });
      finish(io, match, opposingTeam(leaver.team), 'player-left');
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      removeFromLobbies(io, socket.id);
      for (const match of matches.values()) {
        const leaver = [...match.socketIds].find(([, sid]) => sid === socket.id)?.[0];
        if (!leaver) continue;
        const player = match.players.find((entry) => entry.id === leaver);
        finish(io, match, player ? opposingTeam(player.team) : null, 'player-left');
      }
    });
  });
}
