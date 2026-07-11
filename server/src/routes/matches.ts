// Recorded match results (FR-22, FR-25). Result details (teams + winner) are
// stored as JSON since the leaderboard scoring rules are still being decided
// and this keeps the schema stable while that's worked out. Each match is
// tagged with the event that was active when it was recorded, so results can
// be viewed per LAN afterwards; editing a match never moves it to a
// different event.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { getTrackingEventId } from '../events';

export const matchesRouter = Router();

interface TeamInput {
  playerIds: string[];
  // Both optional and independent of winnerTeamIndex/each other: a game with
  // a real score (Punktestand) can carry `score`, a placement-only game
  // (Mario Kart, ein Rennen) can carry `rank` instead, some games want both.
  // Neither feeds the leaderboard's win/loss scoring (see leaderboard.ts) —
  // that still only reads winnerTeamIndex — they're purely for display.
  score?: number | null;
  rank?: number | null; // 1 = first place; ties allowed (same rank twice)
}

interface MatchResult {
  teams: TeamInput[];
  winnerTeamIndex: number | null;
}

interface MatchRow {
  id: string;
  game_id: string;
  event_id: string;
  played_at: number;
  result: string;
}

function parseMatch(row: MatchRow) {
  return {
    id: row.id,
    gameId: row.game_id,
    eventId: row.event_id,
    playedAt: row.played_at,
    ...(JSON.parse(row.result) as MatchResult),
  };
}

function validateTeams(
  teams: unknown,
  winnerTeamIndex: unknown
): MatchResult | { error: string } {
  if (!Array.isArray(teams) || teams.length < 2) {
    return { error: 'teams muss ein Array mit mindestens 2 Teams sein.' };
  }
  const allIds: string[] = [];
  const normalizedTeams: TeamInput[] = [];
  for (const t of teams as unknown[]) {
    const team = t as { playerIds?: unknown; score?: unknown; rank?: unknown };
    if (
      !team ||
      !Array.isArray(team.playerIds) ||
      team.playerIds.length === 0 ||
      !team.playerIds.every((p) => typeof p === 'string')
    ) {
      return { error: 'Jedes Team braucht mindestens einen Spieler (playerIds).' };
    }
    allIds.push(...(team.playerIds as string[]));

    let score: number | null = null;
    if (team.score !== undefined && team.score !== null) {
      if (typeof team.score !== 'number' || !Number.isFinite(team.score)) {
        return { error: 'score muss eine Zahl sein.' };
      }
      score = team.score;
    }
    let rank: number | null = null;
    if (team.rank !== undefined && team.rank !== null) {
      if (typeof team.rank !== 'number' || !Number.isInteger(team.rank) || team.rank < 1) {
        return { error: 'rank muss eine positive ganze Zahl sein (1 = erster Platz).' };
      }
      rank = team.rank;
    }
    normalizedTeams.push({ playerIds: team.playerIds as string[], score, rank });
  }
  if (new Set(allIds).size !== allIds.length) {
    return { error: 'Ein Spieler kann nicht gleichzeitig in mehreren Teams stehen.' };
  }

  let winner: number | null = null;
  if (winnerTeamIndex !== undefined && winnerTeamIndex !== null) {
    if (
      typeof winnerTeamIndex !== 'number' ||
      !Number.isInteger(winnerTeamIndex) ||
      winnerTeamIndex < 0 ||
      winnerTeamIndex >= teams.length
    ) {
      return { error: 'winnerTeamIndex ist ungültig.' };
    }
    winner = winnerTeamIndex;
  }

  return { teams: normalizedTeams, winnerTeamIndex: winner };
}

function allPlayersExist(playerIds: string[]): boolean {
  if (playerIds.length === 0) return true;
  const placeholders = playerIds.map(() => '?').join(',');
  const found = db.prepare(`SELECT id FROM players WHERE id IN (${placeholders})`).all(...playerIds) as Array<{
    id: string;
  }>;
  return found.length === new Set(playerIds).size;
}

// GET /api/matches - list, newest first, optionally filtered by ?gameId=
// and/or ?eventId=.
matchesRouter.get('/', (req, res) => {
  const { gameId, eventId } = req.query;
  const clauses: string[] = [];
  const params: string[] = [];
  if (typeof gameId === 'string') {
    clauses.push('game_id = ?');
    params.push(gameId);
  }
  if (typeof eventId === 'string') {
    clauses.push('event_id = ?');
    params.push(eventId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM matches ${where} ORDER BY played_at DESC`).all(...params) as MatchRow[];
  res.json(rows.map(parseMatch));
});

// POST /api/matches - record a new result.
// Body: { gameId, teams: [{ playerIds }], winnerTeamIndex?, playedAt?, drawId? }
// drawId links back to the matchmaking_draws row this result came from (a
// "Teams auslosen" / draft lineup), moving it from Team-Historie to
// Ergebnis-Historie — optional since results can also be entered ad-hoc.
matchesRouter.post('/', (req, res) => {
  const { gameId, teams, winnerTeamIndex, playedAt, drawId } = req.body ?? {};

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId);
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const validated = validateTeams(teams, winnerTeamIndex);
  if ('error' in validated) return res.status(400).json({ error: validated.error });

  const allIds = validated.teams.flatMap((t) => t.playerIds);
  if (!allPlayersExist(allIds)) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }
  if (playedAt !== undefined && (typeof playedAt !== 'number' || !Number.isFinite(playedAt))) {
    return res.status(400).json({ error: 'playedAt muss ein Zeitstempel (ms) sein.' });
  }
  if (drawId !== undefined && (typeof drawId !== 'string' || !drawId)) {
    return res.status(400).json({ error: 'drawId ist ungültig.' });
  }
  if (drawId) {
    const draw = db.prepare('SELECT id, match_id FROM matchmaking_draws WHERE id = ?').get(drawId) as
      | { id: string; match_id: string | null }
      | undefined;
    if (!draw) return res.status(404).json({ error: 'Auslosung nicht gefunden.' });
    if (draw.match_id) return res.status(409).json({ error: 'Für diese Auslosung wurde bereits ein Ergebnis erfasst.' });
  }

  const row: MatchRow = {
    id: nanoid(),
    game_id: gameId,
    event_id: getTrackingEventId(),
    played_at: playedAt ?? Date.now(),
    result: JSON.stringify({ teams: validated.teams, winnerTeamIndex: validated.winnerTeamIndex }),
  };
  db.prepare('INSERT INTO matches (id, game_id, event_id, played_at, result) VALUES (?, ?, ?, ?, ?)').run(
    row.id,
    row.game_id,
    row.event_id,
    row.played_at,
    row.result
  );

  if (drawId) {
    // Race-safe: only claims the draw if it's still unrecorded, so two
    // simultaneous submissions for the same draw can't both "win" it.
    const claimed = db
      .prepare('UPDATE matchmaking_draws SET match_id = ? WHERE id = ? AND match_id IS NULL')
      .run(row.id, drawId);
    if (claimed.changes > 0) broadcast(Events.matchmakingDrawsChanged, { id: drawId, matchId: row.id });
  }

  broadcast(Events.leaderboardChanged, null);
  res.status(201).json(parseMatch(row));
});

// PATCH /api/matches/:id - correct a mistaken entry. event_id never changes —
// a match stays tagged to the LAN it was actually played at.
matchesRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id) as
    | MatchRow
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Match nicht gefunden.' });

  const { gameId, teams, winnerTeamIndex, playedAt } = req.body ?? {};
  const prevResult = JSON.parse(existing.result) as MatchResult;

  let nextGameId = existing.game_id;
  if (gameId !== undefined) {
    if (typeof gameId !== 'string' || !gameId) {
      return res.status(400).json({ error: 'gameId ist ungültig.' });
    }
    const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
    nextGameId = gameId;
  }

  let nextResultObj = prevResult;
  if (teams !== undefined || winnerTeamIndex !== undefined) {
    const validated = validateTeams(
      teams ?? prevResult.teams,
      winnerTeamIndex !== undefined ? winnerTeamIndex : prevResult.winnerTeamIndex
    );
    if ('error' in validated) return res.status(400).json({ error: validated.error });
    if (!allPlayersExist(validated.teams.flatMap((t) => t.playerIds))) {
      return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
    }
    nextResultObj = validated;
  }

  let nextPlayedAt = existing.played_at;
  if (playedAt !== undefined) {
    if (typeof playedAt !== 'number' || !Number.isFinite(playedAt)) {
      return res.status(400).json({ error: 'playedAt muss ein Zeitstempel (ms) sein.' });
    }
    nextPlayedAt = playedAt;
  }

  const nextResult = JSON.stringify(nextResultObj);
  db.prepare('UPDATE matches SET game_id = ?, played_at = ?, result = ? WHERE id = ?').run(
    nextGameId,
    nextPlayedAt,
    nextResult,
    existing.id
  );

  broadcast(Events.leaderboardChanged, null);
  res.json(
    parseMatch({ id: existing.id, game_id: nextGameId, event_id: existing.event_id, played_at: nextPlayedAt, result: nextResult })
  );
});

// DELETE /api/matches/:id
matchesRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM matches WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Match nicht gefunden.' });
  broadcast(Events.leaderboardChanged, null);
  res.status(204).end();
});
