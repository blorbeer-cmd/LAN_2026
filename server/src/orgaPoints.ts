// Derive all automatic Orga entitlements together so one producer cannot
// withdraw the still-valid claims of another producer using the same cache.
import { db, OUTSIDE_EVENTS_ID } from './db';
import { syncAutomaticPoints, type AutomaticAward } from './automaticPoints';
import { computeStandings } from './leaderboard';
import { readScoringInputs } from './leaderboardData';
import { syncPlayingPoints } from './playingPoints';

export function syncOrgaPoints(groupId: string, eventId: string): boolean {
  return syncAutomaticPoints(groupId, eventId, 'orga', () => {
    const { matches } = readScoringInputs(groupId, [eventId]);
    const awards: AutomaticAward[] = [];
    for (const match of matches) {
      if (!match.createdBy || computeStandings([match]).length === 0) continue;
      // A tournament result is already one canonical match. Its organizer was
      // copied when the result was created, so deleting a bracket cannot mint
      // a second standalone-match reward or change the original recipient.
      awards.push({
        playerId: match.createdBy,
        sourceKey: `match:${match.id}`,
        amount: 1,
        title: `Spiel organisiert: ${match.gameName}`,
      });
    }
    const completed = db
      .prepare(
        `SELECT id, name, created_by FROM tournaments
      WHERE group_id = ? AND event_id = ? AND status = 'completed' AND ended_early = 0
      AND created_by IS NOT NULL`,
      )
      .all(groupId, eventId) as Array<{ id: string; name: string; created_by: string }>;
    for (const tournament of completed)
      awards.push({
        playerId: tournament.created_by,
        sourceKey: `tournament:${tournament.id}:completion`,
        amount: 5,
        title: `Turnier organisiert: ${tournament.name}`,
      });
    const orders = db
      .prepare(
        `SELECT fo.id, fo.title, fo.created_by, fo.closed_at, fo.send_at
      FROM food_orders fo JOIN events e ON e.id = fo.event_id
      WHERE fo.event_id = ? AND e.group_id = ? AND fo.closed_at IS NOT NULL`,
      )
      .all(eventId, groupId) as Array<{
      id: string;
      title: string;
      created_by: string;
      closed_at: number;
      send_at: number | null;
    }>;
    const participants = db.prepare(`SELECT DISTINCT player_id FROM food_order_items
      WHERE order_id = ? AND created_at <= ?`);
    for (const order of orders) {
      // Sending the order is the actual cutoff; an earlier configured deadline
      // still excludes late additions. Price is optional in the ordering API.
      const cutoff = Math.min(order.closed_at, order.send_at ?? order.closed_at);
      const playerIds = (participants.all(order.id, cutoff) as Array<{ player_id: string }>).map(
        (item) => item.player_id,
      );
      const others = playerIds.filter((id) => id !== order.created_by).length;
      const amount = others >= 9 ? 5 : others >= 6 ? 4 : others >= 3 ? 3 : 0;
      if (amount)
        awards.push({
          playerId: order.created_by,
          sourceKey: `food-order:${order.id}:organization`,
          amount,
          title: `Sammelbestellung organisiert: ${order.title}`,
        });
      for (const playerId of playerIds)
        awards.push({
          playerId,
          sourceKey: `food-order:${order.id}:participation`,
          amount: 1,
          title: `Bestellung abgegeben: ${order.title}`,
        });
    }
    return awards;
  });
}

export function syncCompetitionPoints(groupId: string, eventId: string): boolean {
  return db
    .transaction(() => {
      const playingChanged = syncPlayingPoints(groupId, eventId);
      const orgaChanged = syncOrgaPoints(groupId, eventId);
      return playingChanged || orgaChanged;
    })
    .immediate();
}

export function backfillCompetitionPoints(): void {
  const events = db
    .prepare('SELECT id, group_id FROM events WHERE group_id IS NOT NULL AND id != ?')
    .all(OUTSIDE_EVENTS_ID) as Array<{ id: string; group_id: string }>;
  for (const event of events) {
    try {
      syncCompetitionPoints(event.group_id, event.id);
    } catch (error) {
      console.error(`Competition points could not be synchronized for event ${event.id}:`, error);
    }
  }
}
