// Permanent Skill bonus eligibility is recorded once in the existing Orga
// entitlement state. Journal sums remain the only financial balances.
import { db, OUTSIDE_EVENTS_ID } from './db';
import { POINTS_ACCOUNTS, readPointsSource, recordPointsEntitlements } from './pointsJournal';
import { isResetPointsSource } from './pointsReset';

export const SKILL_BONUS_SOURCE = 'bonus:skills';
export const SKILL_BONUS_POINTS = 5;

export function grantSkillCompletionBonus(eventId: string): boolean {
  return db
    .transaction(() => {
      if (eventId === OUTSIDE_EVENTS_ID) return false;
      const event = db
        .prepare(
          `SELECT e.group_id, ps.closed_at FROM events e
      LEFT JOIN points_settings ps ON ps.event_id = e.id WHERE e.id = ?`,
        )
        .get(eventId) as { group_id: string | null; closed_at: number | null } | undefined;
      if (!event?.group_id || event.closed_at != null) return false;
      const catalogSize = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM games
      WHERE group_id = ? AND status = 'catalog' AND arcade_key IS NULL`,
          )
          .get(event.group_id) as { n: number }
      ).n;
      if (catalogSize === 0) return false;
      const eligible = db
        .prepare(
          `SELECT ep.player_id FROM event_participants ep
      WHERE ep.event_id = ? AND ep.status = 'accepted'
        AND NOT EXISTS (SELECT 1 FROM points_orga_awards a
          WHERE a.event_id = ep.event_id AND a.player_id = ep.player_id AND a.source_key = ? AND a.amount = ?)
        AND NOT EXISTS (SELECT 1 FROM games g
          WHERE g.group_id = ? AND g.status = 'catalog' AND g.arcade_key IS NULL
            AND NOT EXISTS (SELECT 1 FROM skills s WHERE s.player_id = ep.player_id
              AND s.game_id = g.id AND s.group_id = g.group_id AND s.rating BETWEEN 0 AND 5))`,
        )
        .all(eventId, SKILL_BONUS_SOURCE, SKILL_BONUS_POINTS, event.group_id) as Array<{ player_id: string }>;
      let changed = false;
      for (const { player_id: playerId } of eligible) {
        if (isResetPointsSource(eventId, playerId, SKILL_BONUS_SOURCE)) continue;
        for (const account of POINTS_ACCOUNTS)
          db.prepare(
            `INSERT OR IGNORE INTO points_accounts
        (event_id, player_id, account, created_at) VALUES (?, ?, ?, ?)`,
          ).run(eventId, playerId, account, Date.now());
        const source = {
          groupId: event.group_id,
          eventId,
          playerId,
          account: 'orga' as const,
          sourceKey: SKILL_BONUS_SOURCE,
        };
        const current = readPointsSource(source)!;
        // Initial adoption keeps an existing manually corrected journal claim,
        // exactly like the other automatic producers. A recorded bonus never
        // becomes eligible for a second payout after an administrative deduction.
        if (current.revision === 0) {
          const result = recordPointsEntitlements([
            {
              ...source,
              total: SKILL_BONUS_POINTS,
              expectedRevision: 0,
              title: `Skill-Einschätzungen vollständig (${catalogSize} Katalogspiele)`,
            },
          ])[0];
          changed ||= result.changed;
        }
        db.prepare(
          `INSERT INTO points_orga_awards(event_id,player_id,source_key,amount) VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id,player_id,source_key) DO UPDATE SET amount = excluded.amount`,
        ).run(eventId, playerId, SKILL_BONUS_SOURCE, SKILL_BONUS_POINTS);
      }
      return changed;
    })
    .immediate();
}

// Skills and catalog games are shared by the group; every confirmed event
// participation can therefore qualify independently, including future events.
export function grantGroupSkillBonuses(groupId: string): string[] {
  return db
    .transaction(() => {
      const events = db
        .prepare('SELECT id FROM events WHERE group_id = ? AND id != ?')
        .all(groupId, OUTSIDE_EVENTS_ID) as Array<{ id: string }>;
      return events.filter((event) => grantSkillCompletionBonus(event.id)).map((event) => event.id);
    })
    .immediate();
}
