import { db } from './db';
import { roundView, type BettingRound } from './betting';
import { pointStandings, pointsAreVisible } from './points';

// A projection for a shared screen: no wallets, player IDs, odds, estimates
// or administrative data. Reads deliberately never reconcile or award points.
export function readKioskPoints(groupId: string, eventId: string) {
  if (!pointsAreVisible(eventId)) return { showPoints: false, rounds: [], rankings: [] };
  const event = db.prepare('SELECT is_test FROM events WHERE id = ? AND group_id = ?').get(eventId, groupId) as
    { is_test: number } | undefined;
  if (!event) return { showPoints: false, rounds: [], rankings: [] };
  const names = new Map((db.prepare(`SELECT id, name FROM players WHERE deactivated_at IS NULL
    AND newsticker_opt_out = 0 AND (is_test = 0 OR ? = 1)`).all(event.is_test) as Array<{ id: string; name: string }>)
    .map((p) => [p.id, p.name]));
  const rounds = (db.prepare(`SELECT * FROM betting_rounds WHERE group_id = ? AND event_id = ?
    AND source_type IN ('tournament', 'tournament_match') AND status != 'refunded'
    ORDER BY created_at, rowid`).all(groupId, eventId) as BettingRound[]).flatMap((row) => {
    const view = roundView(row, '');
    if (!view.tournament) return [];
    return [{ id: view.id, title: view.title, tournament: view.tournament,
      sourceType: view.sourceType, status: view.status, pot: view.pot, tipCount: view.tipCount,
      outcomes: view.outcomes.map((o) => ({ label: o.label, stake: o.stake, winner: view.result === o.id,
        tippers: o.tippers.map((t) => ({ name: t.name, stake: t.stake })) })) }];
  }).sort((a, b) => a.tournament.name.localeCompare(b.tournament.name, 'de') ||
    a.tournament.id.localeCompare(b.tournament.id) ||
    Number(b.sourceType === 'tournament') - Number(a.sourceType === 'tournament') ||
    (a.tournament.round ?? 0) - (b.tournament.round ?? 0) || (a.tournament.slot ?? 0) - (b.tournament.slot ?? 0));
  const standings = pointStandings(eventId);
  const rankings = (['total', 'betting', 'orga', 'playing'] as const).map((category) => ({
    category,
    title: { total: 'Gesamt', betting: 'Wetten', orga: 'Orga-Punkte', playing: 'Spielpunkte' }[category],
    rows: standings.map((s) => ({ name: names.get(s.playerId) ?? 'Anonym',
      rank: category === 'total' ? s.rank : s.categories?.[category]?.rank ?? null,
      points: category === 'total' ? s.points : s.categories?.[category]?.raw ?? 0,
      placePoints: category === 'total' ? null : s.categories?.[category]?.placePoints ?? 0,
    })).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.points - a.points || a.name.localeCompare(b.name, 'de')),
  }));
  return { showPoints: true, rounds, rankings };
}
