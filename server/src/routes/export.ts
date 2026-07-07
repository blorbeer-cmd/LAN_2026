// "Export als Andenken": a one-click JSON snapshot of everything that
// happened at one LAN (leaderboard, playtime, awards, tournament
// champions) — a keepsake, and reuses the same pure scoring/stats logic the
// live views already use rather than re-deriving anything.

import { Router } from 'express';
import { db } from '../db';
import { computeStandings, type MatchForScoring } from '../leaderboard';
import { computePlaytime, aggregateByGame, formatDurationMs, type PlaySession } from '../playtime';
import { computeAwards } from '../awards';
import { getActiveEventId } from '../events';
import { getCompletedTournamentSummaries } from './tournamentChampion';

export const exportRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  color: string;
}
interface GameRow {
  id: string;
  name: string;
  icon: string;
}
interface EventRow {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number | null;
}

// GET /api/export - a full snapshot for one event (the active one by
// default, or an explicit ?eventId=).
exportRouter.get('/', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getActiveEventId();

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(filterEventId) as EventRow | undefined;
  if (!event) return res.status(404).json({ error: 'Event nicht gefunden.' });

  const players = db.prepare('SELECT id, name, color FROM players').all() as PlayerRow[];
  const playerById = new Map(players.map((p) => [p.id, p]));
  const games = db.prepare('SELECT id, name, icon FROM games').all() as GameRow[];
  const gameById = new Map(games.map((g) => [g.id, g]));
  const now = Date.now();

  // ---------- Leaderboard, scoped to this event's matches ----------
  const matchRows = db.prepare('SELECT result FROM matches WHERE event_id = ?').all(filterEventId) as Array<{
    result: string;
  }>;
  const matches: MatchForScoring[] = matchRows.map((r) => JSON.parse(r.result));
  const leaderboard = computeStandings(matches).map((s) => ({
    playerId: s.playerId,
    name: playerById.get(s.playerId)?.name ?? 'Unbekannt',
    points: s.points,
    wins: s.wins,
    matchesPlayed: s.matchesPlayed,
  }));

  // ---------- Playtime, scoped to this event's sessions ----------
  const sessionRows = db
    .prepare('SELECT player_id, game_id, started_at, ended_at, active_ms FROM play_sessions WHERE event_id = ?')
    .all(filterEventId) as Array<{
    player_id: string;
    game_id: string;
    started_at: number;
    ended_at: number | null;
    active_ms: number;
  }>;
  const sessions: PlaySession[] = sessionRows.map((r) => ({
    playerId: r.player_id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeMs: r.active_ms,
  }));
  const playtimeEntries = computePlaytime(sessions, now);

  const totalMsByPlayer = new Map<string, number>();
  for (const e of playtimeEntries) {
    totalMsByPlayer.set(e.playerId, (totalMsByPlayer.get(e.playerId) ?? 0) + e.totalMs);
  }
  const playtimeByPlayer = [...totalMsByPlayer.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([playerId, totalMs]) => ({
      playerId,
      name: playerById.get(playerId)?.name ?? 'Unbekannt',
      totalFormatted: formatDurationMs(totalMs),
    }));

  const playtimeByGame = aggregateByGame(playtimeEntries)
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((g) => ({
      gameId: g.gameId,
      gameName: gameById.get(g.gameId)?.name ?? 'Unbekannt',
      gameIcon: gameById.get(g.gameId)?.icon ?? '🎮',
      totalFormatted: formatDurationMs(g.totalMs),
    }));

  // ---------- Awards ----------
  const rawAwards = computeAwards(sessions, now);
  const awards = rawAwards.map((a) => ({
    emoji: a.emoji,
    title: a.title,
    description: a.description,
    playerName: playerById.get(a.playerId)?.name ?? 'Unbekannt',
    value:
      a.valueMs !== undefined
        ? formatDurationMs(a.valueMs)
        : a.valuePercent !== undefined
          ? `${a.valuePercent}%`
          : `${a.valueCount}`,
  }));

  // ---------- Tournament champions ----------
  const tournaments = getCompletedTournamentSummaries(filterEventId).map((t) => ({
    name: t.name,
    format: t.format,
    gameName: t.gameName,
    gameIcon: t.gameIcon,
    championTeamName: t.championTeamName,
    championPlayers: t.championPlayerIds.map((id) => playerById.get(id)?.name ?? 'Unbekannt'),
  }));

  res.json({
    event: { id: event.id, name: event.name, startsAt: event.starts_at, endsAt: event.ends_at },
    exportedAt: now,
    leaderboard,
    playtimeByPlayer,
    playtimeByGame,
    awards,
    tournaments,
  });
});
