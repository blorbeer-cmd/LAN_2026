// Pure playtime aggregation (FR-29), kept separate from DB/routes so it's
// directly unit-testable. A session with ended_at === null is still ongoing
// and counts up to `now`.

export interface PlaySession {
  playerId: string;
  gameId: string;
  startedAt: number;
  endedAt: number | null;
  // Estimated time the game was actually being played (focused + not idle),
  // accrued by the agent report handler. 0 if the player never opted in to
  // activity tracking — total playtime is still accurate either way.
  activeMs: number;
}

export interface PlaytimeEntry {
  playerId: string;
  gameId: string;
  totalMs: number;
  activeMs: number;
}

export function computePlaytime(sessions: PlaySession[], now: number): PlaytimeEntry[] {
  const byKey = new Map<string, PlaytimeEntry>();

  for (const s of sessions) {
    const end = s.endedAt ?? now;
    const durationMs = Math.max(0, end - s.startedAt);
    const key = `${s.playerId}::${s.gameId}`;
    const entry = byKey.get(key) ?? { playerId: s.playerId, gameId: s.gameId, totalMs: 0, activeMs: 0 };
    entry.totalMs += durationMs;
    // Defensive clamp: active time can never exceed the running time it was
    // measured within, even if a clock/rounding quirk pushed it slightly over.
    entry.activeMs = Math.min(entry.activeMs + s.activeMs, entry.totalMs);
    byKey.set(key, entry);
  }

  return [...byKey.values()].sort((a, b) => b.totalMs - a.totalMs);
}

export interface GameTotal {
  gameId: string;
  totalMs: number;
  activeMs: number;
}

// Sums per-player-per-game entries into a per-game total across everyone —
// "how long did this game run at the party in total", not per person.
export function aggregateByGame(entries: PlaytimeEntry[]): GameTotal[] {
  const totals = new Map<string, { totalMs: number; activeMs: number }>();
  for (const e of entries) {
    const current = totals.get(e.gameId) ?? { totalMs: 0, activeMs: 0 };
    current.totalMs += e.totalMs;
    current.activeMs += e.activeMs;
    totals.set(e.gameId, current);
  }
  return [...totals.entries()]
    .map(([gameId, v]) => ({ gameId, totalMs: v.totalMs, activeMs: v.activeMs }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

// "2h 15m" / "45m" style formatting for display.
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
