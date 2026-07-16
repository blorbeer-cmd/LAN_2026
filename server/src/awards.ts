// "Witzige" awards computed from session data — pure logic, unit-tested
// independent of the DB. Numeric values only; the route layer formats them
// and looks up player names/colors.

import type { PlaySession } from './playtime';
import { computePlaytime } from './playtime';
import { computeSimultaneousGameTime, sessionDurations } from './sessionStats';

export interface RawAward {
  id: string;
  title: string;
  description: string;
  playerId: string;
  valueMs?: number;
  valueCount?: number;
  valuePercent?: number;
}

function topByMap(map: Map<string, number>): { playerId: string; value: number } | null {
  let best: { playerId: string; value: number } | null = null;
  for (const [playerId, value] of map) {
    if (!best || value > best.value) best = { playerId, value };
  }
  return best;
}

// All [start, end) ms sub-intervals of [from, to) that fall within the daily
// recurring clock-time window [startHour, endHour) (wraps past midnight if
// endHour <= startHour, e.g. 22 -> 6). Uses local wall-clock time, which is
// fine for a single-timezone weekend LAN party.
function dailyWindows(from: number, to: number, startHour: number, endHour: number): Array<[number, number]> {
  if (to <= from) return [];
  const durationHours = endHour > startHour ? endHour - startHour : 24 - startHour + endHour;
  const durationMs = durationHours * 3_600_000;

  const anchor = new Date(from);
  anchor.setHours(startHour, 0, 0, 0);
  // Start a day early so a window that began "yesterday" (per its start
  // hour) but extends into today is still considered.
  let cursor = anchor.getTime() - 24 * 3_600_000;

  const windows: Array<[number, number]> = [];
  while (cursor < to) {
    const windowStart = cursor;
    const windowEnd = cursor + durationMs;
    const overlapStart = Math.max(windowStart, from);
    const overlapEnd = Math.min(windowEnd, to);
    if (overlapEnd > overlapStart) windows.push([overlapStart, overlapEnd]);
    cursor += 24 * 3_600_000;
  }
  return windows;
}

// Total time each player spent playing anything during a recurring daily
// clock-time window (e.g. 0-6 for "Nachteule", 6-10 for "Frühaufsteher").
export function computeTimeInHourWindow(
  sessions: PlaySession[],
  now: number,
  startHour: number,
  endHour: number
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    const end = s.endedAt ?? now;
    for (const [ws, we] of dailyWindows(s.startedAt, end, startHour, endHour)) {
      totals.set(s.playerId, (totals.get(s.playerId) ?? 0) + (we - ws));
    }
  }
  return totals;
}

export function sessionCountByPlayer(sessions: PlaySession[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.playerId, (counts.get(s.playerId) ?? 0) + 1);
  return counts;
}

export function distinctGamesByPlayer(sessions: PlaySession[]): Map<string, number> {
  const byPlayer = new Map<string, Set<string>>();
  for (const s of sessions) {
    const set = byPlayer.get(s.playerId) ?? new Set<string>();
    set.add(s.gameId);
    byPlayer.set(s.playerId, set);
  }
  const counts = new Map<string, number>();
  for (const [playerId, set] of byPlayer) counts.set(playerId, set.size);
  return counts;
}

// Activity-ratio awards only make sense once at least two players have
// opted into tracking and racked up a non-trivial amount of playtime —
// otherwise "most/least focused" is either meaningless or trivially decided
// by a single data point.
const MIN_TOTAL_MS_FOR_FOCUS_AWARDS = 10 * 60_000;

export function computeAwards(sessions: PlaySession[], now: number): RawAward[] {
  const awards: RawAward[] = [];

  const durations = sessionDurations(sessions, now);
  if (durations.length > 0) {
    const top = durations[0];
    awards.push({
      id: 'marathon',
      title: 'Marathon-Zocker',
      description: 'Längste durchgehende Einzelsession',
      playerId: top.playerId,
      valueMs: top.durationMs,
    });
  }

  const overlaps = computeSimultaneousGameTime(sessions, now).filter((o) => o.multiGameMs > 0);
  if (overlaps.length > 0) {
    const top = overlaps[0];
    awards.push({
      id: 'multitasker',
      title: 'Multitasking-Meister',
      description: 'Meiste Zeit mit mehreren Spielen gleichzeitig offen',
      playerId: top.playerId,
      valueMs: top.multiGameMs,
    });
  }

  const night = topByMap(computeTimeInHourWindow(sessions, now, 0, 6));
  if (night && night.value > 0) {
    awards.push({
      id: 'nachteule',
      title: 'Nachteule',
      description: 'Meiste Spielzeit zwischen 0 und 6 Uhr',
      playerId: night.playerId,
      valueMs: night.value,
    });
  }

  const early = topByMap(computeTimeInHourWindow(sessions, now, 6, 10));
  if (early && early.value > 0) {
    awards.push({
      id: 'fruehaufsteher',
      title: 'Frühaufsteher',
      description: 'Meiste Spielzeit zwischen 6 und 10 Uhr',
      playerId: early.playerId,
      valueMs: early.value,
    });
  }

  const mostSessions = topByMap(sessionCountByPlayer(sessions));
  if (mostSessions && mostSessions.value > 1) {
    awards.push({
      id: 'zappelphilipp',
      title: 'Zappelphilipp',
      description: 'Häufigste Spielwechsel (meiste Sessions)',
      playerId: mostSessions.playerId,
      valueCount: mostSessions.value,
    });
  }

  const mostGames = topByMap(distinctGamesByPlayer(sessions));
  if (mostGames && mostGames.value > 1) {
    awards.push({
      id: 'allrounder',
      title: 'Allrounder',
      description: 'Die meisten verschiedenen Spiele ausprobiert',
      playerId: mostGames.playerId,
      valueCount: mostGames.value,
    });
  }

  const playtimeEntries = computePlaytime(sessions, now);
  const byPlayerTotals = new Map<string, { totalMs: number; activeMs: number }>();
  for (const e of playtimeEntries) {
    const cur = byPlayerTotals.get(e.playerId) ?? { totalMs: 0, activeMs: 0 };
    cur.totalMs += e.totalMs;
    cur.activeMs += e.activeMs;
    byPlayerTotals.set(e.playerId, cur);
  }
  const eligible = [...byPlayerTotals.entries()]
    .filter(([, v]) => v.totalMs >= MIN_TOTAL_MS_FOR_FOCUS_AWARDS)
    .map(([playerId, v]) => ({ playerId, ratio: v.activeMs / v.totalMs }));

  if (eligible.length >= 2) {
    const mostFocused = eligible.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    const leastFocused = eligible.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    if (mostFocused.ratio > 0) {
      awards.push({
        id: 'fokus',
        title: 'Fokus-Meister',
        description: 'Höchste Aktiv-Quote (wirklich gespielt, nicht nur nebenbei offen)',
        playerId: mostFocused.playerId,
        valuePercent: Math.round(mostFocused.ratio * 100),
      });
    }
    if (leastFocused.playerId !== mostFocused.playerId) {
      awards.push({
        id: 'afk',
        title: 'Chill-Gamer',
        description: 'Spiele liefen am längsten, ohne dass viel aktiv gespielt wurde',
        playerId: leastFocused.playerId,
        valuePercent: Math.round(leastFocused.ratio * 100),
      });
    }
  }

  return awards;
}
