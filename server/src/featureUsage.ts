// Bestandsdaten-Auswertung (docs/KONZEPT-FEATURE-NUTZUNGSANALYSE.md, Baustein A):
// derives feature usage directly from the existing fachliche tables instead of
// dedicated telemetry. No new schema beyond this file's own queries — every
// number here is already produced by normal app usage.
//
// Every entry aggregates across the whole group by default; passing an
// eventId narrows entries whose table carries a NOT NULL event_id to that one
// event. Tables without a usable event scope (preferences, push_subscriptions)
// or with a nullable one (checklist_tasks) are marked eventScoped: false so
// the admin UI can say so instead of implying a narrower view than it gives.

import { db } from './db';

export interface FeatureUsageEntry {
  key: string;
  label: string;
  area: 'Wettkampf' | 'Orga' | 'Sonstiges';
  players: number;
  total: number;
  detail?: string;
  eventScoped: boolean;
}

export interface FeatureUsageReport {
  groupId: string;
  eventId: string | null;
  rosterSize: number;
  entries: FeatureUsageEntry[];
}

// A match's `result` column is `{ teams: [{ playerIds }], winnerTeamIndex }`
// (see routes/matches.ts). Kept as a pure function so it's testable without a
// database.
export function distinctPlayersFromMatchResults(results: string[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of results) {
    try {
      const parsed = JSON.parse(raw) as { teams?: Array<{ playerIds?: unknown }> };
      for (const team of parsed.teams ?? []) {
        if (!Array.isArray(team.playerIds)) continue;
        for (const id of team.playerIds) if (typeof id === 'string') ids.add(id);
      }
    } catch {
      // A malformed row is skipped rather than failing the whole report.
    }
  }
  return ids;
}

// `tournament_teams.player_ids` is a plain JSON array of player ids.
export function distinctPlayersFromTeamRosters(playerIdsJson: string[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of playerIdsJson) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const id of parsed) if (typeof id === 'string') ids.add(id);
    } catch {
      // A malformed row is skipped rather than failing the whole report.
    }
  }
  return ids;
}

// Admin-seeded fixtures (server/src/testUsers.ts) write directly into
// preferences, play_sessions and event_tracking_consents, and a "Testsitzung
// öffnen" login can produce further rows in any of these tables through
// normal UI use. None of that is real usage, so every player-attributed
// query below excludes it the same way currentRosterSize() already does.
const NOT_TEST_PLAYER = 'NOT IN (SELECT id FROM players WHERE is_test = 1)';

function currentRosterSize(groupId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id AND gm.group_id = ? AND gm.status = 'active'
       WHERE p.deactivated_at IS NULL AND p.is_test = 0`,
    )
    .get(groupId) as { n: number };
  return row.n;
}

export function computeFeatureUsage(groupId: string, eventId: string | null): FeatureUsageReport {
  const entries: FeatureUsageEntry[] = [];
  const evParam = eventId ? [eventId] : [];
  const evClause = eventId ? 'AND event_id = ?' : '';
  const testIds = new Set(
    (db.prepare('SELECT id FROM players WHERE is_test = 1').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const excludingTestPlayers = (ids: Set<string>): Set<string> => {
    if (testIds.size === 0) return ids;
    const filtered = new Set<string>();
    for (const id of ids) if (!testIds.has(id)) filtered.add(id);
    return filtered;
  };

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT player_id) AS players, COUNT(*) AS total, COUNT(DISTINCT round) AS rounds
         FROM votes WHERE group_id = ? AND player_id ${NOT_TEST_PLAYER} ${evClause}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number; rounds: number };
    entries.push({
      key: 'votes',
      label: 'Abstimmung',
      area: 'Wettkampf',
      players: row.players,
      total: row.total,
      detail: `${row.rounds} Runde(n)`,
      eventScoped: true,
    });
  }

  {
    const rows = db
      .prepare(`SELECT result FROM matches WHERE group_id = ? ${evClause}`)
      .all(groupId, ...evParam) as Array<{ result: string }>;
    const players = excludingTestPlayers(distinctPlayersFromMatchResults(rows.map((r) => r.result)));
    entries.push({
      key: 'matches',
      label: 'Matchmaking-Ergebnisse',
      area: 'Wettkampf',
      players: players.size,
      total: rows.length,
      eventScoped: true,
    });
  }

  {
    const tournamentRows = db
      .prepare(`SELECT id FROM tournaments WHERE group_id = ? ${evClause}`)
      .all(groupId, ...evParam) as Array<{ id: string }>;
    const teamRows = db
      .prepare(
        `SELECT tt.player_ids AS playerIds FROM tournament_teams tt
         JOIN tournaments t ON t.id = tt.tournament_id
         WHERE t.group_id = ? ${eventId ? 'AND t.event_id = ?' : ''}`,
      )
      .all(groupId, ...evParam) as Array<{ playerIds: string }>;
    const players = excludingTestPlayers(distinctPlayersFromTeamRosters(teamRows.map((r) => r.playerIds)));
    entries.push({
      key: 'tournaments',
      label: 'Turniere',
      area: 'Wettkampf',
      players: players.size,
      total: tournamentRows.length,
      eventScoped: true,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT assignee_id) AS players, COUNT(*) AS total
         FROM checklist_tasks WHERE group_id = ? AND type = 'todo' AND status = 'done'
           AND assignee_id ${NOT_TEST_PLAYER} ${evClause}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number };
    entries.push({
      key: 'checklist_tasks',
      label: 'To-Dos abgeschlossen',
      area: 'Orga',
      players: row.players,
      total: row.total,
      // event_id is nullable here (the group's permanent room) — an explicit
      // eventId filter would silently drop those rows, so this is not a
      // clean per-event narrowing the way the NOT NULL tables above are.
      eventScoped: false,
    });
  }

  {
    const orderRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM food_orders fo
         JOIN events e ON e.id = fo.event_id
         WHERE e.group_id = ? ${eventId ? 'AND fo.event_id = ?' : ''}`,
      )
      .get(groupId, ...evParam) as { n: number };
    const itemRow = db
      .prepare(
        `SELECT COUNT(DISTINCT foi.player_id) AS players, COUNT(*) AS total
         FROM food_order_items foi
         JOIN food_orders fo ON fo.id = foi.order_id
         JOIN events e ON e.id = fo.event_id
         WHERE e.group_id = ? AND foi.player_id ${NOT_TEST_PLAYER} ${eventId ? 'AND fo.event_id = ?' : ''}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number };
    entries.push({
      key: 'food_orders',
      label: 'Essensbestellungen',
      area: 'Orga',
      players: itemRow.players,
      total: itemRow.total,
      detail: `${orderRow.n} Bestellung(en)`,
      eventScoped: true,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT a.player_id) AS players, COUNT(*) AS total
         FROM arrivals a JOIN events e ON e.id = a.event_id
         WHERE e.group_id = ? AND a.player_id ${NOT_TEST_PLAYER} ${eventId ? 'AND a.event_id = ?' : ''}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number };
    entries.push({
      key: 'arrivals',
      label: 'An-/Abreise eingetragen',
      area: 'Orga',
      players: row.players,
      total: row.total,
      eventScoped: true,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT cm.player_id) AS players, COUNT(DISTINCT c.id) AS total
         FROM carpool_members cm
         JOIN carpools c ON c.id = cm.carpool_id
         JOIN events e ON e.id = c.event_id
         WHERE e.group_id = ? AND cm.player_id ${NOT_TEST_PLAYER} ${eventId ? 'AND c.event_id = ?' : ''}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number };
    entries.push({
      key: 'carpools',
      label: 'Mitfahrgelegenheiten genutzt',
      area: 'Orga',
      players: row.players,
      total: row.total,
      eventScoped: true,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT player_id) AS players, COUNT(*) AS total
         FROM preferences WHERE group_id = ? AND player_id ${NOT_TEST_PLAYER}`,
      )
      .get(groupId) as { players: number; total: number };
    entries.push({
      key: 'preferences',
      label: 'Bock-Bewertungen',
      area: 'Sonstiges',
      players: row.players,
      total: row.total,
      eventScoped: false,
    });
  }

  {
    const granted = db
      .prepare(
        `SELECT COUNT(DISTINCT player_id) AS n FROM event_tracking_consents
         WHERE group_id = ? AND revoked_at IS NULL AND player_id ${NOT_TEST_PLAYER} ${evClause}`,
      )
      .get(groupId, ...evParam) as { n: number };
    const everGranted = db
      .prepare(
        `SELECT COUNT(DISTINCT player_id) AS n FROM event_tracking_consents
         WHERE group_id = ? AND player_id ${NOT_TEST_PLAYER} ${evClause}`,
      )
      .get(groupId, ...evParam) as { n: number };
    entries.push({
      key: 'tracking_consent',
      label: 'Tracking-Einwilligung',
      area: 'Sonstiges',
      players: granted.n,
      total: everGranted.n,
      detail: `${everGranted.n} je zugestimmt, ${granted.n} aktuell aktiv`,
      eventScoped: true,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT player_id) AS players, COUNT(*) AS total, COALESCE(SUM(active_ms), 0) AS activeMs
         FROM play_sessions WHERE group_id = ? AND player_id ${NOT_TEST_PLAYER} ${evClause}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number; activeMs: number };
    entries.push({
      key: 'play_sessions',
      label: 'Spielzeit-Tracking (erfasste Sessions)',
      area: 'Sonstiges',
      players: row.players,
      total: row.total,
      detail: `${Math.round(row.activeMs / 60_000)} Min. aktiv erfasst`,
      eventScoped: true,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT ps.player_id) AS players, COUNT(*) AS total
         FROM push_subscriptions ps
         JOIN group_memberships gm ON gm.player_id = ps.player_id AND gm.group_id = ? AND gm.status = 'active'
         WHERE ps.player_id ${NOT_TEST_PLAYER}`,
      )
      .get(groupId) as { players: number; total: number };
    entries.push({
      key: 'push_subscriptions',
      label: 'Push aktiviert',
      area: 'Sonstiges',
      players: row.players,
      total: row.total,
      eventScoped: false,
    });
  }

  {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT mr.requested_by) AS players, COUNT(*) AS total
         FROM music_requests mr JOIN music_sessions ms ON ms.id = mr.session_id
         WHERE ms.group_id = ? AND mr.requested_by ${NOT_TEST_PLAYER} ${eventId ? 'AND ms.event_id = ?' : ''}`,
      )
      .get(groupId, ...evParam) as { players: number; total: number };
    entries.push({
      key: 'music_requests',
      label: 'Musikwünsche',
      area: 'Sonstiges',
      players: row.players,
      total: row.total,
      eventScoped: true,
    });
  }

  return { groupId, eventId, rosterSize: currentRosterSize(groupId), entries };
}
