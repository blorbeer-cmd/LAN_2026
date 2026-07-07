// "What's next?" voting (FR-19..21). State (current round, open/closed) lives
// in the small app_state key/value table so we don't need a dedicated table
// just for a single flag + counter. "Zuletzt gespielt" / play counts (FR-20)
// are derived from the matches table (actual recorded results), not from vote
// outcomes, since a vote winner isn't guaranteed to actually get played.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, getState, setState } from '../db';
import { broadcast, Events } from '../realtime';
import { getActiveEventId } from '../events';
import { notifyPlayers } from '../push';

export const votesRouter = Router();

const ROUND_KEY = 'vote_round';
const OPEN_KEY = 'vote_open';
const STARTED_AT_KEY = 'vote_started_at';

interface RoundState {
  round: number;
  open: boolean;
  startedAt: number | null;
}

function readRoundState(): RoundState {
  return {
    round: parseInt(getState(ROUND_KEY) ?? '0', 10),
    open: getState(OPEN_KEY) === '1',
    startedAt: getState(STARTED_AT_KEY) ? parseInt(getState(STARTED_AT_KEY)!, 10) : null,
  };
}

interface ResultRow {
  gameId: string;
  gameName: string;
  icon: string;
  votes: number;
  lastPlayedAt: number | null;
  playCount: number;
}

function buildResults(round: number): ResultRow[] {
  return db
    .prepare(
      `SELECT g.id AS gameId, g.name AS gameName, g.icon AS icon,
              COUNT(v.player_id) AS votes,
              m.lastPlayedAt AS lastPlayedAt, COALESCE(m.playCount, 0) AS playCount
       FROM games g
       LEFT JOIN votes v ON v.game_id = g.id AND v.round = ?
       LEFT JOIN (
         SELECT game_id, MAX(played_at) AS lastPlayedAt, COUNT(*) AS playCount
         FROM matches GROUP BY game_id
       ) m ON m.game_id = g.id
       GROUP BY g.id
       ORDER BY votes DESC, g.name COLLATE NOCASE`
    )
    .all(round) as ResultRow[];
}

function buildPayload(extra: Record<string, unknown> = {}) {
  const state = readRoundState();
  const results = buildResults(state.round);
  const totalVotes = results.reduce((sum, r) => sum + r.votes, 0);
  return { ...state, results, totalVotes, ...extra };
}

// GET /api/votes - current round's state and tally.
votesRouter.get('/', (_req, res) => {
  res.json(buildPayload());
});

// POST /api/votes/start - begins a new round. Fails if one is already open.
votesRouter.post('/start', (_req, res) => {
  const state = readRoundState();
  if (state.open) {
    return res.status(409).json({ error: 'Es läuft bereits eine Abstimmung.' });
  }
  const nextRound = state.round + 1;
  const now = Date.now();
  setState(ROUND_KEY, String(nextRound));
  setState(OPEN_KEY, '1');
  setState(STARTED_AT_KEY, String(now));

  db.prepare(
    'INSERT INTO vote_rounds (round, event_id, started_at, closed_at, winner_game_ids) VALUES (?, ?, ?, NULL, NULL)'
  ).run(nextRound, getActiveEventId(), now);

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);

  const allPlayerIds = (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((p) => p.id);
  notifyPlayers(allPlayerIds, {
    title: '🗳️ Neue Abstimmung',
    body: 'Was zocken wir als Nächstes? Jetzt abstimmen.',
    url: '/',
  });

  res.status(201).json(payload);
});

// POST /api/votes - cast or change a vote in the current round.
// Body: { playerId, gameId }
votesRouter.post('/', (req, res) => {
  const state = readRoundState();
  if (!state.open) {
    return res.status(409).json({ error: 'Es läuft keine Abstimmung.' });
  }

  const { playerId, gameId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId);
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  db.prepare(
    `INSERT INTO votes (id, player_id, game_id, event_id, round, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id, round) DO UPDATE SET game_id = excluded.game_id, created_at = excluded.created_at`
  ).run(nanoid(), playerId, gameId, getActiveEventId(), state.round, Date.now());

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);
  res.json(payload);
});

// POST /api/votes/close - ends the round and reports the winner(s) (ties are
// all reported so the group can decide/re-vote).
votesRouter.post('/close', (_req, res) => {
  const state = readRoundState();
  if (!state.open) {
    return res.status(409).json({ error: 'Es läuft keine Abstimmung.' });
  }
  setState(OPEN_KEY, '0');

  const results = buildResults(state.round);
  const topVotes = results[0]?.votes ?? 0;
  const winnerGameIds = topVotes > 0 ? results.filter((r) => r.votes === topVotes).map((r) => r.gameId) : [];

  db.prepare('UPDATE vote_rounds SET closed_at = ?, winner_game_ids = ? WHERE round = ?').run(
    Date.now(),
    JSON.stringify(winnerGameIds),
    state.round
  );

  const payload = buildPayload({ winnerGameIds });
  broadcast(Events.votesChanged, payload);
  res.json(payload);
});

// POST /api/votes/cancel - discards the current round entirely (e.g. started
// by mistake), with no winner. Unlike /close, the votes themselves are
// deleted so they don't linger as noise in the history.
votesRouter.post('/cancel', (_req, res) => {
  const state = readRoundState();
  if (!state.open) {
    return res.status(409).json({ error: 'Es läuft keine Abstimmung.' });
  }
  db.prepare('DELETE FROM votes WHERE round = ?').run(state.round);
  db.prepare('DELETE FROM vote_rounds WHERE round = ?').run(state.round);
  setState(OPEN_KEY, '0');

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);
  res.json(payload);
});

interface VoteRoundRow {
  round: number;
  eventId: string;
  eventName: string;
  startedAt: number;
  closedAt: number;
  winnerGameIdsJson: string | null;
}

// GET /api/votes/history - past (closed) rounds for the active event, newest
// first: when it happened, how many votes were cast, and who won. Rounds
// nobody voted in still show up (with an empty winners list) since they come
// from vote_rounds, not from the votes table itself.
votesRouter.get('/history', (req, res) => {
  const { eventId, limit } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getActiveEventId();
  const limitNum = Math.min(50, Math.max(1, parseInt(typeof limit === 'string' ? limit : '', 10) || 20));

  const rows = db
    .prepare(
      `SELECT vr.round AS round, vr.event_id AS eventId, e.name AS eventName,
              vr.started_at AS startedAt, vr.closed_at AS closedAt,
              vr.winner_game_ids AS winnerGameIdsJson
       FROM vote_rounds vr
       JOIN events e ON e.id = vr.event_id
       WHERE vr.closed_at IS NOT NULL AND vr.event_id = ?
       ORDER BY vr.round DESC
       LIMIT ?`
    )
    .all(filterEventId, limitNum) as VoteRoundRow[];

  const history = rows.map((r) => {
    const winnerIds: string[] = r.winnerGameIdsJson ? JSON.parse(r.winnerGameIdsJson) : [];
    const results = buildResults(r.round);
    const totalVotes = results.reduce((sum, x) => sum + x.votes, 0);
    const winners = results
      .filter((x) => winnerIds.includes(x.gameId))
      .map((x) => ({ gameId: x.gameId, gameName: x.gameName, icon: x.icon, votes: x.votes }));
    return {
      round: r.round,
      eventId: r.eventId,
      eventName: r.eventName,
      startedAt: r.startedAt,
      closedAt: r.closedAt,
      totalVotes,
      winners,
    };
  });

  res.json({ history });
});
