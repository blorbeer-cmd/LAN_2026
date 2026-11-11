import { db } from './db';
import { PointsError } from './pointsAccess';
import { readPointsBalances, readPointsSource, recordPointsEntitlements } from './pointsJournal';
import { computeCategoryStandings, type CategoryStanding } from './categoryScoring';
export { PointsError } from './pointsAccess';
export const BETTING_MAX_STAKE = 20;
export const BETTING_MIN_SETTLED_TIPS = 2;

export interface PointsSettings {
  event_id: string;
  group_id: string;
  initial_points: number;
  orga_budget: number;
  max_stake: number;
  daily_limit: null;
  max_rounds: null;
  orga_allocated: number;
  prize_info: string;
  created_at: number;
  closed_at: number | null;
  visible: number;
  visibility_revision: number;
  configured_at: number | null;
}
export function pointsSettings(eventId: string): PointsSettings | undefined {
  const settings = db.prepare('SELECT * FROM points_settings WHERE event_id = ?').get(eventId) as PointsSettings | undefined;
  // Legacy quota columns remain storage-compatible, but are no longer rules.
  return settings ? { ...settings, max_stake: BETTING_MAX_STAKE, daily_limit: null, max_rounds: null } : undefined;
}
export function pointsAreVisible(eventId: string | null): boolean {
  if (!eventId) return false;
  return Boolean(db.prepare(`SELECT 1 FROM points_settings s JOIN events e ON e.id = s.event_id
    WHERE s.event_id = ? AND s.visible = 1 AND e.event_type_key = 'lan'
      AND e.status IN ('published','ended')`).get(eventId));
}
export function isPointsEvent(eventId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM events WHERE id = ? AND event_type_key = 'lan'
    AND status IN ('published','ended')`).get(eventId));
}
export function requirePointsVisible(eventId: string): void {
  if (!pointsAreVisible(eventId)) throw new PointsError('LAN-Punkte sind für dieses Event ausgeblendet.', 403);
}
export function requirePointsOpen(eventId: string): PointsSettings {
  const settings = pointsSettings(eventId);
  if (!settings) throw new PointsError('Die Punktewertung ist noch nicht aktiviert.', 404);
  if (settings.closed_at !== null) throw new PointsError('Die Punktewertung ist abgeschlossen.');
  return settings;
}
// Test events are scored like regular LANs so admins can rehearse the points
// flow with the seeded test identities. Regular events keep excluding test
// accounts; test events stay hidden outside Admin mode by event access.
export function pointParticipants(
  groupId: string,
  eventId: string,
): Array<{ id: string; name: string; color: string }> {
  return db
    .prepare(
      `SELECT p.id, p.name, p.color FROM players p
    JOIN group_memberships gm ON gm.player_id = p.id AND gm.group_id = ? AND gm.status = 'active'
    JOIN event_participants ep ON ep.player_id = p.id AND ep.event_id = ? AND ep.status = 'accepted'
    JOIN events e ON e.id = ep.event_id
    WHERE p.deactivated_at IS NULL AND (p.is_test = 0 OR e.is_test = 1) ORDER BY p.name COLLATE NOCASE`,
    )
    .all(groupId, eventId) as Array<{ id: string; name: string; color: string }>;
}
export const BETTING_START_POINTS = 100;
export function ensurePointAccounts(eventId: string): void {
  const settings = pointsSettings(eventId);
  if (!settings || settings.closed_at !== null || !isPointsEvent(eventId)) return;
  db.transaction(() => {
    for (const player of pointParticipants(settings.group_id, eventId)) {
      for (const account of ['orga', 'playing', 'betting', 'wallet'])
        db.prepare('INSERT OR IGNORE INTO points_accounts(event_id,player_id,account,created_at) VALUES (?,?,?,?)')
          .run(eventId, player.id, account, Date.now());
      const source = { groupId: settings.group_id, eventId, playerId: player.id, account: 'wallet' as const, sourceKey: 'wallet:start' };
      const current = readPointsSource(source)!;
      if (current.revision === 0) recordPointsEntitlements([{ ...source, total: BETTING_START_POINTS,
        expectedRevision: 0, title: 'Wett-Startguthaben' }]);
    }
  }).immediate();
}

export function walletEntries(eventId: string, playerId?: string) {
  return db.prepare(`SELECT j.id,s.player_id,j.amount,s.source_key,j.title,j.created_at,
      CASE WHEN s.source_key='wallet:start' THEN 'start'
        WHEN j.reason='Tippeinsatz reserviert' THEN 'reservation'
        WHEN j.reason='Tipp zurückgenommen' THEN 'release'
        WHEN j.reason LIKE 'Storno:%' THEN 'reversal'
        WHEN j.reason LIKE 'Korrektur:%' THEN 'correction'
        WHEN j.reason LIKE 'Admin-Erstattung:%' OR j.reason IN ('Ungültiger Tipptopf','Wettbewerb entfernt',
          'Wettbewerb geändert oder abgebrochen','Spiel vor Tippschluss gestartet') THEN 'refund'
        ELSE 'tip' END AS source,
      json_object('reason',j.reason,'roundId',CASE WHEN s.source_key LIKE 'bet:%' THEN substr(s.source_key,5) END) AS details,
      a.actor_player_id AS actor_id,actor.name AS actorName,NULL AS original_id,
      p.name AS playerName
    FROM points_journal j JOIN points_sources s ON s.id=j.source_id JOIN players p ON p.id=s.player_id
    LEFT JOIN admin_log a ON a.target_id=j.id AND a.target_type='points_journal' AND a.action='betting_journal_corrected'
    LEFT JOIN players actor ON actor.id=a.actor_player_id
    WHERE s.event_id=? AND s.account='wallet' ${playerId ? 'AND s.player_id=?' : ''}
    ORDER BY j.created_at,j.rowid`).all(eventId, ...(playerId ? [playerId] : []));
}
export function wallet(eventId: string, playerId: string) {
  const settings = pointsSettings(eventId);
  const available = settings ? readPointsBalances(settings.group_id, eventId, playerId)?.wallet ?? 0 : 0;
  const { held } = db
    .prepare(
      `SELECT COALESCE(SUM(t.stake),0) AS held FROM betting_tips t
    JOIN betting_rounds r ON r.id = t.round_id WHERE r.event_id = ? AND t.player_id = ? AND r.status IN ('open','locked')`,
    )
    .get(eventId, playerId) as { held: number };
  return { total: available + held, held, available };
}
export function bettingParticipation(eventId: string, playerId: string) {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM betting_tips t
    JOIN betting_rounds r ON r.id=t.round_id
    WHERE r.event_id=? AND t.player_id=? AND r.status='settled'`).get(eventId, playerId) as { count: number };
  return { settledTips: count, minimumTips: BETTING_MIN_SETTLED_TIPS, hasMinimum: count >= BETTING_MIN_SETTLED_TIPS };
}
export interface PointStanding extends CategoryStanding {
  name: string;
  color: string;
  participantCount: number;
  settledTips: number;
  bettingQualified: boolean;
  wins: number;
  matchesPlayed: number;
}

export interface PointsSnapshot {
  version: 2;
  participantCount: number;
  standings: PointStanding[];
  rules?: ReturnType<typeof pointsSnapshotRules>;
}
// Keep the applied rules with each revision. Historical snapshots without
// this field remain explicitly unknown rather than inheriting today's rules.
export function pointsSnapshotRules() {
  return {
    model: 'category_place_points',
    categories: ['orga', 'playing', 'betting'],
    eligibleParticipants: 'accepted_active_non_test_at_close',
    categoryEligibility: 'positive_raw',
    placePoints: 'N-rank+1',
    sharedRanks: 'competition',
    total: 'sum_category_place_points',
    minimumSettledTips: BETTING_MIN_SETTLED_TIPS,
    walletStart: BETTING_START_POINTS,
    maximumStake: BETTING_MAX_STAKE,
    unsettledMarketsAtClose: 'full_refund',
    matchPointsByPosition: [4, 3, 2, 1],
    lastMatchPlacePoints: 1,
    matchTies: 'floor_mean_occupied_positions',
    tournamentPlacementPoints: [5, 3, 1],
    tournamentTies: 'full_bonus_for_shared_place',
    poolRemainder: 'largest_fraction_then_first_tip_submission_then_insertion_order',
    bettingPayoutPolicy: 'stored_per_market',
    defaultBettingPayoutPolicy: 'stake_cap_v1',
    orga: {
      completedForeignTodo: 3, organizedMatch: 1, completedTournament: 5,
      foodOrderByOtherParticipants: { minimum: 3, threeToFive: 3, sixToEight: 4, nineOrMore: 5 },
      ownFoodOrder: 1, completeSkills: 5, arrivalBeforeStart: 2, departureBeforeStart: 2,
      completedPoll: 3, completedGameVote: 2, minimumRespondents: 3,
    },
  } as const;
}
export function readPointsSnapshot(eventId: string, revision?: number) {
  const row = (revision === undefined
    ? db.prepare('SELECT revision,standings,created_at FROM points_snapshots WHERE event_id=? ORDER BY revision DESC LIMIT 1').get(eventId)
    : db.prepare('SELECT revision,standings,created_at FROM points_snapshots WHERE event_id=? AND revision=?').get(eventId, revision)) as
      { revision: number; standings: string; created_at: number } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.standings) as PointsSnapshot | PointStanding[];
  const snapshot = Array.isArray(parsed)
    ? { version: 2 as const, participantCount: parsed[0]?.participantCount ?? parsed.length, standings: parsed }
    : parsed;
  return { ...snapshot, revision: row.revision, createdAt: row.created_at };
}
function frozenPoints(eventId: string): PointsSnapshot | null {
  if (pointsSettings(eventId)?.closed_at == null) return null;
  return readPointsSnapshot(eventId);
}
export function hydratePointStandings(standings: PointStanding[]): PointStanding[] {
  const players = new Map((db.prepare('SELECT id,name,color FROM players WHERE deactivated_at IS NULL')
    .all() as Array<{ id: string; name: string; color: string }>).map(({ id, ...player }) => [id, player]));
  return standings.flatMap((row) => {
    const player = players.get(row.playerId);
    return player ? [{ ...row, ...player }] : [];
  });
}
export function pointParticipantCount(eventId: string): number {
  const settings = pointsSettings(eventId);
  if (!settings || !isPointsEvent(eventId)) return 0;
  return frozenPoints(eventId)?.participantCount ?? pointParticipants(settings.group_id, eventId).length;
}

export function pointStandings(eventId: string): PointStanding[] {
  const settings = pointsSettings(eventId);
  if (!settings || !isPointsEvent(eventId)) return [];
  const frozen = frozenPoints(eventId);
  if (frozen) {
    // Older pre-cutover snapshots remain readable without inventing category
    // scores. New snapshots retain N, category ranks and the full calculation.
    return hydratePointStandings(frozen.standings);
  }
  const participants = pointParticipants(settings.group_id, eventId);
  const inputs = participants.map((player) => {
    const balances = readPointsBalances(settings.group_id, eventId, player.id);
    const participation = bettingParticipation(eventId, player.id);
    return { playerId: player.id, raw: { orga: balances?.orga ?? 0, playing: balances?.playing ?? 0,
      betting: balances?.betting ?? 0 }, bettingQualified: participation.hasMinimum, settledTips: participation.settledTips };
  });
  const byId = new Map(participants.map((player, index) => [player.id, { ...player, ...inputs[index] }]));
  return computeCategoryStandings(inputs).map((row) => {
    const player = byId.get(row.playerId)!;
    return { ...row, name: player.name, color: player.color, participantCount: participants.length,
      settledTips: player.settledTips, bettingQualified: player.bettingQualified, wins: 0, matchesPlayed: 0 };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de') || a.playerId.localeCompare(b.playerId));
}
