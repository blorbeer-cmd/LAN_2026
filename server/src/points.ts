import { nanoid } from 'nanoid';
import { db } from './db';

export class PointsError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

export interface PointsSettings {
  event_id: string;
  group_id: string;
  initial_points: number;
  orga_budget: number;
  max_stake: number;
  daily_limit: number;
  max_rounds: number;
  orga_allocated: number;
  prize_info: string;
  created_at: number;
  closed_at: number | null;
}
export interface PointEntry {
  id: string;
  player_id: string;
  amount: number;
  source: string;
  source_key: string;
  title: string;
  details: string;
  actor_id: string | null;
  original_id: string | null;
  created_at: number;
}
export function pointsSettings(eventId: string): PointsSettings | undefined {
  return db.prepare('SELECT * FROM points_settings WHERE event_id = ?').get(eventId) as PointsSettings | undefined;
}
export function requirePointsOpen(eventId: string): PointsSettings {
  const settings = pointsSettings(eventId);
  if (!settings) throw new PointsError('Die Punktewertung ist noch nicht aktiviert.', 404);
  if (settings.closed_at !== null) throw new PointsError('Die Punktewertung ist abgeschlossen.');
  return settings;
}
export function pointParticipants(
  groupId: string,
  eventId: string,
): Array<{ id: string; name: string; color: string }> {
  return db
    .prepare(
      `SELECT p.id, p.name, p.color FROM players p
    JOIN group_memberships gm ON gm.player_id = p.id AND gm.group_id = ? AND gm.status = 'active'
    JOIN event_participants ep ON ep.player_id = p.id AND ep.event_id = ? AND ep.status = 'accepted'
    WHERE p.deactivated_at IS NULL AND p.is_test = 0 ORDER BY p.name COLLATE NOCASE`,
    )
    .all(groupId, eventId) as Array<{ id: string; name: string; color: string }>;
}
export function addPointEntry(
  eventId: string,
  playerId: string,
  amount: number,
  source: string,
  key: string,
  title: string,
  actorId: string | null = null,
  details: object = {},
  originalId: string | null = null,
): boolean {
  const settings = pointsSettings(eventId);
  if (!settings) throw new PointsError('Punktewertung nicht gefunden.', 404);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1_000_000_000)
    throw new PointsError('Ungültiger Punktebetrag.', 400);
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO point_entries
    (id, group_id, event_id, player_id, amount, source, source_key, title, details, actor_id, original_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nanoid(),
        settings.group_id,
        eventId,
        playerId,
        amount,
        source,
        key,
        title,
        JSON.stringify(details),
        actorId,
        originalId,
        Date.now(),
      ).changes === 1
  );
}
export function ensurePointAccounts(eventId: string): void {
  const settings = pointsSettings(eventId);
  if (!settings || settings.closed_at !== null) return;
  db.transaction(() => {
    for (const player of pointParticipants(settings.group_id, eventId)) {
      addPointEntry(eventId, player.id, settings.initial_points, 'start', `start:${player.id}`, 'Grundstock zur LAN');
    }
  })();
}
export function wallet(eventId: string, playerId: string) {
  const { total } = db
    .prepare('SELECT COALESCE(SUM(amount),0) AS total FROM point_entries WHERE event_id = ? AND player_id = ?')
    .get(eventId, playerId) as { total: number };
  const { held } = db
    .prepare(
      `SELECT COALESCE(SUM(t.stake),0) AS held FROM betting_tips t
    JOIN betting_rounds r ON r.id = t.round_id WHERE r.event_id = ? AND t.player_id = ? AND r.status IN ('open','locked')`,
    )
    .get(eventId, playerId) as { held: number };
  return { total, held, available: total - held };
}
export function pointStandings(eventId: string) {
  const settings = pointsSettings(eventId);
  if (!settings) return [];
  const frozen =
    settings.closed_at !== null
      ? (db
          .prepare('SELECT standings FROM points_snapshots WHERE event_id = ? ORDER BY revision DESC LIMIT 1')
          .get(eventId) as { standings: string } | undefined)
      : undefined;
  if (frozen) {
    return (JSON.parse(frozen.standings) as Array<{ playerId: string; points: number }>).flatMap((row) => {
      const player = db
        .prepare('SELECT name,color FROM players WHERE id = ? AND deactivated_at IS NULL')
        .get(row.playerId) as { name: string; color: string } | undefined;
      return player ? [{ ...row, ...player, wins: 0, matchesPlayed: 0 }] : [];
    });
  }
  return pointParticipants(settings.group_id, eventId)
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      color: p.color,
      points: wallet(eventId, p.id).total,
      wins: 0,
      matchesPlayed: 0,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de'));
}
export function rewardBudget(eventId: string) {
  const settings = pointsSettings(eventId);
  const allocated = settings?.orga_allocated ?? 0;
  const { issued } = db
    .prepare("SELECT COALESCE(SUM(amount),0) AS issued FROM point_entries WHERE event_id = ? AND source = 'task'")
    .get(eventId) as { issued: number };
  return {
    total: settings?.orga_budget ?? 0,
    issued,
    reserved: allocated - issued,
    available: (settings?.orga_budget ?? 0) - allocated,
  };
}
export function configureTaskReward(
  groupId: string,
  eventId: string,
  taskId: string,
  perPerson: number,
  slots: number,
): void {
  db.transaction(() => {
    requirePointsOpen(eventId);
    const task = db
      .prepare('SELECT status FROM checklist_tasks WHERE id = ? AND group_id = ? AND event_id = ?')
      .get(taskId, groupId, eventId) as { status: string } | undefined;
    if (!task) throw new PointsError('Aufgabe nicht gefunden.', 404);
    if (task.status !== 'open' || db.prepare('SELECT 1 FROM checklist_task_assignees WHERE task_id = ?').get(taskId)) {
      throw new PointsError('Belohnungen müssen vor der Übernahme festgelegt werden.');
    }
    if (db.prepare('SELECT 1 FROM points_task_rewards WHERE task_id = ?').get(taskId)) {
      throw new PointsError('Die zugesagte Belohnung ist bereits festgelegt.');
    }
    if (perPerson * slots > rewardBudget(eventId).available) throw new PointsError('Das Orga-Budget reicht nicht aus.');
    db.prepare(
      'INSERT INTO points_task_rewards (task_id,event_id,group_id,per_person,slots,created_at) VALUES (?,?,?,?,?,?)',
    ).run(taskId, eventId, groupId, perPerson, slots, Date.now());
    db.prepare('UPDATE points_settings SET orga_allocated = orga_allocated + ? WHERE event_id = ?').run(
      perPerson * slots,
      eventId,
    );
  })();
}
export function taskReward(taskId: string, playerId?: string) {
  const reward = db
    .prepare('SELECT per_person AS perPerson, slots FROM points_task_rewards WHERE task_id = ?')
    .get(taskId) as { perPerson: number; slots: number } | undefined;
  if (!reward) return null;
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM points_task_claims WHERE task_id = ?').get(taskId) as {
    count: number;
  };
  const beneficiaryIds = (
    db.prepare('SELECT player_id FROM points_task_claims WHERE task_id = ?').all(taskId) as Array<{ player_id: string }>
  ).map((p) => p.player_id);
  return {
    ...reward,
    beneficiaryIds,
    remaining: Math.max(0, reward.slots - count),
    mine: Boolean(
      playerId &&
      db.prepare('SELECT 1 FROM points_task_claims WHERE task_id = ? AND player_id = ?').get(taskId, playerId),
    ),
  };
}
// Called within the checklist mutation transaction, so a helper and their
// promised amount cannot diverge under simultaneous claims/releases.
export function claimTaskPoints(taskId: string, playerId: string): void {
  const reward = taskReward(taskId);
  if (reward && reward.remaining > 0) {
    db.prepare('INSERT OR IGNORE INTO points_task_claims (task_id,player_id) VALUES (?,?)').run(taskId, playerId);
  }
}
export function releaseTaskPoints(taskId: string, playerId: string): void {
  db.prepare('DELETE FROM points_task_claims WHERE task_id = ? AND player_id = ?').run(taskId, playerId);
}
export function awardTaskPoints(taskId: string, actorId: string): void {
  const task = db
    .prepare(
      `SELECT t.title, r.event_id, r.per_person FROM checklist_tasks t
    JOIN points_task_rewards r ON r.task_id = t.id WHERE t.id = ?`,
    )
    .get(taskId) as { title: string; event_id: string; per_person: number } | undefined;
  if (!task) return;
  requirePointsOpen(task.event_id);
  ensurePointAccounts(task.event_id);
  const helpers = db
    .prepare(
      `SELECT c.player_id FROM points_task_claims c
    JOIN checklist_task_assignees a ON a.task_id = c.task_id AND a.player_id = c.player_id WHERE c.task_id = ?`,
    )
    .all(taskId) as Array<{ player_id: string }>;
  const settings = pointsSettings(task.event_id)!;
  const eligible = new Set(pointParticipants(settings.group_id, task.event_id).map((p) => p.id));
  for (const helper of helpers) {
    if (eligible.has(helper.player_id))
      addPointEntry(
        task.event_id,
        helper.player_id,
        task.per_person,
        'task',
        `task:${taskId}:${helper.player_id}`,
        task.title,
        actorId,
        { taskId, automatic: true },
      );
  }
}
export function deductPoints(
  eventId: string,
  entryId: string,
  amount: number,
  reason: string,
  actorId: string,
  requestId: string,
): void {
  db.transaction(() => {
    requirePointsOpen(eventId);
    const previous = db
      .prepare('SELECT original_id,amount,details FROM point_entries WHERE event_id = ? AND source_key = ?')
      .get(eventId, `deduct:${requestId}`) as Pick<PointEntry, 'original_id' | 'amount' | 'details'> | undefined;
    if (previous) {
      if (
        previous.original_id !== entryId ||
        previous.amount !== -amount ||
        JSON.parse(previous.details).reason !== reason
      )
        throw new PointsError('Vorgangskennung wurde bereits für einen anderen Entzug verwendet.');
      return;
    }
    const original = db
      .prepare('SELECT * FROM point_entries WHERE id = ? AND event_id = ? AND amount > 0')
      .get(entryId, eventId) as PointEntry | undefined;
    if (!original) throw new PointsError('Gutschrift nicht gefunden.', 404);
    const { deducted } = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS deducted FROM point_entries WHERE original_id = ? AND source = 'correction'",
      )
      .get(original.id) as { deducted: number };
    if (amount > original.amount + deducted)
      throw new PointsError('Der Betrag übersteigt die verbleibende Gutschrift.');
    addPointEntry(
      eventId,
      original.player_id,
      -amount,
      'correction',
      `deduct:${requestId}`,
      `Punkteentzug: ${original.title}`,
      actorId,
      { reason, originalId: original.id },
      original.id,
    );
  })();
}
