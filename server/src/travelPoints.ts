import { db, OUTSIDE_EVENTS_ID } from './db';
import { POINTS_ACCOUNTS, readPointsSource, recordPointsEntitlements } from './pointsJournal';

// A recorded travel award is permanent even if a participant later changes or
// removes their travel details. Journal corrections remain independent.
export function grantTravelPoints(groupId: string, eventId: string, now = Date.now()): boolean {
  return db.transaction(() => {
    const event = db.prepare(`SELECT e.starts_at, e.status, e.ended_at, s.closed_at FROM events e
      LEFT JOIN points_settings s ON s.event_id=e.id WHERE e.id=? AND e.group_id=?`).get(eventId, groupId) as
      { starts_at: number | null; status: string; ended_at: number | null; closed_at: number | null } | undefined;
    if (!event || eventId === OUTSIDE_EVENTS_ID || event.status !== 'published' || event.ended_at !== null || event.closed_at != null || event.starts_at === null || event.starts_at > now) return false;
    const rows = db.prepare(`SELECT a.player_id,a.arrival_at,a.departure_at FROM arrivals a
      JOIN event_participants ep ON ep.event_id=a.event_id AND ep.player_id=a.player_id AND ep.status='accepted'
      WHERE a.event_id=? AND a.updated_at<=?`).all(eventId, event.starts_at) as
      Array<{ player_id: string; arrival_at: number | null; departure_at: number | null }>;
    let changed = false;
    for (const row of rows) for (const [field, sourceKey, title] of [
      ['arrival_at', 'bonus:arrival', 'Ankunft eingetragen'],
      ['departure_at', 'bonus:departure', 'Abreise eingetragen'],
    ] as const) {
      if (row[field] === null || db.prepare('SELECT 1 FROM points_orga_awards WHERE event_id=? AND player_id=? AND source_key=?')
        .get(eventId, row.player_id, sourceKey)) continue;
      for (const account of POINTS_ACCOUNTS) db.prepare(`INSERT OR IGNORE INTO points_accounts
        (event_id,player_id,account,created_at) VALUES (?,?,?,?)`).run(eventId, row.player_id, account, now);
      const source = { groupId, eventId, playerId: row.player_id, account: 'orga' as const, sourceKey };
      const current = readPointsSource(source)!;
      if (!current.revision) changed = recordPointsEntitlements([{ ...source, total: 2, expectedRevision: 0, title }])[0].changed || changed;
      db.prepare('INSERT INTO points_orga_awards(event_id,player_id,source_key,amount) VALUES (?,?,?,2)')
        .run(eventId, row.player_id, sourceKey);
    }
    return changed;
  }).immediate();
}
