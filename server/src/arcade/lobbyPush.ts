// Spam guard for lobby-create push notifications. Opening an Arcade lobby
// sends a real push to every other player's phone — without a threshold,
// rapidly re-creating a lobby (create → close → create …) turns into a push
// storm across the whole LAN. One push per game type within the cooldown is
// enough: the Arcade view and Home's "Aktuell" card stay live via sockets,
// the push is only the initial nudge.

import { communicationRecipientIds } from '../communicationRecipients';
import { notifyPlayers, resolvePushTopic } from '../push';

const LOBBY_GAME_NAMES = {
  quiz: 'Quiz',
  tetris: 'Tetris',
  scribble: 'Scribble',
  pong: 'Pong',
  blobby: 'Blobby-Volley',
  snake: 'Snake',
  battleship: 'Battleship',
  'challenge-rush': 'Challenge-Rush',
} as const;

export type LobbyPushGameType = keyof typeof LOBBY_GAME_NAMES;

interface LobbyPushScope {
  id: string;
  groupId: string;
  eventId: string | null;
  host: { id: string; name: string };
}

const LOBBY_PUSH_COOLDOWN_MS = 2 * 60_000;

const lastPushAt = new Map<string, number>();

export function shouldSendLobbyPush(gameType: LobbyPushGameType, now: number = Date.now()): boolean {
  const last = lastPushAt.get(gameType);
  if (last !== undefined && now - last < LOBBY_PUSH_COOLDOWN_MS) return false;
  lastPushAt.set(gameType, now);
  return true;
}

export function arcadeLobbyPushKey(gameType: LobbyPushGameType, lobbyId: string): string {
  return `arcade-lobby:${gameType}:${lobbyId}`;
}

export function notifyArcadeLobbyOpened(gameType: LobbyPushGameType, lobby: LobbyPushScope): void {
  if (!lobby.eventId || !shouldSendLobbyPush(gameType)) return;
  const otherPlayerIds = communicationRecipientIds(lobby.groupId, lobby.eventId).filter(
    (playerId) => playerId !== lobby.host.id,
  );
  const gameName = LOBBY_GAME_NAMES[gameType];
  notifyPlayers(
    otherPlayerIds,
    {
      title: `Neue ${gameName}-Lobby`,
      body: `${lobby.host.name} hat eine ${gameName}-Lobby geöffnet – jetzt beitreten!`,
      url: `/#arcade/${gameType}`,
    },
    'all',
    { key: arcadeLobbyPushKey(gameType, lobby.id) },
    lobby,
  );
}

export function resolveArcadeLobbyPush(gameType: LobbyPushGameType, lobby: LobbyPushScope): void {
  if (!lobby.eventId) return;
  resolvePushTopic(arcadeLobbyPushKey(gameType, lobby.id), false, lobby);
}

// Test isolation only — production never resets the throttle.
export function clearLobbyPushThrottle(): void {
  lastPushAt.clear();
}

export { LOBBY_PUSH_COOLDOWN_MS };
