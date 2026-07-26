import { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcastArcadeKiosk } from '../realtime';
import { startArcadeSession, endArcadeSession } from './arcadeTracking';
import { arcadeTiming } from './timing';
import { claimLobbyMembership, releaseLobbyMembership, releaseLobbyMemberships } from './lobbyMembership';
import { isLobbyReady, setLobbyReady } from './lobbyReady';
import { recordArcadeResult } from './arcadeData';
import { canJoinLobby, canUseLobby, emitArcadeRoom, socketArcadeScope } from './scope';
import { applyShot, fleetSnapshot, remainingSegments, remainingShips, ShipState, validatePlacements } from './battleshipLogic';

const COUNTDOWN_MS = arcadeTiming.countdownMs;
const END_REVEAL_MS = process.env.NODE_ENV === 'test' && process.env.E2E_FAST_TIMERS === '1' ? 250 : 12_000;

interface Player { id: string; name: string; avatar: string | null; color: string | null }
interface Lobby { id: string; groupId: string; eventId: string | null; mode: 'duel' | 'team'; host: Player; players: Player[]; socketIds: Map<string, string>; ready: Set<string>; createdAt: number }
interface ShotRecord { playerId: string; targetId: string; coordinate: number; kind: 'miss' | 'hit' | 'sunk' }
interface Match { id: string; groupId: string; eventId: string | null; room: string; host: Player; players: Player[]; socketIds: Map<string, string>; fleets: Map<string, ShipState[]>; fired: Map<string, Set<number>>; shots: ShotRecord[]; phase: 'setup' | 'countdown' | 'playing' | 'ended'; currentPlayerId: string | null; paused: boolean; startedAt: number; beginsAt: number | null; timers: Set<ReturnType<typeof setTimeout>> }

const lobbies = new Map<string, Lobby>();
const matches = new Map<string, Match>();

function playerById(id?: string): Player | null {
  if (!id) return null;
  return (db.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').get(id) as Player | undefined) ?? null;
}

function modeLimit(mode: Lobby['mode']): number { return mode === 'team' ? 4 : 2; }
function realPlayerIds(players: Player[]): string[] { return players.map((player) => player.id); }
function socketOwnsPlayer(socket: Socket, playerId: unknown): playerId is string {
  return typeof playerId === 'string' && Boolean(socketArcadeScope(socket, playerId));
}

function publicLobbies(groupId: string, eventId: string | null) {
  return [...lobbies.values()]
    .filter((lobby) => lobby.groupId === groupId && lobby.eventId === eventId)
    .map((lobby) => ({
      id: lobby.id,
      mode: lobby.mode,
      capacity: modeLimit(lobby.mode),
      host: lobby.host,
      players: lobby.players.map((player) => ({ ...player, ready: isLobbyReady(lobby, player.id) })),
      createdAt: lobby.createdAt,
    }));
}

function emitLobbies(io: Server) {
  for (const socket of io.sockets.sockets.values()) {
    const scope = socketArcadeScope(socket);
    if (scope) socket.emit('battleship:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
  }
}

export function openLobbySummaries(groupId?: string, eventId?: string | null) {
  return [...lobbies.values()]
    .filter((lobby) => !groupId || (lobby.groupId === groupId && (eventId === undefined || lobby.eventId === eventId)))
    .map((lobby) => ({ id: lobby.id, hostName: lobby.host.name, playerCount: lobby.players.length, createdAt: lobby.createdAt }));
}

function playerTeam(match: Match, playerId: string): 'blue' | 'pink' | null {
  if (match.players.length !== 4) return null;
  return match.players.indexOf(match.players.find((player) => player.id === playerId) as Player) % 2 === 0 ? 'blue' : 'pink';
}

function targetShots(match: Match, playerId: string) {
  return match.shots.filter((shot) => shot.playerId === playerId).map((shot) => ({
    targetId: shot.targetId,
    coordinate: shot.coordinate,
    kind: shot.kind,
  }));
}

function publicState(match: Match, viewerId?: string) {
  const players = match.players.map((player) => {
    const fleet = match.fleets.get(player.id) ?? [];
    const own = player.id === viewerId;
    return {
      ...player,
      team: playerTeam(match, player.id),
      placementReady: match.fleets.has(player.id),
      shipsRemaining: remainingShips(fleet),
      segmentsRemaining: remainingSegments(fleet),
      fleet: own ? fleetSnapshot(fleet, true) : fleetSnapshot(fleet, false),
      shots: own ? targetShots(match, player.id) : undefined,
    };
  });
  return {
    matchId: match.id,
    mode: match.players.length === 4 ? 'team' : 'duel',
    phase: match.phase,
    paused: match.paused,
    currentPlayerId: match.currentPlayerId,
    beginsAt: match.beginsAt,
    players,
    lastShot: match.shots.at(-1) ?? null,
  };
}

function spectatorState(match: Match, reveal = false) {
  return publicState(match).players.map((player) => ({
    id: player.id,
    name: player.name,
    team: player.team,
    placementReady: player.placementReady,
    shipsRemaining: player.shipsRemaining,
    segmentsRemaining: player.segmentsRemaining,
    shots: match.shots.filter((shot) => shot.targetId === player.id).map((shot) => ({ coordinate: shot.coordinate, kind: shot.kind })),
    ...(reveal ? { fleet: fleetSnapshot(match.fleets.get(player.id) ?? [], true) } : {}),
  }));
}

function schedule(match: Match, callback: () => void, delay: number) {
  const timer = setTimeout(() => { match.timers.delete(timer); callback(); }, delay);
  match.timers.add(timer);
}

function cleanupMatch(io: Server, match: Match) {
  for (const timer of match.timers) clearTimeout(timer);
  match.timers.clear();
  matches.delete(match.id);
  for (const socketId of match.socketIds.values()) io.sockets.sockets.get(socketId)?.leave(match.room);
}

function emitPersonalized(io: Server, match: Match) {
  for (const [playerId, socketId] of match.socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socketArcadeScope(socket) && canUseLobby(socket, match)) socket.emit('battleship:state', publicState(match, playerId));
  }
}

function finish(io: Server, match: Match, winnerId: string | null, reason: string) {
  if (match.phase === 'ended') return;
  match.phase = 'ended';
  match.paused = false;
  for (const timer of match.timers) clearTimeout(timer);
  match.timers.clear();
  endArcadeSession(realPlayerIds(match.players), 'battleship', match);
  const scores = match.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    score: remainingSegments(match.fleets.get(player.id) ?? []),
  }));
  recordArcadeResult({ gameType: 'battleship', winnerId, players: match.players, scores, reason, startedAt: match.startedAt, scope: match });
  const fleets = match.players.map((player) => ({ playerId: player.id, fleet: fleetSnapshot(match.fleets.get(player.id) ?? [], true) }));
  emitArcadeRoom(io, match.room, 'battleship:match:end', { matchId: match.id, winnerId, reason, scores, fleets }, match);
  broadcastArcadeKiosk(io, { gameType: 'battleship', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: 'ended', players: spectatorState(match, true) });
  emitPersonalized(io, match);
  setTimeout(() => broadcastArcadeKiosk(io, { gameType: null, matchId: match.id, groupId: match.groupId, eventId: match.eventId }), END_REVEAL_MS);
  cleanupMatch(io, match);
}

function beginBattle(io: Server, match: Match) {
  if (match.phase !== 'setup' || match.fleets.size !== match.players.length) return;
  match.phase = 'countdown';
  match.beginsAt = Date.now() + COUNTDOWN_MS;
  match.currentPlayerId = match.players[Math.floor(Math.random() * match.players.length)].id;
  emitPersonalized(io, match);
  broadcastArcadeKiosk(io, { gameType: 'battleship', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: 'countdown', players: spectatorState(match) });
  schedule(match, () => {
    if (matches.get(match.id) !== match || match.phase !== 'countdown') return;
    match.phase = 'playing';
    match.beginsAt = null;
    emitPersonalized(io, match);
  }, COUNTDOWN_MS);
}

function startMatch(io: Server, lobby: Lobby): Match {
  const id = nanoid();
  const room = `battleship:${id}`;
  for (const socketId of lobby.socketIds.values()) io.sockets.sockets.get(socketId)?.join(room);
  const match: Match = {
    id, groupId: lobby.groupId, eventId: lobby.eventId, room, host: lobby.host, players: [...lobby.players], socketIds: new Map(lobby.socketIds),
    fleets: new Map(), fired: new Map(lobby.players.map((player) => [player.id, new Set()])), shots: [], phase: 'setup', currentPlayerId: null, paused: false, startedAt: Date.now(), beginsAt: null, timers: new Set(),
  };
  matches.set(id, match);
  releaseLobbyMemberships(lobby.players.map((player) => player.id), 'battleship', lobby.id);
  lobbies.delete(lobby.id);
  emitLobbies(io);
  startArcadeSession(realPlayerIds(match.players), 'battleship', match);
  emitArcadeRoom(io, room, 'battleship:match:start', { matchId: id, host: match.host, players: match.players, mode: lobby.mode }, match);
  emitPersonalized(io, match);
  return match;
}

function removeFromLobbies(io: Server, socketId: string) {
  let changed = false;
  for (const [id, lobby] of lobbies) {
    const entry = [...lobby.socketIds].find(([, connectedSocketId]) => connectedSocketId === socketId);
    if (!entry) continue;
    if (entry[0] === lobby.host.id) {
      releaseLobbyMemberships(lobby.players.map((player) => player.id), 'battleship', id);
      lobbies.delete(id);
    } else {
      releaseLobbyMembership(entry[0], 'battleship', id);
      lobby.players = lobby.players.filter((player) => player.id !== entry[0]);
      lobby.socketIds.delete(entry[0]);
      lobby.ready.delete(entry[0]);
    }
    changed = true;
  }
  if (changed) emitLobbies(io);
}

export function registerBattleshipSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const emitSocketLobbies = () => {
      const scope = socketArcadeScope(socket);
      if (scope) socket.emit('battleship:lobbies', { lobbies: publicLobbies(scope.groupId, scope.eventId) });
    };
    emitSocketLobbies();
    socket.on('battleship:lobbies:get', emitSocketLobbies);
    socket.on('scope:subscribe', emitSocketLobbies);
    socket.on('room:subscribe', emitSocketLobbies);

    socket.on('battleship:lobby:create', (payload: { playerId?: string; mode?: Lobby['mode'] }, ack?: (result: unknown) => void) => {
      const player = playerById(payload?.playerId);
      const mode = payload?.mode === 'team' ? 'team' : 'duel';
      if (!player) return ack?.({ ok: false, error: 'Spieler nicht gefunden.' });
      if (mode === 'team') return ack?.({ ok: false, error: 'Der Teammodus ist noch nicht freigeschaltet.' });
      const scope = socketArcadeScope(socket, player.id);
      if (!scope) return ack?.({ ok: false, error: 'Gruppen- oder Eventzugriff verweigert.' });
      const lobby: Lobby = { id: nanoid(), ...scope, mode, host: player, players: [player], socketIds: new Map([[player.id, socket.id]]), ready: new Set(), createdAt: Date.now() };
      if (!claimLobbyMembership(player.id, 'battleship', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      lobbies.set(lobby.id, lobby);
      emitLobbies(io);
      ack?.({ ok: true, lobbyId: lobby.id });
    });

    socket.on('battleship:lobby:join', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      const player = playerById(payload?.playerId);
      if (!lobby || !player || !canJoinLobby(socket, lobby, player.id)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      const present = lobby.players.some((entry) => entry.id === player.id);
      if (!present && lobby.players.length >= modeLimit(lobby.mode)) return ack?.({ ok: false, error: 'Lobby ist voll.' });
      if (!claimLobbyMembership(player.id, 'battleship', lobby.id)) return ack?.({ ok: false, error: 'Du bist bereits in einer anderen Arcade-Lobby.' });
      removeFromLobbies(io, socket.id);
      if (!present) lobby.players.push(player);
      lobby.socketIds.set(player.id, socket.id);
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('battleship:lobby:leave', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !socketOwnsPlayer(socket, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (payload.playerId === lobby.host.id) {
        releaseLobbyMemberships(lobby.players.map((player) => player.id), 'battleship', lobby.id);
        lobbies.delete(lobby.id);
      } else if (payload.playerId && lobby.players.some((player) => player.id === payload.playerId)) {
        releaseLobbyMembership(payload.playerId, 'battleship', lobby.id);
        lobby.players = lobby.players.filter((player) => player.id !== payload.playerId);
        lobby.socketIds.delete(payload.playerId);
        lobby.ready.delete(payload.playerId);
      }
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('battleship:lobby:ready', (payload: { lobbyId?: string; playerId?: string; ready?: boolean }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !socketOwnsPlayer(socket, payload.playerId) || !setLobbyReady(lobby, payload.playerId, payload.ready)) return ack?.({ ok: false, error: 'Bereit-Status konnte nicht gesetzt werden.' });
      emitLobbies(io);
      ack?.({ ok: true });
    });

    socket.on('battleship:lobby:start', (payload: { lobbyId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const lobby = payload?.lobbyId ? lobbies.get(payload.lobbyId) : null;
      if (!lobby || !canUseLobby(socket, lobby) || !socketOwnsPlayer(socket, payload.playerId)) return ack?.({ ok: false, error: 'Lobbyzugriff verweigert.' });
      if (payload.playerId !== lobby.host.id) return ack?.({ ok: false, error: 'Nur der Host kann starten.' });
      if (lobby.mode !== 'duel') return ack?.({ ok: false, error: 'Der Teammodus ist noch nicht freigeschaltet.' });
      const required = modeLimit(lobby.mode);
      if (lobby.players.length !== required) return ack?.({ ok: false, error: `Es werden genau ${required} Spieler benötigt.` });
      if (lobby.players.some((player) => !isLobbyReady(lobby, player.id))) return ack?.({ ok: false, error: 'Alle Mitspieler müssen bereit sein.' });
      const match = startMatch(io, lobby);
      ack?.({ ok: true, matchId: match.id });
    });

    socket.on('battleship:setup:submit', (payload: { matchId?: string; playerId?: string; placements?: unknown }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'setup' || !canUseLobby(socket, match) || !socketOwnsPlayer(socket, payload.playerId) || !match.players.some((player) => player.id === payload.playerId)) return ack?.({ ok: false, error: 'Platzierung nicht möglich.' });
      const result = validatePlacements(payload.placements);
      if (!result.ok) return ack?.({ ok: false, error: result.error });
      if (match.fleets.has(payload.playerId as string)) return ack?.({ ok: false, error: 'Deine Flotte ist bereits bestätigt.' });
      match.fleets.set(payload.playerId as string, result.fleet);
      emitPersonalized(io, match);
      beginBattle(io, match);
      ack?.({ ok: true });
    });

    socket.on('battleship:shot:fire', (payload: { matchId?: string; playerId?: string; row?: number; col?: number }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'playing' || match.paused || !canUseLobby(socket, match) || !socketOwnsPlayer(socket, payload.playerId)) return ack?.({ ok: false, error: 'Jetzt kann nicht gefeuert werden.' });
      if (payload.playerId !== match.currentPlayerId) return ack?.({ ok: false, error: 'Du bist nicht am Zug.' });
      const target = match.players.find((player) => player.id !== payload.playerId);
      if (!target || !Number.isInteger(payload.row) || !Number.isInteger(payload.col)) return ack?.({ ok: false, error: 'Zielkoordinate ist ungültig.' });
      const result = applyShot(match.fleets.get(target.id) ?? [], match.fired.get(payload.playerId as string) ?? new Set(), payload.row as number, payload.col as number);
      if (!result.ok) return ack?.({ ok: false, error: result.error === 'already-shot' ? 'Dieses Feld wurde bereits beschossen.' : 'Zielkoordinate ist ungültig.' });
      match.shots.push({ playerId: payload.playerId as string, targetId: target.id, coordinate: result.coordinate, kind: result.kind });
      if (result.remainingSegments === 0) {
        finish(io, match, payload.playerId as string, 'completed');
      } else {
        const next = match.players.find((player) => player.id !== payload.playerId);
        match.currentPlayerId = next?.id ?? null;
        emitPersonalized(io, match);
        broadcastArcadeKiosk(io, { gameType: 'battleship', matchId: match.id, groupId: match.groupId, eventId: match.eventId, phase: 'playing', players: spectatorState(match) });
      }
      ack?.({ ok: true, result: { kind: result.kind, coordinate: result.coordinate, shipId: result.shipId } });
    });

    socket.on('battleship:match:pause', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'playing' || payload.playerId !== match.host.id || !canUseLobby(socket, match) || !socketOwnsPlayer(socket, payload.playerId)) return ack?.({ ok: false, error: 'Pausieren ist nur während des Gefechts möglich.' });
      match.paused = true;
      emitPersonalized(io, match);
      ack?.({ ok: true });
    });
    socket.on('battleship:match:resume', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || match.phase !== 'playing' || payload.playerId !== match.host.id || !canUseLobby(socket, match) || !socketOwnsPlayer(socket, payload.playerId)) return ack?.({ ok: false, error: 'Fortsetzen ist nur während des Gefechts möglich.' });
      match.paused = false;
      emitPersonalized(io, match);
      ack?.({ ok: true });
    });
    socket.on('battleship:match:finish', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || payload.playerId !== match.host.id || !canUseLobby(socket, match) || !socketOwnsPlayer(socket, payload.playerId)) return ack?.({ ok: false, error: 'Nur der Host kann beenden.' });
      finish(io, match, null, 'aborted');
      ack?.({ ok: true });
    });
    socket.on('battleship:match:leave', (payload: { matchId?: string; playerId?: string }, ack?: (result: unknown) => void) => {
      const match = payload?.matchId ? matches.get(payload.matchId) : null;
      if (!match || !canUseLobby(socket, match) || !socketOwnsPlayer(socket, payload.playerId) || !match.players.some((player) => player.id === payload.playerId)) return ack?.({ ok: false, error: 'Match nicht gefunden.' });
      const winner = match.players.find((player) => player.id !== payload.playerId)?.id ?? null;
      finish(io, match, winner, 'player-left');
      ack?.({ ok: true });
    });
    socket.on('disconnect', () => {
      removeFromLobbies(io, socket.id);
      for (const match of matches.values()) {
        const player = [...match.socketIds.entries()].find(([, socketId]) => socketId === socket.id)?.[0];
        if (player && match.phase !== 'ended') {
          const winner = match.players.find((entry) => entry.id !== player)?.id ?? null;
          finish(io, match, winner, 'player-left');
        }
      }
    });
  });
}
