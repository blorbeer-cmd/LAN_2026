import { db } from './db';
import { PointsError, requirePointsAdmin } from './pointsAccess';
import { writeAdminAudit } from './adminAudit';
import { readPointsSource, recordPointsEntitlements, type PointsEntitlement } from './pointsJournal';

// A market has one canonical claim per player and account throughout its
// lifecycle. Reservations debit only the wallet; settlement replaces that
// claim with payout minus stake and records the same net in the betting score.
export function bookBettingMarket(groupId: string, eventId: string, roundId: string, reason: string, actorId: string | null = null): void {
  db.transaction(() => {
    if (actorId) requirePointsAdmin(groupId, actorId);
    const round = db.prepare(`SELECT r.title,r.status,s.closed_at FROM betting_rounds r
      JOIN points_settings s ON s.event_id=r.event_id
      WHERE r.id=? AND r.group_id=? AND r.event_id=?`).get(roundId, groupId, eventId) as
      { title: string; status: string; closed_at: number | null } | undefined;
    if (!round) throw new PointsError('Tipprunde nicht gefunden.', 404);
    if (round.closed_at !== null) throw new PointsError('Die Punktewertung ist abgeschlossen.');
    const tips = db.prepare('SELECT player_id,stake,payout FROM betting_tips WHERE round_id=?').all(roundId) as
      Array<{ player_id: string | null; stake: number; payout: number | null }>;
    const settled = round.status === 'settled';
    const reserved = round.status === 'open' || round.status === 'locked';
    if (settled) {
      const stakes = tips.reduce((sum, tip) => sum + BigInt(tip.stake), 0n);
      let payouts = 0n;
      for (const tip of tips) {
        if (!Number.isSafeInteger(tip.payout) || tip.payout! < 0)
          throw new PointsError('Die Wettabrechnung enthält eine ungültige Auszahlung.');
        payouts += BigInt(tip.payout!);
      }
      if (stakes !== payouts) throw new PointsError('Die Wettabrechnung muss die Summe aller Einsätze erhalten.');
    }
    const sourceKey = `bet:${roundId}`;
    // A withdrawn tip no longer has a tips row. Its previous wallet claim still
    // needs a journal reversal, including when it is the last tip in the market.
    const previous = db.prepare(`SELECT DISTINCT player_id FROM points_sources
      WHERE event_id=? AND source_key=? AND account IN ('wallet','betting')`).all(eventId, sourceKey) as
      Array<{ player_id: string }>;
    const changes: PointsEntitlement[] = [];
    for (const playerId of new Set([...tips.map((tip) => tip.player_id), ...previous.map((row) => row.player_id)])) {
      if (!playerId) continue; // Account erasure retains anonymized stakes in the pool.
      const tip = tips.find((candidate) => candidate.player_id === playerId);
      const net = settled && tip ? tip.payout! - tip.stake : 0;
      for (const account of ['wallet', 'betting'] as const) {
        const source = { groupId, eventId, playerId, account, sourceKey };
        const current = readPointsSource(source);
        if (!current) throw new PointsError('Wettkonto nicht gefunden.', 404);
        changes.push({ ...source, total: account === 'wallet' && reserved && tip ? -tip.stake : net,
          expectedRevision: current.revision, title: round.title.replace(/\0/g, '').slice(0, 200), reason });
      }
    }
    const results = recordPointsEntitlements(changes);
    if (actorId) for (const result of results) if (result.changed)
      writeAdminAudit({ actorPlayerId: actorId, groupId, action: 'betting_journal_corrected',
        targetType: 'points_journal', targetId: result.entryId!, details: { eventId, roundId, reason } });
  }).immediate();
}
