// Pure aggregation over recorded matches for the "Spiele & Turniere"
// analytics tab (match counts per game, and a few "witzige" head-to-head
// stats) — kept free of DB access like playtime.ts/awards.ts so it's
// directly unit-testable. Tournament/draw counts are simple enough
// GROUP BY-style aggregations that they're computed straight in the route.

export interface MatchForStats {
  gameId: string;
  teams: Array<{ playerIds: string[] }>;
  winnerTeamIndex: number | null;
}

export interface GameMatchCount {
  gameId: string;
  count: number;
  decided: number; // has a winner
  undecided: number; // draw, or no winner declared (incl. FFA "kein Sieger")
}

export function matchCountsByGame(matches: MatchForStats[]): GameMatchCount[] {
  const byGame = new Map<string, GameMatchCount>();
  for (const m of matches) {
    const entry = byGame.get(m.gameId) ?? { gameId: m.gameId, count: 0, decided: 0, undecided: 0 };
    entry.count += 1;
    if (m.winnerTeamIndex !== null) entry.decided += 1;
    else entry.undecided += 1;
    byGame.set(m.gameId, entry);
  }
  return [...byGame.values()].sort((a, b) => b.count - a.count);
}

export interface PairCount {
  playerAId: string;
  playerBId: string;
  count: number;
}

// Every 2-team match contributes one "encounter" per opposing player pair
// (the cross product of both rosters) — the pair with the most encounters
// is the LAN's biggest rivalry. Matches with more than 2 teams don't have a
// clean notion of "opponent pair", so they're skipped.
export function biggestRivalry(matches: MatchForStats[]): PairCount | null {
  const counts = new Map<string, PairCount>();
  for (const m of matches) {
    if (m.teams.length !== 2) continue;
    for (const a of m.teams[0].playerIds) {
      for (const b of m.teams[1].playerIds) {
        const key = [a, b].sort().join('::');
        const [playerAId, playerBId] = key.split('::');
        const entry = counts.get(key) ?? { playerAId, playerBId, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
  }
  let best: PairCount | null = null;
  for (const c of counts.values()) {
    if (!best || c.count > best.count) best = c;
  }
  return best;
}

export interface DuoStat {
  playerAId: string;
  playerBId: string;
  gamesTogether: number;
  winsTogether: number;
}

// Every pair of players who ever shared a team (any team size), and how
// often they won together — the backbone for "bestes Duo". Ranked by games
// played together first, win rate as the tiebreaker.
export function bestDuo(matches: MatchForStats[]): DuoStat | null {
  const stats = new Map<string, DuoStat>();
  for (const m of matches) {
    m.teams.forEach((team, teamIndex) => {
      const ids = team.playerIds;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = [ids[i], ids[j]].sort().join('::');
          const [playerAId, playerBId] = key.split('::');
          const entry = stats.get(key) ?? { playerAId, playerBId, gamesTogether: 0, winsTogether: 0 };
          entry.gamesTogether += 1;
          if (m.winnerTeamIndex === teamIndex) entry.winsTogether += 1;
          stats.set(key, entry);
        }
      }
    });
  }
  let best: DuoStat | null = null;
  for (const s of stats.values()) {
    const better =
      !best ||
      s.gamesTogether > best.gamesTogether ||
      (s.gamesTogether === best.gamesTogether && s.winsTogether / s.gamesTogether > best.winsTogether / best.gamesTogether);
    if (better) best = s;
  }
  return best;
}

export interface MatchForUnderdog extends MatchForStats {
  id: string;
}

export interface UnderdogResult {
  matchId: string;
  gameId: string;
  winnerTeamIndex: number;
  winnerAvgRating: number;
  loserAvgRating: number;
  gap: number; // how much lower-rated the winner was, on average — bigger = a bigger surprise
}

// The most dramatic "should have lost on paper" result: a 2-team, decided
// match where the winning team's average skill rating was below the losing
// team's. ratingOf supplies each player's rating for that game (callers
// default unrated players to the same neutral rating matchmaking.ts uses).
export function biggestUnderdogWin(
  matches: MatchForUnderdog[],
  ratingOf: (playerId: string, gameId: string) => number
): UnderdogResult | null {
  let best: UnderdogResult | null = null;
  for (const m of matches) {
    if (m.teams.length !== 2 || m.winnerTeamIndex === null) continue;
    const avg = (ids: string[]) => ids.reduce((sum, id) => sum + ratingOf(id, m.gameId), 0) / ids.length;
    const winnerIdx = m.winnerTeamIndex;
    const loserIdx = winnerIdx === 0 ? 1 : 0;
    const winnerAvgRating = avg(m.teams[winnerIdx].playerIds);
    const loserAvgRating = avg(m.teams[loserIdx].playerIds);
    const gap = loserAvgRating - winnerAvgRating;
    if (gap <= 0) continue; // not an upset — the winner was rated at or above the loser
    if (!best || gap > best.gap) {
      best = { matchId: m.id, gameId: m.gameId, winnerTeamIndex: winnerIdx, winnerAvgRating, loserAvgRating, gap };
    }
  }
  return best;
}
