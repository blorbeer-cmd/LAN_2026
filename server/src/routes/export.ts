// "Export als Andenken": a one-click JSON snapshot of everything that
// happened at one LAN (leaderboard, playtime, awards, tournament
// champions) — a keepsake, and reuses the same pure scoring/stats logic the
// live views already use rather than re-deriving anything.

import { Router } from 'express';
import { db, DEFAULT_GROUP_ID } from '../db';
import { computeStandings, type MatchForScoring } from '../leaderboard';
import { computePlaytime, aggregateByGame, formatDurationMs, type PlaySession } from '../playtime';
import { computeAwards } from '../awards';
import { getTrackingEventId } from '../events';
import { getCompletedTournamentSummaries } from './tournamentChampion';
import { renderExportPdf } from '../pdfExport';
import PDFDocument from 'pdfkit';
import { config } from '../config';

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

export interface ExportSnapshot {
  event: { id: string; name: string; startsAt: number; endsAt: number | null };
  exportedAt: number;
  leaderboard: Array<{ playerId: string; name: string; points: number; wins: number; matchesPlayed: number }>;
  playtimeByPlayer: Array<{ playerId: string; name: string; totalFormatted: string }>;
  playtimeByGame: Array<{ gameId: string; gameName: string; gameIcon: string; totalFormatted: string }>;
  awards: Array<{ title: string; description: string; playerName: string; value: string }>;
  tournaments: Array<{
    name: string;
    format: string;
    gameName: string;
    gameIcon: string;
    championTeamName: string | null;
    championPlayers: string[];
  }>;
  voteRounds: Array<{
    round: number;
    mode: string;
    title: string | null;
    startedAt: number;
    closedAt: number | null;
    totalVoters: number;
    totalVotes: number;
    totalPoints: number;
    winners: Array<{ gameId: string; gameName: string }>;
  }>;
  drafts: Array<{
    id: string;
    status: string;
    gameId: string;
    gameName: string;
    createdAt: number;
    teams: Array<{ captainId: string; players: Array<{ playerId: string; playerName: string }> }>;
  }>;
}

// Builds the full "Andenken" snapshot for one event — shared by the JSON
// and PDF export endpoints so they can never drift apart.
export function buildExportSnapshot(filterEventId: string, groupId: string): ExportSnapshot | undefined {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND group_id = ?').get(filterEventId, groupId) as
    EventRow | undefined;
  if (!event) return undefined;

  const players =
    config.authMode === 'legacy'
      ? (db.prepare('SELECT id, name, color FROM players').all() as PlayerRow[])
      : (db
          .prepare(
            `SELECT p.id, p.name, p.color
           FROM players p JOIN group_memberships gm ON gm.player_id = p.id
           WHERE gm.group_id = ? AND gm.status = 'active'`,
          )
          .all(groupId) as PlayerRow[]);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const games = db
    .prepare('SELECT id, name, icon FROM games WHERE group_id = ? OR arcade_key IS NOT NULL')
    .all(groupId) as GameRow[];
  const gameById = new Map(games.map((g) => [g.id, g]));
  const now = Date.now();

  // ---------- Leaderboard, scoped to this event's matches ----------
  const matchRows = db
    .prepare('SELECT result FROM matches WHERE event_id = ? AND group_id = ?')
    .all(filterEventId, groupId) as Array<{
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
    .prepare(
      `SELECT player_id, game_id, started_at, ended_at, active_ms
       FROM play_sessions
       WHERE event_id = ? AND (group_id = ? OR (? = 1 AND group_id IS NULL))`,
    )
    .all(filterEventId, groupId, config.authMode === 'legacy' && groupId === DEFAULT_GROUP_ID ? 1 : 0) as Array<{
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
  const tournaments = getCompletedTournamentSummaries(filterEventId, groupId).map((t) => ({
    name: t.name,
    format: t.format,
    gameName: t.gameName,
    gameIcon: t.gameIcon,
    championTeamName: t.championTeamName,
    championPlayers: t.championPlayerIds.map((id) => playerById.get(id)?.name ?? 'Unbekannt'),
  }));

  // ---------- Vote rounds ----------
  const voteRoundRows = db
    .prepare(
      `SELECT vr.round, vr.mode, vr.title, vr.started_at, vr.closed_at, vr.winner_game_ids,
              COUNT(v.id) AS total_votes, COUNT(DISTINCT v.player_id) AS total_voters,
              COALESCE(SUM(v.points), 0) AS total_points
       FROM vote_rounds vr
       LEFT JOIN votes v ON v.group_id = vr.group_id AND v.round = vr.round
       WHERE vr.group_id = ? AND vr.event_id = ?
       GROUP BY vr.group_id, vr.round
       ORDER BY vr.round`,
    )
    .all(groupId, filterEventId) as Array<{
    round: number;
    mode: string;
    title: string | null;
    started_at: number;
    closed_at: number | null;
    winner_game_ids: string | null;
    total_votes: number;
    total_voters: number;
    total_points: number;
  }>;
  const voteRounds = voteRoundRows.map((round) => ({
    round: round.round,
    mode: round.mode,
    title: round.title,
    startedAt: round.started_at,
    closedAt: round.closed_at,
    totalVoters: round.total_voters,
    totalVotes: round.total_votes,
    totalPoints: round.total_points,
    winners: (round.winner_game_ids ? (JSON.parse(round.winner_game_ids) as string[]) : []).map((gameId) => ({
      gameId,
      gameName: gameById.get(gameId)?.name ?? 'Unbekannt',
    })),
  }));

  // ---------- Captain drafts ----------
  const draftRows = db
    .prepare('SELECT * FROM drafts WHERE group_id = ? AND event_id = ? ORDER BY created_at')
    .all(groupId, filterEventId) as Array<{
    id: string;
    game_id: string;
    status: string;
    captain_ids: string;
    picks: string;
    created_at: number;
  }>;
  const drafts = draftRows.map((draft) => {
    const refs = db
      .prepare(
        `SELECT player_id, player_name_snapshot
         FROM draft_player_refs WHERE draft_id = ? AND group_id = ?`,
      )
      .all(draft.id, groupId) as Array<{ player_id: string; player_name_snapshot: string }>;
    const names = new Map(refs.map((ref) => [ref.player_id, ref.player_name_snapshot]));
    const captainIds = JSON.parse(draft.captain_ids) as string[];
    const picks = JSON.parse(draft.picks) as Array<{ captainIndex: number; playerId: string }>;
    return {
      id: draft.id,
      status: draft.status,
      gameId: draft.game_id,
      gameName: gameById.get(draft.game_id)?.name ?? 'Unbekannt',
      createdAt: draft.created_at,
      teams: captainIds.map((captainId, captainIndex) => ({
        captainId,
        players: [
          captainId,
          ...picks.filter((pick) => pick.captainIndex === captainIndex).map((pick) => pick.playerId),
        ].map((playerId) => ({ playerId, playerName: names.get(playerId) ?? 'Unbekannt' })),
      })),
    };
  });

  return {
    event: { id: event.id, name: event.name, startsAt: event.starts_at, endsAt: event.ends_at },
    exportedAt: now,
    leaderboard,
    playtimeByPlayer,
    playtimeByGame,
    awards,
    tournaments,
    voteRounds,
    drafts,
  };
}

// GET /api/export - a full JSON snapshot for one event (the active one by
// default, or an explicit ?eventId=).
exportRouter.get('/', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();
  const snapshot = buildExportSnapshot(filterEventId, req.group!.id);
  if (!snapshot) return res.status(404).json({ error: 'Event nicht gefunden.' });
  res.json(snapshot);
});

function sanitizeForFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_').slice(0, 40) || 'Event';
}

// GET /api/export/pdf - the same snapshot, rendered as a designed PDF
// keepsake instead of raw JSON.
exportRouter.get('/pdf', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();
  const snapshot = buildExportSnapshot(filterEventId, req.group!.id);
  if (!snapshot) return res.status(404).json({ error: 'Event nicht gefunden.' });

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="respawn-${sanitizeForFilename(snapshot.event.name)}.pdf"`,
  );
  doc.pipe(res);
  renderExportPdf(doc, snapshot);
  doc.end();
});
