// Pure scoring rules. The caller supplies the eligible participant set and
// betting qualification; event scope, N's cutoff and minimum tips are policies
// outside this calculation.
export const POINT_CATEGORIES = ['orga', 'playing', 'betting'] as const;
export type PointCategory = (typeof POINT_CATEGORIES)[number];

export interface CategoryScoringInput {
  playerId: string;
  raw: Record<PointCategory, number>;
  bettingQualified: boolean;
}
export interface CategoryScore {
  raw: number;
  rank: number | null;
  placePoints: number;
}
export interface CategoryStanding {
  playerId: string;
  categories: Record<PointCategory, CategoryScore>;
  points: number;
  rank: number;
}

export function computeCategoryStandings(participants: CategoryScoringInput[]): CategoryStanding[] {
  const n = participants.length;
  const rows = participants.map((player) => ({
    playerId: player.playerId,
    categories: Object.fromEntries(POINT_CATEGORIES.map((category) => [category,
      { raw: player.raw[category], rank: null, placePoints: 0 }])) as Record<PointCategory, CategoryScore>,
    points: 0,
    rank: 0,
  }));
  for (const category of POINT_CATEGORIES) {
    const ranked = participants.filter((player) => player.raw[category] > 0 &&
      (category !== 'betting' || player.bettingQualified))
      .sort((a, b) => b.raw[category] - a.raw[category]);
    const rankByValue = new Map<number, number>();
    ranked.forEach((player, index) => {
      if (!rankByValue.has(player.raw[category])) rankByValue.set(player.raw[category], index + 1);
    });
    for (const row of rows) {
      const eligible = ranked.some((player) => player.playerId === row.playerId);
      const score = row.categories[category];
      score.rank = eligible ? rankByValue.get(score.raw)! : null;
      score.placePoints = score.rank === null ? 0 : n - score.rank + 1;
      row.points += score.placePoints;
    }
  }
  rows.sort((a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId, 'en'));
  const rankByTotal = new Map<number, number>();
  rows.forEach((row, index) => {
    if (!rankByTotal.has(row.points)) rankByTotal.set(row.points, index + 1);
    row.rank = rankByTotal.get(row.points)!;
  });
  return rows;
}
