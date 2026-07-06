// "What's next?" voting (FR-19..21). State (current round, open/closed) lives
// in the small app_state key/value table so we don't need a dedicated table
// just for a single flag + counter. "Zuletzt gespielt" / play counts (FR-20)
// are derived from the matches table (actual recorded results), not from vote
// outcomes, since a vote winner isn't guaranteed to actually get played.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, getState, setState } from '../db';
import { broadcast, Events } from '../realtime';

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
  setState(ROUND_KEY, String(nextRound));
  setState(OPEN_KEY, '1');
  setState(STARTED_AT_KEY, String(Date.now()));

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);
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
    `INSERT INTO votes (id, player_id, game_id, round, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(player_id, round) DO UPDATE SET game_id = excluded.game_id, created_at = excluded.created_at`
  ).run(nanoid(), playerId, gameId, state.round, Date.now());

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
  setState(OPEN_KEY, '0');

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);
  res.json(payload);
});
