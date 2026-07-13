// Spam guard for lobby-create push notifications. Opening an Arcade lobby
// sends a real push to every other player's phone — without a threshold,
// rapidly re-creating a lobby (create → close → create …) turns into a push
// storm across the whole LAN. One push per game type within the cooldown is
// enough: the Arcade view and Home's "Aktuell" card stay live via sockets,
// the push is only the initial nudge.

const LOBBY_PUSH_COOLDOWN_MS = 2 * 60_000;

const lastPushAt = new Map<string, number>();

export function shouldSendLobbyPush(gameType: string, now: number = Date.now()): boolean {
  const last = lastPushAt.get(gameType);
  if (last !== undefined && now - last < LOBBY_PUSH_COOLDOWN_MS) return false;
  lastPushAt.set(gameType, now);
  return true;
}

// Test isolation only — production never resets the throttle.
export function clearLobbyPushThrottle(): void {
  lastPushAt.clear();
}

export { LOBBY_PUSH_COOLDOWN_MS };
