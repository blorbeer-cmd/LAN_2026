// Automatic playing awards use exactly the same inputs/rules as the classic
// leaderboard. The cache tracks domain entitlements, never account balances.
import { db, OUTSIDE_EVENTS_ID } from './db';
import { computeStandings, TOURNAMENT_PLACEMENT_POINTS } from './leaderboard';
import { readScoringInputs } from './leaderboardData';
import { readPointsSource, recordPointsEntitlements, POINTS_ACCOUNTS } from './pointsJournal';

interface PlayingAward {
  playerId: string;
  sourceKey: string;
  amount: number;
  title: string;
}

export function syncPlayingPoints(groupId: string, eventId: string): boolean {
  return db
    .transaction(() => {
      if (
        eventId === OUTSIDE_EVENTS_ID ||
        !db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId)
      )
        return false;
      const settings = db.prepare('SELECT closed_at FROM points_settings WHERE event_id = ?').get(eventId) as
        { closed_at: number | null } | undefined;
      if (settings?.closed_at != null) return false;
      const { matches, placements } = readScoringInputs(groupId, [eventId]);
      const knownPlayers = new Set(
        (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((p) => p.id),
      );
      const key = (playerId: string, sourceKey: string) => JSON.stringify([playerId, sourceKey]);
      const desired = new Map<string, PlayingAward>();
      for (const match of matches) {
        for (const standing of computeStandings([match])) {
          if (!knownPlayers.has(standing.playerId)) continue;
          const award = {
            playerId: standing.playerId,
            sourceKey: `match:${match.id}`,
            amount: standing.points,
            title: `Spiel: ${match.gameName}`.replace(/\0/g, '').slice(0, 200),
          };
          desired.set(key(award.playerId, award.sourceKey), award);
        }
      }
      for (const placement of placements) {
        const amount = TOURNAMENT_PLACEMENT_POINTS[placement.place] ?? 0;
        if (!amount) continue;
        for (const playerId of placement.playerIds) {
          if (!knownPlayers.has(playerId)) continue;
          const award = {
            playerId,
            sourceKey: `tournament:${placement.tournamentId}:placement`,
            amount,
            title: `Turnier: ${placement.tournamentName} · Platz ${placement.place}`.replace(/\0/g, '').slice(0, 200),
          };
          desired.set(key(playerId, award.sourceKey), award);
        }
      }
      const previous = db
        .prepare(
          `SELECT player_id AS playerId, source_key AS sourceKey, amount
      FROM points_playing_awards WHERE event_id = ?`,
        )
        .all(eventId) as Array<Omit<PlayingAward, 'title'>>;
      const old = new Map(previous.map((award) => [key(award.playerId, award.sourceKey), award]));
      const insertAccount = db.prepare(
        'INSERT OR IGNORE INTO points_accounts(event_id,player_id,account,created_at) VALUES (?, ?, ?, ?)',
      );
      const remember =
        db.prepare(`INSERT INTO points_playing_awards(event_id,player_id,source_key,amount) VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id,player_id,source_key) DO UPDATE SET amount = excluded.amount`);
      let changed = false;
      for (const id of new Set([...desired.keys(), ...old.keys()])) {
        const next = desired.get(id);
        const last = old.get(id);
        const amount = next?.amount ?? 0;
        // Do not undo manual corrections merely because a different result was
        // saved, a name changed, a read occurred, or the server restarted.
        if (last && last.amount === amount) continue;
        const playerId = next?.playerId ?? last!.playerId;
        const sourceKey = next?.sourceKey ?? last!.sourceKey;
        // Historical documented players keep their earned claims after leaving
        // the roster. This does not set the ranking participant basis or bankroll.
        for (const account of POINTS_ACCOUNTS) insertAccount.run(eventId, playerId, account, Date.now());
        const source = { groupId, eventId, playerId, account: 'playing' as const, sourceKey };
        const current = readPointsSource(source)!;
        if (last || current.revision === 0) {
          const title =
            next?.title ??
            (
              db
                .prepare(
                  `SELECT j.title FROM points_journal j JOIN points_sources s ON s.id = j.source_id
          WHERE s.event_id = ? AND s.player_id = ? AND s.account = 'playing' AND s.source_key = ? ORDER BY j.revision DESC LIMIT 1`,
                )
                .get(eventId, playerId, sourceKey) as { title: string } | undefined
            )?.title ??
            'Spielwertung';
          const result = recordPointsEntitlements([
            {
              ...source,
              total: amount,
              expectedRevision: current.revision,
              title,
              reason:
                current.revision === 0
                  ? undefined
                  : amount === 0
                    ? 'Spielergebnis oder Turnierplatzierung entfernt'
                    : 'Spielergebnis oder Turnierplatzierung neu berechnet',
            },
          ])[0];
          changed ||= result.changed;
        }
        // Existing journal claims on initial adoption are retained. From this
        // baseline onward a changed domain amount replaces the prior claim.
        remember.run(eventId, playerId, sourceKey, amount);
      }
      return changed;
    })
    .immediate();
}

export function backfillPlayingPoints(): void {
  const events = db
    .prepare(`SELECT id, group_id FROM events WHERE group_id IS NOT NULL AND id != ?`)
    .all(OUTSIDE_EVENTS_ID) as Array<{ id: string; group_id: string }>;
  for (const event of events) {
    try {
      syncPlayingPoints(event.group_id, event.id);
    } catch (error) {
      // A broken historical event must not prevent the rest of a LAN starting.
      console.error(`Playing points could not be synchronized for event ${event.id}:`, error);
    }
  }
}
