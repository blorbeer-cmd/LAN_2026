import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { playerMayUseArcadeAi } from './adminAccess';
import { BALL_RADIUS, BLOB_RADIUS, BlobbyInput, BlobbyMode, BlobbyWorld, COURT_HEIGHT, COURT_WIDTH, GROUND_Y, NET_HEIGHT, NET_X, blobbyBotInput, createWorld, stepWorld } from './blobbyLogic';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { broadcastArcadeKiosk } from './realtime';
import { recordArcadeResult } from './arcadeData';
import { arcadeTiming } from './timing';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';

const TICK_MS = 1000 / 60;
const SNAPSHOT_MS = 50;
const COUNTDOWN_MS = arcadeTiming.countdownMs;
const DEFAULT_TARGET_SCORE = 7;
const BOT_ID = 'blobby-bot';
const BOT = { id: BOT_ID, name: 'Blobby-Bot', avatar: null, color: '#c24bd8' };
const BOT_ID_PREFIX = 'blobby-bot-';

type TeamSide = 'left' | 'right';
interface PlayerRef { id: string; name: string; avatar: string | null; color: string | null }
interface LobbyPlayer extends PlayerRef { team: TeamSide }
interface Lobby {
  id: string;
  groupId: string;
  eventId: string | null;
  mode: BlobbyMode;
  host: LobbyPlayer;
  players: LobbyPlayer[];
  socketIds: Map<string, string>;
  ready: Set<string>;
  createdAt: number;
}
interface Match {
  id: string; groupId: string; eventId: string | null; room: string; mode: BlobbyMode; host: LobbyPlayer; players: LobbyPlayer[]; socketIds: Map<string, string>;
  world: BlobbyWorld; inputs: Map<string, BlobbyInput>; scores: Map<TeamSide, number>;
  loop: NodeJS.Timeout | null; running: boolean; paused: boolean; lastTick: number; lastSnapshot: number; startedAt: number;
  rallyResumeAt: number;
  targetScore: number;
}

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();
const idle = (): BlobbyInput => ({ left: false, right: false, jump: false });
const playerLimit = (mode: BlobbyMode) => mode === 'doubles' ? 4 : 2;
const opposingTeam = (team: TeamSide): TeamSide => team === 'left' ? 'right' : 'left';
const teamName = (team: TeamSide) => team === 'left' ? 'Team Blau' : 'Team Pink';

function isBotId(playerId: string): boolean {
  return playerId === BOT_ID || playerId.startsWith(BOT_ID_PREFIX);
}

function doublesBots(): LobbyPlayer[] {
  return [
    { id: `${BOT_ID_PREFIX}1`, name: 'Blobby-Bot Partner', avatar: null, color: '#c24bd8', team: 'left' },
    { id: `${BOT_ID_PREFIX}2`, name: 'Blobby-Bot Gegner 1', avatar: null, color: '#c24bd8', team: 'right' },
    { id: `${BOT_ID_PREFIX}3`, name: 'Blobby-Bot Gegner 2', avatar: null, color: '#c24bd8', team: 'right' },
  ];
}

function playerById(id: unknown): PlayerRef | null {
  if (typeof id !== 'string' || !id) return null;
  return (db.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').get(id) as PlayerRef | undefined) ?? null;
}
function lobbyPlayer(player: PlayerRef, team: TeamSide): LobbyPlayer {
  return { ...player, team };
}
function socketControlsPlayer(socket: Socket, resource: { socketIds: Map<string, string> }, playerId: unknown): playerId is string {
  return typeof playerId === 'string' && resource.socketIds.get(playerId) === socket.id;
}
function teamSize(lobby: Lobby, team: TeamSide): number {
  return lobby.players.filter((player) => player.team === team).length;
}
function availableTeam(lobby: Lobby, requested: unknown): TeamSide | null {
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
  return [...lobbies.values()].filter((l) => l.groupId === groupId && l.eventId === eventId).map((l) => ({
    id: l.id,
    mode: l.mode,
    host: l.host,
    players: l.players.map((p) => ({ ...p, ready: isLobbyReady(l, p.id) })),
    playerLimit: playerLimit(l.mode),
    createdAt: l.createdAt,
  }));
}
function emitLobbies(io: Server) { for (const socket of io.sockets.sockets.values()) { const scope = socketArcadeScope(socket); if (scope) socket.emit('blobby:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); } }

// Open-lobby summary for GET /api/arcade/lobbies — see arcade.ts.
export function openLobbySummaries(groupId?: string, eventId?: string | null) {
  return [...lobbies.values()].filter((l) => !groupId || (l.groupId === groupId && (eventId === undefined || l.eventId === eventId))).map((l) => ({
    id: l.id,
    hostName: l.host.name,
    playerCount: l.players.length,
    playerLimit: playerLimit(l.mode),
    mode: l.mode,
    createdAt: l.createdAt,
  }));
}
function scorePayload(match: Match, winnerTeam?: TeamSide | null) {
  return match.players.map((p) => ({
    playerId: p.id,
    name: p.name,
    team: p.team,
    score: match.scores.get(p.team) ?? 0,
    isBot: isBotId(p.id),
    ...(winnerTeam ? { isWinner: p.team === winnerTeam } : {}),
  }));
}
function snapshot(io: Server, match: Match) {
  const payload = {
    matchId: match.id, mode: match.mode, serverTime: Date.now(), running: match.running, paused: match.paused,
    world: match.world, scores: scorePayload(match), targetScore: match.targetScore,
    render: { width: COURT_WIDTH, height: COURT_HEIGHT, groundY: GROUND_Y, netX: NET_X, netHeight: NET_HEIGHT, blobRadius: BLOB_RADIUS, ballRadius: BALL_RADIUS },
  };
  emitArcadeRoom(io, match.room, 'blobby:state', payload, match);
  broadcastArcadeKiosk(io, { gameType: 'blobby', groupId: match.groupId, eventId: match.eventId, ...payload, players: match.players });
}
function realPlayerIds(players: LobbyPlayer[]): string[] {
  return players.filter((p) => !isBotId(p.id)).map((p) => p.id);
}
function finish(io: Server, match: Match, winnerTeam: TeamSide | null, reason: string) {
  if (match.loop) clearInterval(match.loop);
  match.loop = null;
  const winners = winnerTeam ? match.players.filter((player) => player.team === winnerTeam) : [];
  const winner = winners[0] ?? null;
  const resultScores = scorePayload(match, winnerTeam);
  endArcadeSession(realPlayerIds(match.players), 'blobby', match);
  recordArcadeResult({
    gameType: 'blobby',
    winnerId: match.mode === 'duel' && winner && !isBotId(winner.id) ? winner.id : null,
    players: match.players,
    scores: resultScores,
    reason,
    startedAt: match.startedAt,
    scope: match,
  });
  emitArcadeRoom(io, match.room, 'blobby:match:end', {
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
function resetRally(match: Match, serveSide: 'left' | 'right') {
  match.world = createWorld(serveSide, match.mode);
  for (const p of match.players) match.inputs.set(p.id, idle());
}
function startLoop(io: Server, match: Match) {
  match.lastTick = Date.now();
  match.loop = setInterval(() => {
    const now = Date.now();
    const dt = (now - match.lastTick) / 1000;
    match.lastTick = now;
    if (!match.running || match.paused) return;
    if (now < match.rallyResumeAt) {
      if (now - match.lastSnapshot >= SNAPSHOT_MS) { match.lastSnapshot = now; snapshot(io, match); }
      return;
    }
    for (const [botIndex, player] of match.players.entries()) {
      if (!isBotId(player.id)) continue;
      const input = match.inputs.get(player.id);
      if (!input) continue;
      const teamSlot = match.players.filter((entry) => entry.team === player.team).findIndex((entry) => entry.id === player.id);
      Object.assign(input, blobbyBotInput(match.world, botIndex, match.mode, teamSlot));
    }
    const landed = stepWorld(match.world, match.players.map((p) => match.inputs.get(p.id) ?? idle()), dt);
    // Jump is an edge-triggered action; movement remains held until key-up.
    for (const input of match.inputs.values()) input.jump = false;
    if (landed) {
      const scoringTeam = opposingTeam(landed);
      const next = (match.scores.get(scoringTeam) ?? 0) + 1;
      match.scores.set(scoringTeam, next);
      emitArcadeRoom(io, match.room, 'blobby:point', {
        scorer: { team: scoringTeam, name: teamName(scoringTeam) },
        scores: scorePayload(match),
      }, match);
      if (next >= match.targetScore) return finish(io, match, scoringTeam, 'completed');
      resetRally(match, scoringTeam);
      match.rallyResumeAt = now + 1000;
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
    if (entry[0] === lobby.host.id) { releaseLobbyMemberships(lobby.players.map((p) => p.id), 'blobby', id); lobbies.delete(id); }
    else { releaseLobbyMembership(entry[0], 'blobby', id); lobby.socketIds.delete(entry[0]); lobby.ready.delete(entry[0]); lobby.players = lobby.players.filter((p) => p.id !== entry[0]); }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

export function registerBlobbySockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const emitSocketLobbies = () => { const scope = socketArcadeScope(socket); if (scope) socket.emit('blobby:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) }); };
    emitSocketLobbies();
    socket.on('blobby:lobbies:get', emitSocketLobbies);
    socket.on('scope:subscribe', emitSocketLobbies);
    socket.on('room:subscribe', emitSocketLobbies);
    socket.on('blobby:lobby:create', (payload: { playerId?: string; mode?: string }, ack?: (r: unknown) => void) => {
      const player = playerById(payload?.playerId);
      if (!player) return ack?.({ ok: false, error: 'Lobby konnte nicht erstellt werden.' });
      const mode = payload?.mode ?? 'duel';
      if (mode !== 'duel' && mode !== 'doubles') return ack?.({ ok: false, error: 'Modus ist ungültig.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const host = lobbyPlayer(player, 'left');
      const lobby: Lobby = {
        id: nanoid(), ...scope, mode, host, players: [host],
        socketIds: new Map([[host.id, socket.id]]), ready: new Set(), createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'blobby', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('blobby:lobby:bot', (payload: { playerId?: string; mode?: BlobbyMode }, ack?: (r: unknown) => void) => {
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
        id: nanoid(), ...scope, mode, host, players: [host, ...bots],
        socketIds: new Map([[host.id, socket.id]]), ready: new Set(bots.map((bot) => bot.id)), createdAt: Date.now(),
      };
      if (!claimLobbyMembership(player.id, 'blobby', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby); emitLobbies(io); ack?.({ ok: true, lobbyId: lobby.id });
    });
    socket.on('blobby:lobby:join', (payload: { lobbyId?: string; playerId?: string; team?: string }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobby gehört zu einer anderen Gruppe.' });
      const present = lobby.players.some((p) => p.id === player.id);
      const team = present ? lobby.players.find((p) => p.id === player.id)!.team : availableTeam(lobby, payload?.team);
      if (!present && (!team || lobby.players.length >= playerLimit(lobby.mode))) return ack?.({ ok: false, error: 'Team ist voll.' });
      if (!claimLobbyMembership(player.id, 'blobby', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      if (!present && team) lobby.players.push(lobbyPlayer(player, team));
      lobby.socketIds.set(player.id, socket.id); emitLobbies(io); ack?.({ ok: true });
    });
    socket.on('blobby:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !socketControlsPlayer(socket, lobby, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (lobby.host.id === payload.playerId) { releaseLobbyMemberships(lobby.players.map((p) => p.id), 'blobby', lobby.id); lobbies.delete(lobby.id); }
      else { releaseLobbyMembership(payload.playerId, 'blobby', lobby.id); lobby.players = lobby.players.filter((p) => p.id !== payload.playerId); lobby.socketIds.delete(payload.playerId); lobby.ready.delete(payload.playerId); }
      emitLobbies(io); ack?.({ ok: true });
    });
    socket.on('blobby:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !socketControlsPlayer(socket, lobby, payload.playerId) || !setLobbyReady(lobby, payload.playerId, payload?.ready)) {
        return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      }
      emitLobbies(io); ack?.({ ok: true });
    });
    socket.on('blobby:lobby:start', (payload: { lobbyId?: string; playerId?: string; targetScore?: number }, ack?: (r: unknown) => void) => {
      const lobby = typeof payload?.lobbyId === 'string' ? lobbies.get(payload.lobbyId) : null;
      if (!lobby) return ack?.({ ok: false, error: 'Lobby nicht gefunden.' });
      if (!canUseLobby(socket, lobby)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (payload.playerId !== lobby.host.id || !socketControlsPlayer(socket, lobby, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (!lobbyCanStart(lobby)) {
        return ack?.({ ok: false, error: lobby.mode === 'doubles' ? 'Doppel braucht zwei bereite Teams.' : 'Duell braucht zwei bereite Spieler.' });
      }
      const targetScore = payload.targetScore ?? DEFAULT_TARGET_SCORE;
      if (!Number.isInteger(targetScore) || targetScore < 1 || targetScore > 30) return ack?.({ ok: false, error: 'Punkteziel muss zwischen 1 und 30 liegen.' });
      const id = nanoid(); const room = `blobby:${id}`;
      for (const sid of lobby.socketIds.values()) io.sockets.sockets.get(sid)?.join(room);
      const match: Match = {
        id, groupId: lobby.groupId, eventId: lobby.eventId, room, mode: lobby.mode, host: lobby.host,
        players: [...lobby.players].sort((a, b) => a.team.localeCompare(b.team)),
        socketIds: new Map(lobby.socketIds), world: createWorld('left', lobby.mode),
        inputs: new Map(lobby.players.map((p) => [p.id, idle()])),
        scores: new Map<TeamSide, number>([['left', 0], ['right', 0]]),
        loop: null, running: false, paused: false, lastTick: Date.now(), lastSnapshot: 0, startedAt: Date.now(), rallyResumeAt: 0, targetScore,
      };
      matches.set(id, match); releaseLobbyMemberships(lobby.players.map((p) => p.id), 'blobby', lobby.id); lobbies.delete(lobby.id); emitLobbies(io);
      startArcadeSession(realPlayerIds(match.players), 'blobby', match);
      const beginsAt = Date.now() + COUNTDOWN_MS;
      emitArcadeRoom(io, room, 'blobby:match:start', {
        matchId: id, mode: match.mode, host: match.host, players: match.players, beginsAt, targetScore,
      }, match);
      snapshot(io, match); startLoop(io, match); ack?.({ ok: true, matchId: id });
      setTimeout(() => { if (matches.get(id) === match) { match.running = true; match.lastTick = Date.now(); } }, COUNTDOWN_MS);
    });
    socket.on('blobby:input', (payload: { matchId?: string; playerId?: string; input?: Partial<BlobbyInput> }, ack?: (r: unknown) => void) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
      const input = typeof payload.playerId === 'string' ? match?.inputs.get(payload.playerId) : null;
      if (!match || !canUseLobby(socket, match) || !socketControlsPlayer(socket, match, payload.playerId) || !input || isBotId(payload.playerId) || match.paused || !match.running) {
        return ack?.({ ok: false, error: 'Eingabe nicht erlaubt.' });
      }
      input.left = payload.input?.left === true;
      input.right = payload.input?.right === true;
      if (payload.input?.jump === true) input.jump = true;
      ack?.({ ok: true });
    });
    socket.on('blobby:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload.playerId !== match.host.id || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann pausieren.' });
      match.paused = true;
      emitArcadeRoom(io, match.room, 'blobby:match:paused', { matchId: match.id }, match);
      snapshot(io, match); ack?.({ ok: true });
    });
    socket.on('blobby:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload.playerId !== match.host.id || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann fortsetzen.' });
      match.paused = false; match.lastTick = Date.now();
      emitArcadeRoom(io, match.room, 'blobby:match:resumed', { matchId: match.id }, match);
      snapshot(io, match); ack?.({ ok: true });
    });
    socket.on('blobby:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      if (payload.playerId !== match.host.id || !socketControlsPlayer(socket, match, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finish(io, match, null, 'ended-by-host'); ack?.({ ok: true });
    });
    // Lets a non-host participant end a running match themselves instead of
    // relying on the host (who might be AFK) or a raw disconnect — same
    // outcome as a disconnect mid-match: the match ends, opponent wins.
    socket.on('blobby:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (r: unknown) => void) => {
      const match = typeof payload.matchId === 'string' ? matches.get(payload.matchId) : null;
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
