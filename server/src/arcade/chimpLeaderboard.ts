import { db } from '../db';
import { chimpRating, compareChimpResults, rankChimpResults, type ChimpRating } from './chimpLogic';

// Every Chimp Test run is stored as its own single-player arcade_results row
// (see chimp.ts). The leaderboard ranks each player's best run; there are no
// wins, losses or placements.

export interface ChimpRunScore {
  playerId: string;
  name: string;
  mode: 'solo';
  level: number;
  outcome: string;
  strikesAtLevel: number;
  activeMsAtLevel: number;
  totalStrikes: number;
  totalActiveMs: number;
}

export interface ChimpLeaderboardEntry {
  playerId: string;
  name: string;
  level: number;
  strikesAtLevel: number;
  activeMsAtLevel: number;
  achievedAt: number;
  runs: number;
  averageLevel: number;
  rating: ChimpRating;
  place: number;
}

function parseScore(raw: string): ChimpRunScore | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entry = Array.isArray(parsed) ? parsed[0] : null;
    if (!entry || typeof entry !== 'object') return null;
    const score = entry as Partial<ChimpRunScore>;
    if (typeof score.playerId !== 'string' || !Number.isFinite(score.level)) return null;
    return {
      playerId: score.playerId,
      name: typeof score.name === 'string' ? score.name : 'Spieler',
      mode: 'solo',
      level: Number(score.level),
      outcome: String(score.outcome ?? ''),
      strikesAtLevel: Number(score.strikesAtLevel) || 0,
      activeMsAtLevel: Number(score.activeMsAtLevel) || 0,
      totalStrikes: Number(score.totalStrikes) || 0,
      totalActiveMs: Number(score.totalActiveMs) || 0,
    };
  } catch {
    return null;
  }
}

export function chimpLeaderboard(groupId: string, eventId: string): ChimpLeaderboardEntry[] {
  const rows = db.prepare(
    `SELECT scores, ended_at FROM arcade_results
     WHERE group_id = ? AND event_id = ? AND game_type = 'chimp'
     ORDER BY ended_at ASC`,
  ).all(groupId, eventId) as Array<{ scores: string; ended_at: number }>;
  const players = new Map<string, Omit<ChimpLeaderboardEntry, 'place' | 'rating' | 'averageLevel'> & { levelSum: number }>();
  for (const row of rows) {
    const score = parseScore(row.scores);
    if (!score || score.outcome === 'invalid') continue;
    const current = players.get(score.playerId);
    const candidate = { level: score.level, strikesAtLevel: score.strikesAtLevel, activeMsAtLevel: score.activeMsAtLevel };
    // Rows arrive oldest first, so an equal later run keeps the earlier achievement.
    const better = !current || compareChimpResults(candidate, current) < 0;
    const base = current ?? { playerId: score.playerId, name: score.name, level: 0, strikesAtLevel: 0, activeMsAtLevel: 0, achievedAt: row.ended_at, runs: 0, levelSum: 0 };
    base.runs += 1;
    base.levelSum += score.level;
    base.name = score.name;
    if (better) Object.assign(base, candidate, { achievedAt: row.ended_at });
    players.set(score.playerId, base);
  }
  return rankChimpResults([...players.values()], { byAchievedAt: true }).map(({ levelSum, ...entry }) => ({
    ...entry,
    averageLevel: entry.runs > 0 ? Math.round((levelSum / entry.runs) * 10) / 10 : 0,
    rating: chimpRating(entry.level),
  }));
}
