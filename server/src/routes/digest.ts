// "Was steht an?" (FR extension): a small personal digest of things a
// player might otherwise miss — an open vote they haven't cast yet, a
// tournament match that just became playable, or a currently-live game they
// haven't rated their skill for. Read-only and cheap (a handful of indexed
// lookups), so it's fine to poll on every Live view render.

import { Router } from 'express';
import { db, getState } from '../db';

export const digestRouter = Router();

interface GameRow {
  id: string;
  name: string;
  icon: string;
}

interface ReadyMatchRow {
  matchId: string;
  tournamentId: string;
  tournamentName: string;
  gameId: string;
  gameName: string;
  gameIcon: string;
  round: number;
  myTeamName: string;
  opponentTeamName: string;
}

// GET /api/digest?playerId=... - personal "what's up" summary for one player.
digestRouter.get('/', (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  // Open vote the player hasn't cast a vote in yet.
  const round = parseInt(getState('vote_round') ?? '0', 10);
  const open = getState('vote_open') === '1';
  const startedAt = getState('vote_started_at');
  let openVote = null;
  if (open) {
    const alreadyVoted = db.prepare('SELECT 1 FROM votes WHERE player_id = ? AND round = ?').get(playerId, round);
    if (!alreadyVoted) {
      openVote = { round, startedAt: startedAt ? parseInt(startedAt, 10) : null };
    }
  }

  // Tournament matches involving this player where both opponents are now
  // known but the match hasn't been played yet — the "your match is ready"
  // moment that's easy to miss if you're not staring at the Turniere tab.
  // player_ids is stored as a JSON array (see tournaments.ts), so the
  // membership check happens in JS rather than SQL, same as buildDetail().
  const myTeamRows = db
    .prepare(
      `SELECT tt.id AS teamId, tt.name AS teamName, tt.player_ids AS playerIds, t.id AS tournamentId
       FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
       WHERE t.status = 'active'`
    )
    .all() as Array<{ teamId: string; teamName: string; playerIds: string; tournamentId: string }>;
  const myTeamIds = new Set(
    myTeamRows.filter((t) => (JSON.parse(t.playerIds) as string[]).includes(playerId)).map((t) => t.teamId)
  );

  const readyMatches: ReadyMatchRow[] = [];
  if (myTeamIds.size > 0) {
    const pendingRows = db
      .prepare(
        `SELECT tm.id AS matchId, tm.round AS round, tm.team_a_id AS teamAId, tm.team_b_id AS teamBId,
                t.id AS tournamentId, t.name AS tournamentName, t.game_id AS gameId, g.name AS gameName, g.icon AS gameIcon
         FROM tournament_matches tm
         JOIN tournaments t ON t.id = tm.tournament_id
         JOIN games g ON g.id = t.game_id
         WHERE t.status = 'active'
           AND tm.team_a_id IS NOT NULL AND tm.team_b_id IS NOT NULL
           AND tm.winner_team_id IS NULL AND tm.is_draw = 0 AND tm.is_bye = 0
         ORDER BY tm.round, tm.slot`
      )
      .all() as Array<{
        matchId: string;
        round: number;
        teamAId: string;
        teamBId: string;
        tournamentId: string;
        tournamentName: string;
        gameId: string;
        gameName: string;
        gameIcon: string;
      }>;
    const teamNameById = new Map(myTeamRows.map((t) => [t.teamId, t.teamName]));
    for (const m of pendingRows) {
      const myTeamId = myTeamIds.has(m.teamAId) ? m.teamAId : myTeamIds.has(m.teamBId) ? m.teamBId : null;
      if (!myTeamId) continue;
      const opponentId = myTeamId === m.teamAId ? m.teamBId : m.teamAId;
      readyMatches.push({
        matchId: m.matchId,
        tournamentId: m.tournamentId,
        tournamentName: m.tournamentName,
        gameId: m.gameId,
        gameName: m.gameName,
        gameIcon: m.gameIcon,
        round: m.round,
        myTeamName: teamNameById.get(myTeamId) ?? 'Unbekannt',
        opponentTeamName: teamNameById.get(opponentId) ?? 'Unbekannt',
      });
    }
  }

  // Games currently being played by anyone that this player hasn't rated a
  // skill for yet — the best moment to ask, since it's obviously relevant.
  const missingSkills = db
    .prepare(
      `SELECT DISTINCT g.id, g.name, g.icon
       FROM live_status_games lsg
       JOIN games g ON g.id = lsg.game_id
       WHERE NOT EXISTS (SELECT 1 FROM skills s WHERE s.player_id = ? AND s.game_id = lsg.game_id)
       ORDER BY g.name COLLATE NOCASE`
    )
    .all(playerId) as GameRow[];

  res.json({ openVote, readyMatches, missingSkills });
});
