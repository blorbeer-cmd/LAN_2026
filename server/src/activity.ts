// Pure logic for deciding whether a game was "actually being played" during a
// given report tick, vs merely running in the background. Kept independent
// of the DB/route so it's directly unit-testable.

// Idle for this long or more counts as AFK — the game may still be open, but
// nobody's at the keyboard, so it shouldn't count as active playtime.
export const ACTIVE_IDLE_THRESHOLD_S = 120;

export function isGameActive(
  foregroundProcessName: string | null,
  idleSeconds: number | null,
  gameProcessNames: string[]
): boolean {
  if (!foregroundProcessName) return false;
  if (!gameProcessNames.includes(foregroundProcessName)) return false;
  if (idleSeconds !== null && idleSeconds >= ACTIVE_IDLE_THRESHOLD_S) return false;
  return true;
}
