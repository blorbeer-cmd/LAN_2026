// Pure playtime aggregation (FR-29), kept separate from DB/routes so it's
// directly unit-testable. A session with ended_at === null is still ongoing
// and counts up to `now`.

export interface PlaySession {
  playerId: string;
  gameId: string;
  startedAt: number;
  endedAt: number | null;
}

export interface PlaytimeEntry {
  playerId: string;
  gameId: string;
  totalMs: number;
}

export function computePlaytime(sessions: PlaySession[], now: number): PlaytimeEntry[] {
  const byKey = new Map<string, PlaytimeEntry>();

  for (const s of sessions) {
    const end = s.endedAt ?? now;
    const durationMs = Math.max(0, end - s.startedAt);
    const key = `${s.playerId}::${s.gameId}`;
    const entry = byKey.get(key) ?? { playerId: s.playerId, gameId: s.gameId, totalMs: 0 };
    entry.totalMs += durationMs;
    byKey.set(key, entry);
  }

  return [...byKey.values()].sort((a, b) => b.totalMs - a.totalMs);
}

// "2h 15m" / "45m" style formatting for display.
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
