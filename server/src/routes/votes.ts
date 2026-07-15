// "What's next?" voting (FR-19..21). State (current round, open/closed,
// mode) lives in the small app_state key/value table so we don't need a
// dedicated table just for a few flags + counter. "Zuletzt gespielt" / play
// counts (FR-20) are derived from the matches table (actual recorded
// results), not from vote outcomes, since a vote winner isn't guaranteed to
// actually get played.
//
// Two modes, chosen when a round is started:
// - 'single' (default): each player picks exactly one game; changing your
//   pick replaces the previous one.
// - 'points': each player distributes 1-10 points across as many games as
//   they like (a game with 0 points is simply left out); resubmitting
//   replaces the player's whole set for the round.
// Both modes rank games by a "score" (vote count for 'single', point sum for
// 'points'); ties (including the all-zero state before anyone has voted)
// fall back to the games' aggregate "Bock" rating (preferences table) so the
// list starts out sorted by general popularity, not alphabetically.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, getState, setState } from '../db';
import { broadcast, Events } from '../realtime';
import { getTrackingEventId, OUTSIDE_EVENTS_ID } from '../events';
import { notifyPlayers, resolvePushTopic } from '../push';
import { isIntInRange } from '../validation';
import { formatDurationMs } from '../playtime';

export const votesRouter = Router();

const ROUND_KEY = 'vote_round';
const OPEN_KEY = 'vote_open';
const STARTED_AT_KEY = 'vote_started_at';
const MODE_KEY = 'vote_mode';

const MAX_TITLE_LENGTH = 80;
const MAX_INFO_LENGTH = 500;

// Same shape as games.ts's optionalText: undefined means "invalid" (caller
// should 400), null means "explicitly cleared/absent", a string means a
// validated, trimmed value.
function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : undefined;
}

export function voteNotificationPlayerIds(): string[] {
  const eventId = getTrackingEventId();
  if (eventId === OUTSIDE_EVENTS_ID) {
    return (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((player) => player.id);
  }
  return (db.prepare('SELECT player_id AS id FROM event_participants WHERE event_id = ?').all(eventId) as Array<{ id: string }>).map(
    (player) => player.id
  );
}

type VoteMode = 'single' | 'points';

interface RoundState {
  round: number;
  open: boolean;
  startedAt: number | null;
  mode: VoteMode;
}

function readRoundState(): RoundState {
  const storedMode = getState(MODE_KEY);
  return {
    round: parseInt(getState(ROUND_KEY) ?? '0', 10),
    open: getState(OPEN_KEY) === '1',
    startedAt: getState(STARTED_AT_KEY) ? parseInt(getState(STARTED_AT_KEY)!, 10) : null,
    mode: storedMode === 'points' ? 'points' : 'single',
  };
}

interface RoundMeta {
  title: string | null;
  info: string | null;
  selectedGameIds: string[] | null; // null = every game in the catalog
}

// A round's title/info/game-selection live in vote_rounds (set once on
// /start, immutable afterwards), unlike round/open/mode which are mirrored
// into app_state for cheap access — this is only read a handful of times per
// request, so a small extra query is fine.
function getRoundMeta(round: number): RoundMeta {
  if (round < 1) return { title: null, info: null, selectedGameIds: null };
  const row = db.prepare('SELECT title, info, selected_game_ids AS selectedGameIdsJson FROM vote_rounds WHERE round = ?').get(round) as
    | { title: string | null; info: string | null; selectedGameIdsJson: string | null }
    | undefined;
  if (!row) return { title: null, info: null, selectedGameIds: null };
  return {
    title: row.title,
    info: row.info,
    selectedGameIds: row.selectedGameIdsJson ? JSON.parse(row.selectedGameIdsJson) : null,
  };
}

interface ResultRow {
  gameId: string;
  gameName: string;
  icon: string;
  votes: number; // number of (player, game) rows, i.e. distinct voters for this game
  points: number; // sum of points given (0 in 'single' mode)
  score: number; // the metric this round ranks by: votes for 'single', points for 'points'
  lastPlayedAt: number | null;
  playCount: number;
  avgPreference: number | null; // aggregate "Bock" rating across all players, null if nobody has rated it
  preferenceCount: number;
  totalPlaytimeMs: number; // all-time wall-clock playtime across all players/sessions
  totalPlaytimeFormatted: string;
  voteWinCount: number; // how often this game has won a (closed) vote round, all-time
}

// How often each game has won a closed vote round, all-time — read once per
// buildResults call from vote_rounds.winner_game_ids (a small JSON array per
// row), not worth a dedicated join since round counts stay tiny at LAN scale.
function voteWinCountsByGame(): Map<string, number> {
  const rows = db
    .prepare("SELECT winner_game_ids AS winnerGameIdsJson FROM vote_rounds WHERE closed_at IS NOT NULL AND winner_game_ids IS NOT NULL")
    .all() as Array<{ winnerGameIdsJson: string }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const ids: string[] = JSON.parse(row.winnerGameIdsJson);
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// Every game in the catalog for the given round, scored and sorted — never
// filtered by a round's own selectedGameIds (see filterResults for that), so
// a single call's underlying query/sort can be reused for both the
// round-scoped view and the always-full-catalog "Bock" popularity view
// (buildPayload's `catalogResults`) instead of querying twice.
function buildAllResults(round: number, mode: VoteMode): ResultRow[] {
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT g.id AS gameId, g.name AS gameName, g.icon AS icon,
              COUNT(v.player_id) AS votes,
              COALESCE(SUM(v.points), 0) AS points,
              m.lastPlayedAt AS lastPlayedAt, COALESCE(m.playCount, 0) AS playCount,
              p.avgPreference AS avgPreference, COALESCE(p.preferenceCount, 0) AS preferenceCount,
              COALESCE(ps.totalPlaytimeMs, 0) AS totalPlaytimeMs
       FROM games g
       LEFT JOIN votes v ON v.game_id = g.id AND v.round = ?
       LEFT JOIN (
         SELECT game_id, MAX(played_at) AS lastPlayedAt, COUNT(*) AS playCount
         FROM matches GROUP BY game_id
       ) m ON m.game_id = g.id
       LEFT JOIN (
         SELECT game_id, AVG(rating) AS avgPreference, COUNT(*) AS preferenceCount
         FROM preferences GROUP BY game_id
       ) p ON p.game_id = g.id
       LEFT JOIN (
         SELECT game_id, SUM(MAX(0, COALESCE(ended_at, ?) - started_at)) AS totalPlaytimeMs
         FROM play_sessions GROUP BY game_id
       ) ps ON ps.game_id = g.id
       WHERE g.arcade_key IS NULL
       GROUP BY g.id`
    )
    .all(round, now) as Array<Omit<ResultRow, 'score' | 'totalPlaytimeFormatted' | 'voteWinCount'>>;

  const winCounts = voteWinCountsByGame();
  const results: ResultRow[] = rows.map((r) => ({
    ...r,
    score: mode === 'points' ? r.points : r.votes,
    totalPlaytimeFormatted: formatDurationMs(r.totalPlaytimeMs),
    voteWinCount: winCounts.get(r.gameId) ?? 0,
  }));

  // Sort by this round's score first, then by aggregate popularity (so the
  // list starts out popularity-sorted before anyone has voted), then name.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aPref = a.avgPreference ?? -1;
    const bPref = b.avgPreference ?? -1;
    if (bPref !== aPref) return bPref - aPref;
    return a.gameName.localeCompare(b.gameName, 'de');
  });
  return results;
}

function filterResults(results: ResultRow[], selectedGameIds: string[] | null): ResultRow[] {
  if (!selectedGameIds) return results;
  const allowed = new Set(selectedGameIds);
  return results.filter((r) => allowed.has(r.gameId));
}

function buildResults(round: number, mode: VoteMode, selectedGameIds: string[] | null = null): ResultRow[] {
  return filterResults(buildAllResults(round, mode), selectedGameIds);
}

// While a round is open, nobody — not even the person about to close it —
// sees how votes/points are distributed across games yet: only the final
// picture, once closed, should influence anyone (no bandwagoning towards
// whatever's currently ahead). Total participation (how many people/points
// have been cast so far) is still shown — that's not a per-game distribution
// and is a useful "is it worth waiting a bit longer" signal — but each
// game's own votes/points/score are stripped, and the list is re-sorted by
// long-term "Bock" popularity only, since the current round's own ranking
// would otherwise leak through the ordering even without the numbers.
function redactOpenRoundResults(results: ResultRow[]): Array<Omit<ResultRow, 'votes' | 'points' | 'score'>> {
  const sorted = [...results].sort((a, b) => {
    const aPref = a.avgPreference ?? -1;
    const bPref = b.avgPreference ?? -1;
    if (bPref !== aPref) return bPref - aPref;
    return a.gameName.localeCompare(b.gameName, 'de');
  });
  return sorted.map(({ votes: _votes, points: _points, score: _score, ...rest }) => rest);
}

function buildPayload(extra: Record<string, unknown> = {}) {
  const state = readRoundState();
  const meta = getRoundMeta(state.round);
  // One query (buildAllResults) backs both views: the round-scoped
  // `results` (filtered to this round's own game selection, if any) and the
  // always-full-catalog `catalogResults` behind the "Top 5 nach Bock-Level"
  // widget. That widget must never stay hidden behind a past round's "Nur
  // bestimmte Spiele zur Wahl stellen" restriction, but recomputing the same
  // SQL join a second time just to drop that restriction would be redundant
  // — filtering the already-fetched rows in JS is enough.
  const catalogFullResults = buildAllResults(state.round, state.mode);
  const fullResults = filterResults(catalogFullResults, meta.selectedGameIds);
  const totalVotes = fullResults.reduce((sum, r) => sum + r.votes, 0);
  const totalPoints = fullResults.reduce((sum, r) => sum + r.points, 0);
  const totalVoters = (
    db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM votes WHERE round = ?').get(state.round) as {
      n: number;
    }
  ).n;
  const results = state.open ? redactOpenRoundResults(fullResults) : fullResults;
  const catalogResults = state.open ? redactOpenRoundResults(catalogFullResults) : catalogFullResults;
  return { ...state, ...meta, results, catalogResults, totalVotes, totalPoints, totalVoters, ...extra };
}

// GET /api/votes - current round's state and tally.
votesRouter.get('/', (_req, res) => {
  res.json(buildPayload());
});

// GET /api/votes/mine?playerId= - the given player's own entries in the
// current round, so the frontend can prefill/highlight their picks (mainly
// needed for 'points' mode's multi-select UI, which can't be reconstructed
// from the aggregated results alone).
votesRouter.get('/mine', (req, res) => {
  const { playerId } = req.query;
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const state = readRoundState();
  const entries = db
    .prepare('SELECT game_id AS gameId, points FROM votes WHERE player_id = ? AND round = ?')
    .all(playerId, state.round) as Array<{ gameId: string; points: number | null }>;
  res.json({ round: state.round, mode: state.mode, entries });
});

// POST /api/votes/start - begins a new round. Fails if one is already open.
// Body: { mode?, title?, info?, gameIds? }
// - mode: 'points' (default, the normal voting mode) or 'single' — 'single'
//   is only meant for a runoff between tied winners (see /close), it's not
//   offered as a choice when starting a fresh round.
// - title/info: optional free text shown to voters.
// - gameIds: optional preselection of which games this round covers; omit
//   for "every game in the catalog".
votesRouter.post('/start', (req, res) => {
  const state = readRoundState();
  if (state.open) {
    return res.status(409).json({ error: 'Es läuft bereits eine Abstimmung.' });
  }

  const { mode, title, info, gameIds } = req.body ?? {};
  if (mode !== undefined && mode !== 'single' && mode !== 'points') {
    return res.status(400).json({ error: 'mode muss "single" oder "points" sein.' });
  }
  const nextMode: VoteMode = mode === 'single' ? 'single' : 'points';

  const cleanTitle = optionalText(title, MAX_TITLE_LENGTH);
  if (cleanTitle === undefined) {
    return res.status(400).json({ error: `Titel darf höchstens ${MAX_TITLE_LENGTH} Zeichen lang sein.` });
  }
  const cleanInfo = optionalText(info, MAX_INFO_LENGTH);
  if (cleanInfo === undefined) {
    return res.status(400).json({ error: `Info darf höchstens ${MAX_INFO_LENGTH} Zeichen lang sein.` });
  }

  let selectedGameIds: string[] | null = null;
  if (gameIds !== undefined) {
    if (!Array.isArray(gameIds) || gameIds.length === 0) {
      return res.status(400).json({ error: 'Mindestens ein Spiel muss ausgewählt sein.' });
    }
    const uniqueIds = [...new Set(gameIds)];
    for (const id of uniqueIds) {
      if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Ungültige gameId.' });
      const game = db.prepare('SELECT id FROM games WHERE id = ?').get(id);
      if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
    }
    selectedGameIds = uniqueIds as string[];
  }

  const nextRound = state.round + 1;
  const now = Date.now();
  setState(ROUND_KEY, String(nextRound));
  setState(OPEN_KEY, '1');
  setState(STARTED_AT_KEY, String(now));
  setState(MODE_KEY, nextMode);

  db.prepare(
    'INSERT INTO vote_rounds (round, event_id, started_at, closed_at, winner_game_ids, mode, title, info, selected_game_ids) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)'
  ).run(nextRound, getTrackingEventId(), now, nextMode, cleanTitle, cleanInfo, selectedGameIds ? JSON.stringify(selectedGameIds) : null);

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);

  notifyPlayers(
    voteNotificationPlayerIds(),
    {
      title: cleanTitle || 'Neue Abstimmung',
      body:
        nextMode === 'single'
          ? 'Stichwahl: jetzt für einen der Gewinner abstimmen.'
          : 'Was zocken wir als Nächstes? Spiele mit Punkten bewerten.',
      url: '/#votes',
    },
    'all',
    { key: `vote:${nextRound}` }
  );

  res.status(201).json(payload);
});

// POST /api/votes - cast or change a vote in the current round ('single' mode only).
// Body: { playerId, gameId }
votesRouter.post('/', (req, res) => {
  const state = readRoundState();
  if (!state.open) {
    return res.status(409).json({ error: 'Es läuft keine Abstimmung.' });
  }
  if (state.mode !== 'single') {
    return res.status(409).json({ error: 'Die aktuelle Abstimmung läuft im Punkte-Modus.' });
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
  const meta = getRoundMeta(state.round);
  if (meta.selectedGameIds && !meta.selectedGameIds.includes(gameId)) {
    return res.status(400).json({ error: 'Dieses Spiel ist in dieser Abstimmung nicht auswählbar.' });
  }

  const castVote = db.transaction(() => {
    db.prepare('DELETE FROM votes WHERE player_id = ? AND round = ?').run(playerId, state.round);
    db.prepare(
      'INSERT INTO votes (id, player_id, game_id, event_id, round, points, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
    ).run(nanoid(), playerId, gameId, getTrackingEventId(), state.round, Date.now());
  });
  castVote();

  const payload = buildPayload();
  broadcast(Events.votesChanged, payload);
  res.json(payload);
});

// POST /api/votes/points - cast or replace a player's points in the current
// round ('points' mode only). Body: { playerId, entries: [{ gameId, points }] },
// any number of distinct games (including none, to clear your points
// entirely), 1-10 points each. Resubmitting replaces the player's whole
// previous set so they can change their mind any time.
votesRouter.post('/points', (req, res) => {
  const state = readRoundState();
  if (!state.open) {
    return res.status(409).json({ error: 'Es läuft keine Abstimmung.' });
  }
  if (state.mode !== 'points') {
    return res.status(409).json({ error: 'Die aktuelle Abstimmung läuft im Einzel-Modus.' });
  }

  const { playerId, entries } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries muss ein Array sein.' });
  }

  const meta = getRoundMeta(state.round);
  const seen = new Set<string>();
  const clean: Array<{ gameId: string; points: number }> = [];
  for (const entry of entries) {
    const { gameId, points } = (entry ?? {}) as { gameId?: unknown; points?: unknown };
    if (typeof gameId !== 'string' || !gameId) {
      return res.status(400).json({ error: 'Jeder Eintrag braucht eine gameId.' });
    }
    if (seen.has(gameId)) {
      return res.status(400).json({ error: 'Jedes Spiel darf nur einmal bewertet werden.' });
    }
    seen.add(gameId);
    if (!isIntInRange(points, 1, 10)) {
      return res.status(400).json({ error: 'Punkte müssen eine Ganzzahl zwischen 1 und 10 sein.' });
    }
    const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
    if (meta.selectedGameIds && !meta.selectedGameIds.includes(gameId)) {
      return res.status(400).json({ error: 'Dieses Spiel ist in dieser Abstimmung nicht auswählbar.' });
    }
    clean.push({ gameId, points });
  }

  const now = Date.now();
  const eventId = getTrackingEventId();
  const castPoints = db.transaction(() => {
    db.prepare('DELETE FROM votes WHERE player_id = ? AND round = ?').run(playerId, state.round);
    const insert = db.prepare(
      'INSERT INTO votes (id, player_id, game_id, event_id, round, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const entry of clean) {
      insert.run(nanoid(), playerId, entry.gameId, eventId, state.round, entry.points, now);
    }
  });
  castPoints();

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

  const meta = getRoundMeta(state.round);
  const results = buildResults(state.round, state.mode, meta.selectedGameIds);
  const topScore = results[0]?.score ?? 0;
  const winnerGameIds = topScore > 0 ? results.filter((r) => r.score === topScore).map((r) => r.gameId) : [];

  db.prepare('UPDATE vote_rounds SET closed_at = ?, winner_game_ids = ? WHERE round = ?').run(
    Date.now(),
    JSON.stringify(winnerGameIds),
    state.round
  );
  resolvePushTopic(`vote:${state.round}`);

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
  resolvePushTopic(`vote:${state.round}`);

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
  mode: VoteMode;
  winnerGameIdsJson: string | null;
  title: string | null;
  info: string | null;
  selectedGameIdsJson: string | null;
}

// GET /api/votes/history - past (closed) rounds for the active event, newest
// first: when it happened, how many votes were cast, and who won. Rounds
// nobody voted in still show up (with an empty winners list) since they come
// from vote_rounds, not from the votes table itself.
votesRouter.get('/history', (req, res) => {
  const { eventId, limit } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();
  const limitNum = Math.min(50, Math.max(1, parseInt(typeof limit === 'string' ? limit : '', 10) || 20));

  const rows = db
    .prepare(
      `SELECT vr.round AS round, vr.event_id AS eventId, e.name AS eventName,
              vr.started_at AS startedAt, vr.closed_at AS closedAt, vr.mode AS mode,
              vr.winner_game_ids AS winnerGameIdsJson, vr.title AS title, vr.info AS info,
              vr.selected_game_ids AS selectedGameIdsJson
       FROM vote_rounds vr
       JOIN events e ON e.id = vr.event_id
       WHERE vr.closed_at IS NOT NULL AND vr.event_id = ?
       ORDER BY vr.round DESC
       LIMIT ?`
    )
    .all(filterEventId, limitNum) as VoteRoundRow[];

  const history = rows.map((r) => {
    const winnerIds: string[] = r.winnerGameIdsJson ? JSON.parse(r.winnerGameIdsJson) : [];
    const selectedGameIds: string[] | null = r.selectedGameIdsJson ? JSON.parse(r.selectedGameIdsJson) : null;
    const results = buildResults(r.round, r.mode, selectedGameIds);
    const totalVotes = results.reduce((sum, x) => sum + x.votes, 0);
    const winners = results
      .filter((x) => winnerIds.includes(x.gameId))
      .map((x) => ({ gameId: x.gameId, gameName: x.gameName, icon: x.icon, votes: x.votes, points: x.points }));
    return {
      round: r.round,
      eventId: r.eventId,
      eventName: r.eventName,
      startedAt: r.startedAt,
      closedAt: r.closedAt,
      mode: r.mode,
      title: r.title,
      info: r.info,
      totalVotes,
      winners,
    };
  });

  res.json({ history });
});

// GET /api/votes/history/:round - full per-game breakdown for one past
// (closed) round, so a round can be reopened from the history list to
// inspect exactly how the points/votes ended up distributed — the detail
// nobody got to see while it was still running.
votesRouter.get('/history/:round', (req, res) => {
  const round = parseInt(req.params.round, 10);
  if (!Number.isInteger(round) || round < 1) {
    return res.status(400).json({ error: 'round muss eine positive Ganzzahl sein.' });
  }

  const row = db
    .prepare(
      `SELECT vr.round AS round, vr.event_id AS eventId, e.name AS eventName,
              vr.started_at AS startedAt, vr.closed_at AS closedAt, vr.mode AS mode,
              vr.winner_game_ids AS winnerGameIdsJson, vr.title AS title, vr.info AS info,
              vr.selected_game_ids AS selectedGameIdsJson
       FROM vote_rounds vr
       JOIN events e ON e.id = vr.event_id
       WHERE vr.round = ?`
    )
    .get(round) as VoteRoundRow | undefined;
  if (!row || row.closedAt === null) {
    return res.status(404).json({ error: 'Abgeschlossene Abstimmungsrunde nicht gefunden.' });
  }

  const selectedGameIds: string[] | null = row.selectedGameIdsJson ? JSON.parse(row.selectedGameIdsJson) : null;
  const results = buildResults(row.round, row.mode, selectedGameIds);
  const totalVotes = results.reduce((sum, r) => sum + r.votes, 0);
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);
  const totalVoters = (
    db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM votes WHERE round = ?').get(row.round) as {
      n: number;
    }
  ).n;
  const winnerGameIds: string[] = row.winnerGameIdsJson ? JSON.parse(row.winnerGameIdsJson) : [];

  res.json({
    round: row.round,
    eventId: row.eventId,
    eventName: row.eventName,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    mode: row.mode,
    title: row.title,
    info: row.info,
    results,
    totalVotes,
    totalPoints,
    totalVoters,
    winnerGameIds,
  });
});
