// Captain draft (the social alternative to auto-balanced matchmaking): 2-4
// captains take turns picking players from a shared pool, live on every
// device via the draft:changed socket event. Exactly one draft per group can
// run at a time — the same group-local model as a vote round, and the same
// race-safety concern: several phones can try to start/pick at once, so
// every mutation re-checks the current state and answers 409 to the loser.
//
// Pick order is a snake (A B B A A B ... for 2 captains): the captain who
// picks last in a round picks first in the next, which keeps teams fair
// without any skill math — fairness through order instead of ratings.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID } from '../db';
import { broadcast, Events } from '../realtime';
import { notifyPlayers, resolvePushTopic } from '../push';
import { withBodyPlayerIdentity } from '../sessions';
import { trackingEventIdForGroup } from '../competitionScope';
import { OUTSIDE_EVENTS_ID } from '../events';
import { requireGroupRole } from '../groupAuthorization';
import { activeGroupPlayers, type GroupPlayerSnapshot } from '../groupPlayers';
import { config } from '../config';

export const draftRouter = Router();

const MIN_CAPTAINS = 2;
const MAX_CAPTAINS = 4;

interface DraftRow {
  id: string;
  group_id: string;
  event_id: string | null;
  game_id: string;
  status: 'active' | 'completed' | 'cancelled';
  captain_ids: string;
  pool_ids: string;
  picks: string;
  created_at: number;
}

interface Pick {
  captainIndex: number;
  playerId: string;
  pickedAt: number;
}

// Snake order: for pick number n (0-based) with c captains, rounds alternate
// direction — round 0 goes 0..c-1, round 1 goes c-1..0, and so on.
export function snakeCaptainIndex(pickNumber: number, captainCount: number): number {
  const round = Math.floor(pickNumber / captainCount);
  const posInRound = pickNumber % captainCount;
  return round % 2 === 0 ? posInRound : captainCount - 1 - posInRound;
}

function currentDraftRow(groupId: string): DraftRow | undefined {
  return db
    .prepare("SELECT * FROM drafts WHERE group_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get(groupId) as DraftRow | undefined;
}

// The latest draft regardless of status, so a just-finished draft's teams
// stay on everyone's screen until the next one starts (or it's dismissed by
// simply starting something else).
function latestDraftRow(groupId: string): DraftRow | undefined {
  return db.prepare('SELECT * FROM drafts WHERE group_id = ? ORDER BY created_at DESC LIMIT 1').get(groupId) as
    DraftRow | undefined;
}

function resolvePlayers(row: DraftRow, ids: string[]): Map<string, GroupPlayerSnapshot> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT player_id AS id, player_name_snapshot AS name, player_color_snapshot AS color,
              player_avatar_snapshot AS avatar
       FROM draft_player_refs
       WHERE draft_id = ? AND group_id = ? AND player_id IN (${placeholders})`,
    )
    .all(row.id, row.group_id, ...ids) as GroupPlayerSnapshot[];
  return new Map(rows.map((p) => [p.id, p]));
}

// Full state payload shared by GET and every socket broadcast: captains,
// remaining pool, teams-so-far, and whose turn it is — everything a client
// needs to render the live board without further requests.
function buildState(row: DraftRow | undefined) {
  if (!row) return { draft: null };

  const captainIds = JSON.parse(row.captain_ids) as string[];
  const poolIds = JSON.parse(row.pool_ids) as string[];
  const picks = JSON.parse(row.picks) as Pick[];

  const game = db
    .prepare('SELECT id, name, icon FROM games WHERE id = ? AND group_id = ?')
    .get(row.game_id, row.group_id) as { id: string; name: string; icon: string } | undefined;

  const allIds = [...captainIds, ...poolIds, ...picks.map((p) => p.playerId)];
  const playersById = resolvePlayers(row, allIds);
  const toPublic = (id: string) => playersById.get(id) ?? { id, name: '?', color: '#666', avatar: null };

  const teams = captainIds.map((captainId, i) => ({
    captain: toPublic(captainId),
    players: [toPublic(captainId), ...picks.filter((p) => p.captainIndex === i).map((p) => toPublic(p.playerId))],
  }));

  const turnCaptainIndex =
    row.status === 'active' && poolIds.length > 0 ? snakeCaptainIndex(picks.length, captainIds.length) : null;

  return {
    draft: {
      id: row.id,
      groupId: row.group_id,
      eventId: row.event_id,
      status: row.status,
      gameId: row.game_id,
      gameName: game?.name ?? '?',
      gameIcon: game?.icon ?? '🎮',
      teams,
      pool: poolIds.map(toPublic),
      pickCount: picks.length,
      turnCaptainIndex,
      turnCaptainId: turnCaptainIndex !== null ? captainIds[turnCaptainIndex] : null,
      createdAt: row.created_at,
    },
  };
}

// GET /api/draft/history - group-local draft list for the selected event or
// group room. This is REST-only in 5c; socket delivery remains unchanged.
draftRouter.get('/history', (req, res) => {
  const { eventId, limit } = req.query;
  const trackingEventId = trackingEventIdForGroup(req.group!.id);
  const filterEventId =
    typeof eventId === 'string' && eventId
      ? eventId === OUTSIDE_EVENTS_ID
        ? null
        : eventId
      : trackingEventId && trackingEventId !== OUTSIDE_EVENTS_ID
        ? trackingEventId
        : null;
  const limitNum = Math.min(50, Math.max(1, parseInt(typeof limit === 'string' ? limit : '', 10) || 20));
  const eventClause = filterEventId === null ? 'event_id IS NULL' : 'event_id = ?';
  const params: Array<string | number> = [req.group!.id];
  if (filterEventId !== null) params.push(filterEventId);
  params.push(limitNum);
  const rows = db
    .prepare(`SELECT * FROM drafts WHERE group_id = ? AND ${eventClause} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as DraftRow[];
  res.json({ history: rows.map((row) => buildState(row).draft) });
});

// GET /api/draft - the latest draft (active or just finished), or null.
draftRouter.get('/', (req, res) => {
  res.json(buildState(latestDraftRow(req.group!.id)));
});

// POST /api/draft/start - body: { gameId, captainIds: [..], poolPlayerIds: [..] }
draftRouter.post('/start', requireGroupRole('admin'), (req, res) => {
  const groupId = req.group!.id;
  const { gameId, captainIds, poolPlayerIds } = req.body ?? {};

  if (typeof gameId !== 'string' || !gameId) {
    return res.status(400).json({ error: 'gameId ist erforderlich.' });
  }
  if (
    !Array.isArray(captainIds) ||
    captainIds.length < MIN_CAPTAINS ||
    captainIds.length > MAX_CAPTAINS ||
    !captainIds.every((c) => typeof c === 'string' && c)
  ) {
    return res.status(400).json({ error: `Es braucht ${MIN_CAPTAINS} bis ${MAX_CAPTAINS} Captains.` });
  }
  if (!Array.isArray(poolPlayerIds) || !poolPlayerIds.every((p) => typeof p === 'string' && p)) {
    return res.status(400).json({ error: 'poolPlayerIds muss eine Liste von Spieler-IDs sein.' });
  }
  if (poolPlayerIds.length < 1) {
    return res.status(400).json({ error: 'Der Pool braucht mindestens einen Spieler zum Picken.' });
  }
  const allIds = [...captainIds, ...poolPlayerIds];
  if (new Set(allIds).size !== allIds.length) {
    return res.status(400).json({ error: 'Ein Spieler kann nicht doppelt teilnehmen (Captain und Pool).' });
  }

  const game = db.prepare('SELECT id, name FROM games WHERE id = ? AND group_id = ?').get(gameId, groupId) as
    { id: string; name: string } | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const known = activeGroupPlayers(groupId, allIds);
  if (known.size !== allIds.length) {
    return res.status(404).json({ error: 'Mindestens ein Spieler wurde nicht gefunden.' });
  }

  // The shared-state guard: everyone taps "Draft starten" at the same time,
  // exactly one may win.
  if (currentDraftRow(groupId)) {
    return res.status(409).json({ error: 'Es läuft bereits ein Draft.' });
  }

  const row: DraftRow = {
    id: nanoid(),
    group_id: groupId,
    event_id: (() => {
      const trackingEventId = trackingEventIdForGroup(groupId);
      return trackingEventId && trackingEventId !== OUTSIDE_EVENTS_ID ? trackingEventId : null;
    })(),
    game_id: gameId,
    status: 'active',
    captain_ids: JSON.stringify(captainIds),
    pool_ids: JSON.stringify(poolPlayerIds),
    picks: JSON.stringify([]),
    created_at: Date.now(),
  };
  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO drafts
         (id, group_id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.group_id,
        row.event_id,
        row.game_id,
        row.status,
        row.captain_ids,
        row.pool_ids,
        row.picks,
        row.created_at,
      );
      const insertRef = db.prepare(
        `INSERT INTO draft_player_refs
           (draft_id, group_id, player_id, role, player_name_snapshot, player_color_snapshot, player_avatar_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const playerId of captainIds) {
        const player = known.get(playerId)!;
        insertRef.run(row.id, groupId, player.id, 'captain', player.name, player.color, player.avatar);
      }
      for (const playerId of poolPlayerIds) {
        const player = known.get(playerId)!;
        insertRef.run(row.id, groupId, player.id, 'pool', player.name, player.color, player.avatar);
      }
    })();
  } catch (error) {
    if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Es läuft bereits ein Draft.' });
    }
    throw error;
  }

  const state = buildState(row);
  broadcast(Events.draftChanged, { ...state, started: true });

  // The captains need to show up and pick; everyone else gets to watch.
  notifyPlayers(
    allIds,
    {
      title: 'Captain-Draft gestartet',
      body: `${game.name}: Die Captains picken jetzt ihre Teams.`,
      url: '/#matchmaking',
    },
    'all',
    { key: `draft:${row.id}` },
  );

  res.status(201).json(state);
});

// POST /api/draft/pick - body: { playerId (who is picking), pickPlayerId }.
// Only the captain whose turn it is may pick, and only players still in the
// pool — both re-checked here so two captains tapping simultaneously (or one
// double-tapping) resolve to exactly one pick and a clean 409.
draftRouter.post('/pick', ...withBodyPlayerIdentity, (req, res) => {
  const groupId = req.group!.id;
  const { playerId, pickPlayerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (typeof pickPlayerId !== 'string' || !pickPlayerId) {
    return res.status(400).json({ error: 'pickPlayerId ist erforderlich.' });
  }

  const row = currentDraftRow(groupId);
  if (!row) return res.status(409).json({ error: 'Es läuft kein Draft.' });

  const captainIds = JSON.parse(row.captain_ids) as string[];
  const poolIds = JSON.parse(row.pool_ids) as string[];
  const picks = JSON.parse(row.picks) as Pick[];

  const turnIndex = snakeCaptainIndex(picks.length, captainIds.length);
  if (captainIds[turnIndex] !== playerId) {
    return res.status(409).json({ error: 'Du bist gerade nicht am Zug.' });
  }
  if (!poolIds.includes(pickPlayerId)) {
    return res.status(409).json({ error: 'Dieser Spieler ist nicht (mehr) im Pool.' });
  }
  if (activeGroupPlayers(groupId, [playerId, pickPlayerId]).size !== 2) {
    return res.status(409).json({ error: 'Draft-Spieler sind keine aktiven Gruppenmitglieder mehr.' });
  }

  const now = Date.now();
  picks.push({ captainIndex: turnIndex, playerId: pickPlayerId, pickedAt: now });
  let remaining = poolIds.filter((id) => id !== pickPlayerId);

  // A single leftover has no choice to make — auto-assign it to whoever is
  // next so the room isn't waiting for a captain to "pick" the only option.
  if (remaining.length === 1) {
    if (!activeGroupPlayers(groupId, [remaining[0]]).has(remaining[0])) {
      return res.status(409).json({ error: 'Der letzte Pool-Spieler ist kein aktives Gruppenmitglied mehr.' });
    }
    const lastIndex = snakeCaptainIndex(picks.length, captainIds.length);
    picks.push({ captainIndex: lastIndex, playerId: remaining[0], pickedAt: now });
    remaining = [];
  }

  const completed = remaining.length === 0;
  const state = buildState({
    ...row,
    pool_ids: JSON.stringify(remaining),
    picks: JSON.stringify(picks),
    status: completed ? 'completed' : 'active',
  });
  if (completed && state.draft) {
    const playerIds = state.draft.teams.flatMap((team) => team.players.map((player) => player.id));
    if (activeGroupPlayers(groupId, playerIds).size !== new Set(playerIds).size) {
      return res.status(409).json({ error: 'Draft-Spieler sind keine aktiven Gruppenmitglieder mehr.' });
    }
  }

  const update = db
    .prepare(
      `UPDATE drafts SET pool_ids = ?, picks = ?, status = ?
       WHERE id = ? AND group_id = ? AND status = 'active' AND pool_ids = ? AND picks = ?`,
    )
    .run(
      JSON.stringify(remaining),
      JSON.stringify(picks),
      completed ? 'completed' : 'active',
      row.id,
      groupId,
      row.pool_ids,
      row.picks,
    );
  if (update.changes !== 1) {
    return res.status(409).json({ error: 'Der Draft wurde zwischenzeitlich geändert.' });
  }

  // A finished draft is a set of teams like any matchmaking draw — log it
  // into the same history so Team-Historie shows drafted teams too. Ratings
  // aren't part of a draft, so they're stored as 0/absent.
  const historyEventId =
    row.event_id ?? (config.authMode === 'legacy' && groupId === DEFAULT_GROUP_ID ? OUTSIDE_EVENTS_ID : null);
  if (completed && state.draft && historyEventId !== null) {
    const teamsSnapshot = state.draft.teams.map((t) => ({
      players: t.players.map((p) => ({ ...p, rating: null })),
      totalRating: 0,
    }));
    db.prepare(
      "INSERT INTO matchmaking_draws (id, game_id, event_id, group_id, teams, seat_conflicts, seat_pairs_considered, generated_at, source) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'draft')",
    ).run(nanoid(), row.game_id, historyEventId, groupId, JSON.stringify(teamsSnapshot), now);
  }
  if (completed) resolvePushTopic(`draft:${row.id}`);

  broadcast(Events.draftChanged, { ...state, completed });
  res.json(state);
});

// POST /api/draft/cancel - abandon the running draft (group admin/owner).
draftRouter.post('/cancel', requireGroupRole('admin'), (req, res) => {
  const row = currentDraftRow(req.group!.id);
  if (!row) return res.status(409).json({ error: 'Es läuft kein Draft.' });

  db.prepare("UPDATE drafts SET status = 'cancelled' WHERE id = ? AND group_id = ?").run(row.id, req.group!.id);
  resolvePushTopic(`draft:${row.id}`);
  const state = buildState({ ...row, status: 'cancelled' });
  broadcast(Events.draftChanged, state);
  res.json(state);
});
