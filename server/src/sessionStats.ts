// Session-level analytics beyond simple total playtime: longest single
// sessions, time spent with several games open at once, day/time-range
// filtering, and a per-game concurrency-over-time timeseries. Kept as pure
// functions over PlaySession[] so they're directly unit-testable.

import type { PlaySession } from './playtime';

export interface SessionDuration {
  playerId: string;
  gameId: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
}

// Every session with its duration, longest first.
export function sessionDurations(sessions: PlaySession[], now: number): SessionDuration[] {
  return sessions
    .map((s) => ({
      playerId: s.playerId,
      gameId: s.gameId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: Math.max(0, (s.endedAt ?? now) - s.startedAt),
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function topPerKey<T>(sortedDesc: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of sortedDesc) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

// The single longest session for each (player, game) pair — "wer hatte in
// Spiel X die längste Einzelsession".
export function longestSessionPerPlayerGame(sorted: SessionDuration[]): SessionDuration[] {
  return topPerKey(sorted, (s) => `${s.playerId}::${s.gameId}`);
}

// The record-holder's session for each game, regardless of who played it.
export function longestSessionPerGame(sorted: SessionDuration[]): SessionDuration[] {
  return topPerKey(sorted, (s) => s.gameId);
}

// Each player's single longest session, regardless of which game.
export function longestSessionPerPlayer(sorted: SessionDuration[]): SessionDuration[] {
  return topPerKey(sorted, (s) => s.playerId);
}

export interface OverlapResult {
  playerId: string;
  multiGameMs: number; // time spent with 2+ games open at once
  maxSimultaneous: number; // the most games this player ever had open together
}

// Sweep-line over each player's own sessions: how much total time did they
// have 2+ games running simultaneously, and what's the highest count reached.
export function computeSimultaneousGameTime(sessions: PlaySession[], now: number): OverlapResult[] {
  const byPlayer = new Map<string, PlaySession[]>();
  for (const s of sessions) {
    const list = byPlayer.get(s.playerId) ?? [];
    list.push(s);
    byPlayer.set(s.playerId, list);
  }

  const results: OverlapResult[] = [];
  for (const [playerId, playerSessions] of byPlayer) {
    const events: Array<{ time: number; delta: number }> = [];
    for (const s of playerSessions) {
      const end = s.endedAt ?? now;
      if (end <= s.startedAt) continue;
      events.push({ time: s.startedAt, delta: 1 });
      events.push({ time: end, delta: -1 });
    }
    // Process session-ends before session-starts at the same instant, so a
    // session ending exactly when another begins isn't counted as overlap.
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);

    let concurrent = 0;
    let maxSimultaneous = 0;
    let multiGameMs = 0;
    let lastTime = events.length > 0 ? events[0].time : now;
    for (const e of events) {
      if (concurrent >= 2) multiGameMs += e.time - lastTime;
      concurrent += e.delta;
      maxSimultaneous = Math.max(maxSimultaneous, concurrent);
      lastTime = e.time;
    }
    results.push({ playerId, multiGameMs, maxSimultaneous });
  }

  return results.sort((a, b) => b.multiGameMs - a.multiGameMs);
}

// Clips sessions to a [from, to] window (either end optional), prorating
// activeMs by the overlap fraction since we only know a session's *total*
// active time, not how it was distributed across the session — an honest
// approximation for sessions that cross the filter boundary, not exact.
export function clipSessionsToRange(
  sessions: PlaySession[],
  now: number,
  from?: number,
  to?: number
): PlaySession[] {
  if (from === undefined && to === undefined) return sessions;
  const rangeFrom = from ?? -Infinity;
  const rangeTo = to ?? Infinity;

  const result: PlaySession[] = [];
  for (const s of sessions) {
    const end = s.endedAt ?? now;
    const clippedStart = Math.max(s.startedAt, rangeFrom);
    const clippedEnd = Math.min(end, rangeTo);
    if (clippedEnd <= clippedStart) continue; // no overlap with the range

    const fullDuration = end - s.startedAt;
    const clippedDuration = clippedEnd - clippedStart;
    const fraction = fullDuration > 0 ? clippedDuration / fullDuration : 0;

    result.push({
      playerId: s.playerId,
      gameId: s.gameId,
      startedAt: clippedStart,
      endedAt: clippedEnd,
      activeMs: s.activeMs * fraction,
    });
  }
  return result;
}

export interface ConcurrencyBucket {
  bucketStart: number;
  count: number;
}

// Fixed-width bucketed sample of how many sessions (== how many distinct
// players, for a single-game-filtered input) were running at some point
// during each bucket — a simple timeseries a bar chart can render without
// needing to handle variable-width intervals.
export function computeConcurrencyOverTime(
  sessions: PlaySession[],
  from: number,
  to: number,
  bucketMs: number,
  now: number
): ConcurrencyBucket[] {
  const buckets: ConcurrencyBucket[] = [];
  for (let t = from; t < to; t += bucketMs) {
    const bucketEnd = t + bucketMs;
    const count = sessions.filter((s) => {
      const end = s.endedAt ?? now;
      return s.startedAt < bucketEnd && end > t;
    }).length;
    buckets.push({ bucketStart: t, count });
  }
  return buckets;
}
