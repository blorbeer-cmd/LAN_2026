// Skill-Vorschlag: a read-only hint derived from actually-played match
// results, shown alongside a player's own skill self-rating (never
// overwriting it — see routes/skills.ts and server/CLAUDE.md games reorg).
// Deliberately simple (Elo-lite, not a full rating system): decided 2-team
// matches for one game, processed chronologically, team rating = average of
// its members, K-factor 32, mapped onto the shared 1-10 skill scale at the
// end. Multi-team or undecided matches don't have a clear winner to update
// from, so they're skipped here — but still count toward the "enough data"
// gate the caller applies via MIN_RESULTS_FOR_SUGGESTION.

const STARTING_ELO = 1500;
const K_FACTOR = 32;
// Anchors for the 1-10 mapping: 1200 elo -> skill 1, 1800 elo -> skill 10.
const ELO_FLOOR = 1200;
const ELO_CEIL = 1800;

export const MIN_RESULTS_FOR_SUGGESTION = 3;

export interface SkillSuggestionMatch {
  teams: Array<{ playerIds: string[] }>;
  winnerTeamIndex: number | null;
  playedAt: number;
}

export interface PlayerSkillSuggestion {
  playerId: string;
  rating: number; // 1-10, clamped
  gamesPlayed: number;
  wins: number;
}

function eloToSkillRating(elo: number): number {
  const fraction = (elo - ELO_FLOOR) / (ELO_CEIL - ELO_FLOOR);
  const rating = Math.round(1 + fraction * 9);
  return Math.min(10, Math.max(1, rating));
}

// One game's worth of decided matches in, one suggested skill rating per
// player who appeared in a 2-team match out. Callers should only surface
// this once `matches.length >= MIN_RESULTS_FOR_SUGGESTION` — this function
// itself has no opinion on how much data is "enough".
export function computeSkillSuggestionsForGame(matches: SkillSuggestionMatch[]): PlayerSkillSuggestion[] {
  const decidedTwoTeam = matches
    .filter((m) => m.winnerTeamIndex !== null && m.teams.length === 2)
    .sort((a, b) => a.playedAt - b.playedAt);

  const elo = new Map<string, number>();
  const gamesPlayed = new Map<string, number>();
  const wins = new Map<string, number>();
  const ratingOf = (id: string) => elo.get(id) ?? STARTING_ELO;
  const teamAverage = (ids: string[]) => ids.reduce((sum, id) => sum + ratingOf(id), 0) / ids.length;

  for (const match of decidedTwoTeam) {
    const [teamA, teamB] = match.teams;
    const winnerIndex = match.winnerTeamIndex as number;
    const ratingA = teamAverage(teamA.playerIds);
    const ratingB = teamAverage(teamB.playerIds);
    const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
    const scoreA = winnerIndex === 0 ? 1 : 0;
    const deltaA = K_FACTOR * (scoreA - expectedA);

    for (const id of teamA.playerIds) {
      elo.set(id, ratingOf(id) + deltaA);
      gamesPlayed.set(id, (gamesPlayed.get(id) ?? 0) + 1);
      if (winnerIndex === 0) wins.set(id, (wins.get(id) ?? 0) + 1);
    }
    for (const id of teamB.playerIds) {
      elo.set(id, ratingOf(id) - deltaA);
      gamesPlayed.set(id, (gamesPlayed.get(id) ?? 0) + 1);
      if (winnerIndex === 1) wins.set(id, (wins.get(id) ?? 0) + 1);
    }
  }

  return [...elo.entries()].map(([playerId, eloRating]) => ({
    playerId,
    rating: eloToSkillRating(eloRating),
    gamesPlayed: gamesPlayed.get(playerId) ?? 0,
    wins: wins.get(playerId) ?? 0,
  }));
}
