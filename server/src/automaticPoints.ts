// Reconcile automatic domain entitlements without treating cached amounts as balances.
import { db, OUTSIDE_EVENTS_ID } from './db';
import { readPointsSource, recordPointsEntitlements, POINTS_ACCOUNTS } from './pointsJournal';
import { isResetPointsSource } from './pointsReset';

export interface AutomaticAward {
  playerId: string;
  sourceKey: string;
  amount: number;
  title: string;
}

export function syncAutomaticPoints(
  groupId: string,
  eventId: string,
  account: 'playing' | 'orga',
  deriveAwards: () => AutomaticAward[],
): boolean {
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
      const knownPlayers = new Set(
        (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((p) => p.id),
      );
      const key = (playerId: string, sourceKey: string) => JSON.stringify([playerId, sourceKey]);
      const desired = new Map(
        deriveAwards()
          .filter((award) => knownPlayers.has(award.playerId) && !isResetPointsSource(eventId, award.playerId, award.sourceKey))
          .map((award) => [
            key(award.playerId, award.sourceKey),
            {
              ...award,
              title: award.title.replace(/\0/g, '').slice(0, 200),
            },
          ]),
      );
      // SQL identifiers come exclusively from this internal account allow-list.
      const table = account === 'playing' ? 'points_playing_awards' : 'points_orga_awards';
      const previous = db
        .prepare(
          `SELECT player_id AS playerId, source_key AS sourceKey, amount
      FROM ${table} WHERE event_id = ?`,
        )
        .all(eventId) as Array<Omit<AutomaticAward, 'title'>>;
      const old = new Map(previous.map((award) => [key(award.playerId, award.sourceKey), award]));
      const insertAccount = db.prepare(
        'INSERT OR IGNORE INTO points_accounts(event_id,player_id,account,created_at) VALUES (?, ?, ?, ?)',
      );
      const remember = db.prepare(`INSERT INTO ${table}(event_id,player_id,source_key,amount) VALUES (?, ?, ?, ?)
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
        const source = { groupId, eventId, playerId, account, sourceKey };
        const current = readPointsSource(source)!;
        if (last || current.revision === 0) {
          const title =
            next?.title ??
            (
              db
                .prepare(
                  `SELECT j.title FROM points_journal j JOIN points_sources s ON s.id = j.source_id
          WHERE s.event_id = ? AND s.player_id = ? AND s.account = ? AND s.source_key = ? ORDER BY j.revision DESC LIMIT 1`,
                )
                .get(eventId, playerId, account, sourceKey) as { title: string } | undefined
            )?.title ??
            'Punktewertung';
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
                    ? 'Automatischer Punkteanspruch entfallen'
                    : 'Automatischer Punkteanspruch neu berechnet',
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
