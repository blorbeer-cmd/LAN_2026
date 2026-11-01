// Derive all automatic Orga entitlements together so one producer cannot
// withdraw the still-valid claims of another producer using the same cache.
import { db, OUTSIDE_EVENTS_ID } from './db';
import { syncAutomaticPoints, type AutomaticAward } from './automaticPoints';
import { computeStandings } from './leaderboard';
import { readScoringInputs } from './leaderboardData';
import { syncPlayingPoints } from './playingPoints';
import { grantSkillCompletionBonus, SKILL_BONUS_SOURCE, SKILL_BONUS_POINTS } from './skillBonus';
import { todoAwards } from './todoPoints';
import { grantTravelPoints } from './travelPoints';

export function syncOrgaPoints(groupId: string, eventId: string): boolean {
  return db
    .transaction(() => {
      // A caller with the wrong group must not trigger even an otherwise valid grant.
      if (!db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId)) return false;
      const skillChanged = grantSkillCompletionBonus(eventId);
      const travelChanged = grantTravelPoints(groupId, eventId);
      const otherChanged = syncAutomaticPoints(groupId, eventId, 'orga', () => {
        const { matches } = readScoringInputs(groupId, [eventId]);
        const awards: AutomaticAward[] = todoAwards(groupId, eventId);
        const votes = db.prepare(`WITH RECURSIVE decisions(round,root,started_at,created_by,title) AS (
          SELECT round,round,started_at,created_by,title FROM vote_rounds
            WHERE group_id=? AND event_id=? AND source_round IS NULL
          UNION ALL SELECT child.round,d.root,d.started_at,d.created_by,d.title FROM vote_rounds child
            JOIN decisions d ON child.source_round=d.round WHERE child.group_id=? AND child.event_id=?
          ) SELECT DISTINCT d.root AS round,d.started_at,d.created_by,d.title FROM decisions d
          JOIN vote_rounds vr ON vr.group_id=? AND vr.event_id=? AND vr.round=d.round
          WHERE vr.closed_at IS NOT NULL AND d.created_by IS NOT NULL
            AND (SELECT COUNT(DISTINCT v.player_id) FROM votes v
              WHERE v.group_id=vr.group_id AND v.round=vr.round) >= 3`)
          .all(groupId, eventId, groupId, eventId, groupId, eventId) as Array<{ round: number; started_at: number; created_by: string; title: string | null }>;
        for (const vote of votes) awards.push({
          playerId: vote.created_by, sourceKey: `vote:${vote.round}:${vote.started_at}:organization`, amount: 2,
          title: `Spieleabstimmung abgeschlossen: ${vote.title || `Runde ${vote.round}`}`,
        });
        const polls = db.prepare(`SELECT p.title,
          (SELECT original.id FROM event_date_polls original WHERE original.event_id=p.event_id
            AND original.decision_key=p.decision_key ORDER BY original.round_number LIMIT 1) AS root_id,
          (SELECT original.created_by FROM event_date_polls original WHERE original.event_id=p.event_id
            AND original.decision_key=p.decision_key ORDER BY original.round_number LIMIT 1) AS created_by
          FROM event_date_polls p WHERE p.event_id=? AND p.status IN ('closed','scheduled','superseded')
          AND (SELECT COUNT(DISTINCT r.player_id) FROM event_date_poll_responses r WHERE r.poll_id=p.id) >= 3`)
          .all(eventId) as Array<{ root_id: string; created_by: string | null; title: string }>;
        for (const poll of polls) if (poll.created_by) awards.push({
          playerId: poll.created_by, sourceKey: `poll:${poll.root_id}:organization`, amount: 3,
          title: `Umfrage abgeschlossen: ${poll.title}`,
        });
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
            `SELECT fo.id, fo.title, fo.created_by
      FROM food_orders fo JOIN events e ON e.id = fo.event_id
      WHERE fo.event_id = ? AND e.group_id = ? AND fo.closed_at IS NOT NULL`,
          )
          .all(eventId, groupId) as Array<{
          id: string;
          title: string;
          created_by: string;
        }>;
        const participants = db.prepare(`SELECT DISTINCT player_id FROM food_order_items
      WHERE order_id = ?`);
        for (const order of orders) {
          // A submitted order counts regardless of its configured deadline or item
          // timestamp. Price remains optional in the ordering API.
          const playerIds = (participants.all(order.id) as Array<{ player_id: string }>).map((item) => item.player_id);
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
        const earnedSkills = db
          .prepare(
            `SELECT player_id FROM points_orga_awards
      WHERE event_id = ? AND source_key = ? AND amount = ?`,
          )
          .all(eventId, SKILL_BONUS_SOURCE, SKILL_BONUS_POINTS) as Array<{ player_id: string }>;
        for (const { player_id: playerId } of earnedSkills)
          awards.push({
            playerId,
            sourceKey: SKILL_BONUS_SOURCE,
            amount: SKILL_BONUS_POINTS,
            title: 'Skill-Einschätzungen vollständig',
          });
        const travel = db.prepare(`SELECT player_id,source_key FROM points_orga_awards
          WHERE event_id=? AND source_key IN ('bonus:arrival','bonus:departure') AND amount=2`)
          .all(eventId) as Array<{ player_id: string; source_key: string }>;
        for (const item of travel) awards.push({ playerId: item.player_id, sourceKey: item.source_key, amount: 2,
          title: item.source_key === 'bonus:arrival' ? 'Ankunft eingetragen' : 'Abreise eingetragen' });
        return awards;
      });
      return skillChanged || travelChanged || otherChanged;
    })
    .immediate();
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
