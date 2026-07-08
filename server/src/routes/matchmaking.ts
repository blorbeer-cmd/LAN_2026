// Matchmaking endpoint (FR-16..18): draws balanced teams for a game from a
// set of present players, using their skill ratings. Stateless — every call
// is a fresh draw, so "re-roll" is just calling it again. The result is
// broadcast to everyone so the whole LAN sees the same teams, not just
// whoever clicked the button.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { balanceTeams, computeTeamCount, countSeatConflicts, type PlayerRating, type SeatPair } from '../matchmaking';
import { isIntInRange } from '../validation';
import { getTrackingEventId } from '../events';

export const matchmakingRouter = Router();

const DEFAULT_RATING = 5; // neutral middle rating for players without one

interface GameRow {
  id: string;
  name: string;
  max_team_size: number;
}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

// POST /api/matchmaking
// Body: { gameId: string, playerIds: string[], teamCount?: number,
//         avoidAdjacentOpponents?: boolean }
// avoidAdjacentOpponents is a per-draw choice, not a game setting — whether
// it's worth keeping seat-neighbors off opposing teams depends on how
// competitive/serious that particular round is, not the game itself.
matchmakingRouter.post('/', (req, res) => {
  const { gameId, playerIds, teamCount, avoidAdjacentOpponents } = req.body ?? {};

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (!Array.isArray(playerIds) || playerIds.length < 2 || !playerIds.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'playerIds muss ein Array mit mindestens 2 Spielern sein.' });
  }
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length !== playerIds.length) {
    return res.status(400).json({ error: 'playerIds enthält Duplikate.' });
  }
  if (teamCount !== undefined && !isIntInRange(teamCount, 2, uniqueIds.length)) {
    // Surfaced directly as a toast by the matchmaking view, so phrase it for
    // humans (the other shape errors here are unreachable through the UI).
    return res
      .status(400)
      .json({ error: `Anzahl Teams muss zwischen 2 und ${uniqueIds.length} (Anzahl Spieler) liegen.` });
  }
  if (avoidAdjacentOpponents !== undefined && typeof avoidAdjacentOpponents !== 'boolean') {
    return res.status(400).json({ error: 'avoidAdjacentOpponents muss ein Boolean sein.' });
  }

  const game = db.prepare('SELECT id, name, max_team_size FROM games WHERE id = ?').get(gameId) as
    | GameRow
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const placeholders = uniqueIds.map(() => '?').join(',');
  const players = db
    .prepare(`SELECT id, name, color, avatar FROM players WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as PlayerRow[];
  if (players.length !== uniqueIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  const ratingRows = db
    .prepare(`SELECT player_id, rating FROM skills WHERE game_id = ? AND player_id IN (${placeholders})`)
    .all(gameId, ...uniqueIds) as Array<{ player_id: string; rating: number }>;
  const ratingByPlayer = new Map(ratingRows.map((r) => [r.player_id, r.rating]));

  const ratings: PlayerRating[] = players.map((p) => ({
    id: p.id,
    rating: ratingByPlayer.get(p.id) ?? DEFAULT_RATING,
  }));

  // Seat neighbors only get looked up when this particular draw asked for
  // it (FR-18 extension) — skip the query entirely otherwise.
  const avoidPairs: SeatPair[] = [];
  if (avoidAdjacentOpponents) {
    const neighborRows = db
      .prepare(
        `SELECT player_id, neighbor_id FROM seat_neighbors
         WHERE event_id = ? AND player_id IN (${placeholders}) AND neighbor_id IN (${placeholders})`
      )
      .all(getTrackingEventId(), ...uniqueIds, ...uniqueIds) as Array<{
      player_id: string;
      neighbor_id: string;
    }>;
    // Neighbors are declared per-direction (see seat_neighbors' comment in
    // db.ts) — dedupe A-B/B-A into a single pair so it isn't double-weighted.
    const seen = new Set<string>();
    for (const r of neighborRows) {
      const key = [r.player_id, r.neighbor_id].sort().join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      avoidPairs.push([r.player_id, r.neighbor_id]);
    }
  }

  const resolvedTeamCount = computeTeamCount(teamCount, players.length, game.max_team_size);
  const teamIdLists = balanceTeams(ratings, resolvedTeamCount, avoidPairs);
  const seatConflicts = countSeatConflicts(teamIdLists, avoidPairs);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const teams = teamIdLists.map((ids) => {
    const teamPlayers = ids.map((id) => ({
      ...playerById.get(id)!,
      rating: ratingByPlayer.get(id) ?? DEFAULT_RATING,
    }));
    return {
      players: teamPlayers,
      totalRating: teamPlayers.reduce((sum, p) => sum + p.rating, 0),
    };
  });

  const result = {
    gameId,
    gameName: game.name,
    teams,
    seatConflicts,
    seatPairsConsidered: avoidPairs.length,
    generatedAt: Date.now(),
  };

  // Logged for the history view (every draw, including re-rolls — see the
  // matchmaking_draws comment in db.ts for why this is separate from the
  // actually-recorded `matches`).
  db.prepare(
    `INSERT INTO matchmaking_draws (id, game_id, event_id, teams, seat_conflicts, seat_pairs_considered, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), gameId, getTrackingEventId(), JSON.stringify(teams), seatConflicts, avoidPairs.length, result.generatedAt);

  broadcast(Events.matchmakingGenerated, result);
  res.json(result);
});

interface DrawRow {
  id: string;
  gameId: string;
  gameName: string;
  gameIcon: string;
  teamsJson: string;
  seatConflicts: number;
  seatPairsConsidered: number;
  generatedAt: number;
}

// GET /api/matchmaking/history - past draws for the active event (or an
// explicit ?eventId=), newest first, optionally narrowed to one ?gameId=.
matchmakingRouter.get('/history', (req, res) => {
  const { eventId, gameId, limit } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();
  const limitNum = Math.min(50, Math.max(1, parseInt(typeof limit === 'string' ? limit : '', 10) || 20));

  const clauses = ['md.event_id = ?'];
  const params: Array<string | number> = [filterEventId];
  if (typeof gameId === 'string' && gameId) {
    clauses.push('md.game_id = ?');
    params.push(gameId);
  }

  const rows = db
    .prepare(
      `SELECT md.id AS id, md.game_id AS gameId, g.name AS gameName, g.icon AS gameIcon,
              md.teams AS teamsJson, md.seat_conflicts AS seatConflicts,
              md.seat_pairs_considered AS seatPairsConsidered, md.generated_at AS generatedAt
       FROM matchmaking_draws md
       JOIN games g ON g.id = md.game_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY md.generated_at DESC
       LIMIT ?`
    )
    .all(...params, limitNum) as DrawRow[];

  const history = rows.map((r) => ({
    id: r.id,
    gameId: r.gameId,
    gameName: r.gameName,
    gameIcon: r.gameIcon,
    teams: JSON.parse(r.teamsJson),
    seatConflicts: r.seatConflicts,
    seatPairsConsidered: r.seatPairsConsidered,
    generatedAt: r.generatedAt,
  }));

  res.json({ history });
});
