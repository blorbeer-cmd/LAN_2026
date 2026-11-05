// Internal accounting foundation. Domain handlers authorize callers and derive
// entitlements from their source records; there is deliberately no public mint API.
import { nanoid } from 'nanoid';
import { db } from './db';

export const POINTS_ACCOUNTS = ['betting', 'orga', 'playing', 'wallet'] as const;
export type PointsAccount = (typeof POINTS_ACCOUNTS)[number];

export interface PointsSource {
  groupId: string;
  eventId: string;
  playerId: string;
  account: PointsAccount;
  // Canonical domain key, e.g. match:<id> or todo:<id>. Never a request UUID.
  sourceKey: string;
}

export interface PointsEntitlement extends PointsSource {
  total: number;
  expectedRevision: number;
  title: string;
  reason?: string;
}

export interface PointsSourceState {
  revision: number;
  total: number;
}

export class PointsJournalConflict extends Error {}

function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Points must be safe whole numbers');
  return value;
}

function textField(value: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || value.includes('\0')) {
    throw new TypeError('Invalid points journal text');
  }
  return value.trim();
}

export function readPointsSource(source: PointsSource): PointsSourceState | undefined {
  const state = db
    .prepare(
      `
    SELECT COALESCE(MAX(j.revision), 0) AS revision, COALESCE(SUM(j.amount), 0) AS total
    FROM points_accounts a JOIN events e ON e.id = a.event_id
    LEFT JOIN points_sources s ON s.event_id = a.event_id AND s.player_id = a.player_id
      AND s.account = a.account AND s.source_key = ?
    LEFT JOIN points_journal j ON j.source_id = s.id
    WHERE e.group_id = ? AND a.event_id = ? AND a.player_id = ? AND a.account = ?
    GROUP BY a.event_id, a.player_id, a.account
  `,
    )
    .get(source.sourceKey, source.groupId, source.eventId, source.playerId, source.account) as
    PointsSourceState | undefined;
  if (state) safeInteger(state.total);
  return state;
}

export function readPointsBalances(
  groupId: string,
  eventId: string,
  playerId: string,
): Record<PointsAccount, number> | undefined {
  const rows = db
    .prepare(
      `
    SELECT a.account, COALESCE(SUM(j.amount), 0) AS total
    FROM points_accounts a JOIN events e ON e.id = a.event_id
    LEFT JOIN points_sources s ON s.event_id = a.event_id AND s.player_id = a.player_id AND s.account = a.account
    LEFT JOIN points_journal j ON j.source_id = s.id
    WHERE e.group_id = ? AND a.event_id = ? AND a.player_id = ? GROUP BY a.account
  `,
    )
    .all(groupId, eventId, playerId) as Array<{ account: PointsAccount; total: number }>;
  if (!rows.length) return undefined;
  const balances = { betting: 0, orga: 0, playing: 0, wallet: 0 };
  for (const row of rows) balances[row.account] = safeInteger(row.total);
  return balances;
}

export interface PointsJournalEntry {
  id: string;
  account: PointsAccount;
  sourceKey: string;
  revision: number;
  amount: number;
  title: string;
  reason: string | null;
  createdAt: number;
}

export function readPointsJournal(groupId: string, eventId: string, playerId: string): PointsJournalEntry[] {
  return db
    .prepare(
      `SELECT j.id, s.account, s.source_key AS sourceKey,
      j.revision, j.amount, j.title, j.reason, j.created_at AS createdAt
    FROM points_journal j JOIN points_sources s ON s.id = j.source_id
    JOIN events e ON e.id = s.event_id
    WHERE e.group_id = ? AND s.event_id = ? AND s.player_id = ? ORDER BY j.created_at, j.rowid
  `,
    )
    .all(groupId, eventId, playerId) as PointsJournalEntry[];
}

function recordEntitlement(change: PointsEntitlement) {
  if (!POINTS_ACCOUNTS.includes(change.account)) throw new TypeError('Invalid points account');
  const sourceKey = textField(change.sourceKey, 200);
  if (sourceKey !== change.sourceKey) throw new TypeError('Source keys must be canonical');
  const title = textField(change.title, 200);
  const reason = change.reason === undefined ? null : textField(change.reason, 500);
  safeInteger(change.total);
  if (safeInteger(change.expectedRevision) < 0) throw new RangeError('Invalid points revision');
  const current = readPointsSource(change);
  if (!current) throw new Error('Points account not found in this group and event');
  // Retrying the same entitlement has no financial effect, including after a
  // response was lost. A stale, different entitlement must be recomputed.
  if (current.total === change.total) return { ...current, entryId: null, changed: false };
  if (current.revision !== change.expectedRevision) throw new PointsJournalConflict('Points source changed');
  if (current.revision > 0 && reason === null) throw new TypeError('Points corrections require a reason');
  const amount = safeInteger(change.total - current.total);
  const balance = readPointsBalances(change.groupId, change.eventId, change.playerId)![change.account];
  safeInteger(balance + amount);
  let source = db
    .prepare(
      `SELECT id FROM points_sources
    WHERE event_id = ? AND player_id = ? AND account = ? AND source_key = ?`,
    )
    .get(change.eventId, change.playerId, change.account, sourceKey) as { id: string } | undefined;
  if (!source) {
    source = { id: nanoid() };
    db.prepare('INSERT INTO points_sources(id, event_id, player_id, account, source_key) VALUES (?, ?, ?, ?, ?)').run(
      source.id,
      change.eventId,
      change.playerId,
      change.account,
      sourceKey,
    );
  }
  const entryId = nanoid();
  const revision = current.revision + 1;
  db.prepare(
    `INSERT INTO points_journal(id, source_id, revision, amount, title, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, source.id, revision, amount, title, reason, Date.now());
  return { revision, total: change.total, entryId, changed: true };
}

// An immediate SQLite transaction serializes even independent writer processes.
// Multi-player settlements and their wallet/net-score legs either all persist
// or all roll back. Visibility is intentionally not an input to accounting.
const recordBatch = db.transaction((changes: readonly PointsEntitlement[]) => changes.map(recordEntitlement));
export function recordPointsEntitlements(changes: readonly PointsEntitlement[]) {
  return recordBatch.immediate(changes);
}
