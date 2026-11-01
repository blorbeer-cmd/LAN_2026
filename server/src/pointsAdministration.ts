import { db } from './db';
import { writeAdminAudit } from './adminAudit';
import { PointsError, requirePointsAdmin } from './pointsAccess';
import { readPointsSource, recordPointsEntitlements, type PointsAccount } from './pointsJournal';

// Only existing source entitlements can be corrected. This cannot create a new
// award or select a different recipient/account through request input.
export function correctJournalEntry(input: {
  groupId: string;
  eventId: string;
  actorId: string;
  entryId: string;
  total: number;
  expectedRevision: number;
  reason: string;
}) {
  return db
    .transaction(() => {
      const source = db
        .prepare(
          `SELECT s.player_id AS playerId, s.account, s.source_key AS sourceKey, j.title
      FROM points_journal j JOIN points_sources s ON s.id = j.source_id JOIN events e ON e.id = s.event_id
      WHERE j.id = ? AND e.group_id = ? AND s.event_id = ?`,
        )
        .get(input.entryId, input.groupId, input.eventId) as
        { playerId: string; account: PointsAccount; sourceKey: string; title: string } | undefined;
      if (!source) throw new PointsError('Journaleintrag nicht gefunden.', 404);
      requirePointsAdmin(input.groupId, input.actorId);
      if (source.account === 'wallet' || source.account === 'betting')
        throw new PointsError('Wettguthaben und Wett-Nettowerte können nur durch eine begründete Marktkorrektur oder ein Storno geändert werden.');
      const settings = db.prepare('SELECT closed_at FROM points_settings WHERE event_id = ?').get(input.eventId) as
        { closed_at: number | null } | undefined;
      if (settings?.closed_at != null) throw new PointsError('Die Punktewertung ist abgeschlossen.');
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (!reason || reason.length > 500 || reason.includes('\0'))
        throw new PointsError('Begründung erforderlich (höchstens 500 Zeichen).', 400);
      if (
        !Number.isSafeInteger(input.total) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1
      ) {
        throw new PointsError('Gesamtanspruch und aktuelle Revision müssen ganze, sichere Zahlen sein.', 400);
      }
      const identity = { groupId: input.groupId, eventId: input.eventId, ...source };
      const current = readPointsSource(identity)!;
      if (current.revision !== input.expectedRevision)
        throw new PointsError('Der Anspruch wurde inzwischen geändert. Bitte neu laden.');
      let result;
      try {
        result = recordPointsEntitlements([
          { ...identity, total: input.total, expectedRevision: input.expectedRevision, title: source.title, reason },
        ])[0];
      } catch (error) {
        if (error instanceof RangeError)
          throw new PointsError('Der Punktebetrag überschreitet den sicheren Zahlenbereich.', 400);
        throw error;
      }
      if (result.changed)
        writeAdminAudit({
          actorPlayerId: input.actorId,
          groupId: input.groupId,
          action: 'category_points_corrected',
          targetType: 'points_journal',
          targetId: result.entryId!,
          details: {
            eventId: input.eventId,
            playerId: source.playerId,
            account: source.account,
            sourceKey: source.sourceKey,
            originalEntryId: input.entryId,
            before: current.total,
            after: input.total,
            fromRevision: current.revision,
            toRevision: result.revision,
            reason,
          },
        });
      return result;
    })
    .immediate();
}
