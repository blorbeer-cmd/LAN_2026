// Event date poll business logic (docs/plans/event-date-poll-concept.md).
// The HTTP layer (routes/eventDatePolls.ts) handles auth/validation/HTTP
// status mapping, audit logging, realtime broadcast and push notifications;
// this module owns the transactional DB state machine so every mutation is
// atomic and race-safe on its own.

import { nanoid } from 'nanoid';
import { db } from './db';
import type { EventRow } from './events';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';
import { endOfIsoDateUtcMs } from './localDate';

export type DatePollStatus = 'open' | 'closed' | 'scheduled' | 'superseded' | 'cancelled';
export type DatePollResponseValue = 'can' | 'if_needed' | 'cannot' | '1' | '2' | '3' | '4' | '5';
export type EventPollTopic = 'date_range' | 'location' | 'duration' | 'budget' | 'custom';
export type EventPollResponseMode = 'feasibility' | 'single_choice' | 'multiple_choice' | 'rating_1_5';

export const FEASIBILITY_RESPONSE_VALUES: DatePollResponseValue[] = ['can', 'if_needed', 'cannot'];
export const RATING_RESPONSE_VALUES: DatePollResponseValue[] = ['1', '2', '3', '4', '5'];
export const RESPONSE_VALUES: DatePollResponseValue[] = [...FEASIBILITY_RESPONSE_VALUES, ...RATING_RESPONSE_VALUES];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

export const REMINDER_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REMINDER_48H_BEFORE_MS = 48 * 60 * 60 * 1000;
const REMINDER_2H_BEFORE_MS = 2 * 60 * 60 * 1000;
const STAGE_NONE = 0;
const STAGE_48H = 1;
const STAGE_2H = 2;

export interface DatePollRow {
  id: string;
  event_id: string;
  round_number: number;
  note: string | null;
  created_by: string | null;
  response_due_at: number;
  status: DatePollStatus;
  selected_option_id: string | null;
  topic: EventPollTopic;
  decision_key: string;
  title: string;
  response_mode: EventPollResponseMode;
  max_selections: number | null;
  is_anonymous: number;
  decision_note: string | null;
  created_at: number;
  updated_at: number;
}

export interface DatePollOptionRow {
  id: string;
  poll_id: string;
  starts_on: string;
  ends_on: string;
  label: string | null;
  description: string | null;
  payload_json: string;
  position: number;
}

export interface DatePollInviteeRow {
  poll_id: string;
  player_id: string;
  invited_at: number;
  last_reminder_at: number | null;
  automatic_reminder_stage: number;
  automatic_reminder_due_at: number | null;
}

export interface DatePollResponseRow {
  poll_id: string;
  option_id: string;
  player_id: string;
  response: DatePollResponseValue;
  updated_at: number;
}

export function getDatePolls(eventId: string): DatePollRow[] {
  return db
    .prepare('SELECT * FROM event_date_polls WHERE event_id = ? ORDER BY round_number DESC')
    .all(eventId) as DatePollRow[];
}

export function getDatePoll(pollId: string): DatePollRow | undefined {
  return db.prepare('SELECT * FROM event_date_polls WHERE id = ?').get(pollId) as DatePollRow | undefined;
}

export function getDatePollForEvent(eventId: string, pollId: string): DatePollRow | undefined {
  const poll = getDatePoll(pollId);
  return poll && poll.event_id === eventId ? poll : undefined;
}

export function getDatePollOptions(pollId: string): DatePollOptionRow[] {
  return db
    .prepare('SELECT * FROM event_date_poll_options WHERE poll_id = ? ORDER BY position ASC, id ASC')
    .all(pollId) as DatePollOptionRow[];
}

export function getDatePollInvitees(pollId: string): DatePollInviteeRow[] {
  return db
    .prepare('SELECT * FROM event_date_poll_invitees WHERE poll_id = ? ORDER BY invited_at ASC')
    .all(pollId) as DatePollInviteeRow[];
}

export function getDatePollResponses(pollId: string): DatePollResponseRow[] {
  return db.prepare('SELECT * FROM event_date_poll_responses WHERE poll_id = ?').all(pollId) as DatePollResponseRow[];
}

export function isDatePollInvitee(pollId: string, playerId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?').get(pollId, playerId),
  );
}

// A person "has answered" a round once they have a concrete response for
// every option. In feasibility mode an explicitly selected "Offen" is stored
// as no response, so the person remains incomplete and eligible for reminders.
export function hasAnsweredDatePoll(pollId: string, playerId: string): boolean {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM event_date_poll_options WHERE poll_id = ?) AS optionCount,
         (SELECT COUNT(*) FROM event_date_poll_responses WHERE poll_id = ? AND player_id = ?) AS responseCount`,
    )
    .get(pollId, pollId, playerId) as { optionCount: number; responseCount: number };
  return row.optionCount > 0 && row.optionCount === row.responseCount;
}

// ---------- permissions ----------

// The poll's recorded creator manages its rounds; if that account is gone or
// inactive, the group owner is the sole, audited fallback.
export function canManageDatePoll(
  poll: DatePollRow,
  event: EventRow,
  viewerId: string | undefined,
  viewerRole: 'owner' | 'admin' | 'member' | undefined,
): boolean {
  if (!viewerId) return false;
  const isParticipant = db
    .prepare(
      `SELECT 1 FROM event_participants ep
       WHERE ep.event_id = ? AND ep.player_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
    )
    .get(event.id, viewerId);
  if (!isParticipant) return false;
  if (poll.created_by === viewerId) return true;
  if (viewerRole !== 'owner') return false;
  if (!poll.created_by) return true;
  const activeCreator = db
    .prepare(
      `SELECT 1
       FROM players p
       JOIN group_memberships gm ON gm.player_id = p.id
       WHERE p.id = ? AND p.deactivated_at IS NULL
         AND gm.group_id = ? AND gm.status = 'active'`,
    )
    .get(poll.created_by, event.group_id);
  return !activeCreator;
}

// ---------- lazy deadline expiry ----------

export interface MaterializeResult {
  poll: DatePollRow;
  // true only for the single request that actually performed the open ->
  // closed transition — that's the caller's cue to also audit + broadcast.
  transitioned: boolean;
}

// Idempotent, race-safe lazy close: the first authenticated request to see
// an expired open round flips it, clears its pending automatic reminders and
// reports transitioned:true; any concurrent or later request sees the
// already-closed row and reports transitioned:false. No push is sent for
// this transition (only a realtime signal, from the route layer).
export function materializeExpiredPollIfNeeded(pollId: string, now = Date.now()): MaterializeResult | undefined {
  return db.transaction((): MaterializeResult | undefined => {
    const poll = getDatePoll(pollId);
    if (!poll) return undefined;
    if (poll.status !== 'open' || poll.response_due_at > now) return { poll, transitioned: false };

    const updated = db
      .prepare(`UPDATE event_date_polls SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'open'`)
      .run(now, pollId);
    if (updated.changes !== 1) {
      // Lost the race to another concurrent request — re-read its result.
      return { poll: getDatePoll(pollId)!, transitioned: false };
    }
    clearAutomaticReminders(pollId);
    return { poll: getDatePoll(pollId)!, transitioned: true };
  })();
}

function clearAutomaticReminders(pollId: string): void {
  db.prepare(
    `UPDATE event_date_poll_invitees
     SET automatic_reminder_due_at = NULL
     WHERE poll_id = ?`,
  ).run(pollId);
}

// ---------- creating a round ----------

export interface DatePollOptionInput {
  startsOn?: string;
  endsOn?: string;
  label?: string;
  description?: string | null;
  payload?: Record<string, unknown>;
}

export interface CreateDatePollInput {
  options: DatePollOptionInput[];
  responseDueOn: string;
  note?: string | null;
  inviteePlayerIds: string[];
  topic?: EventPollTopic;
  decisionKey?: string;
  title?: string;
  responseMode?: EventPollResponseMode;
  maxSelections?: number | null;
  anonymous?: boolean;
}

export type CreateDatePollResult =
  | { ok: true; poll: DatePollRow }
  | { ok: false; code: 'conflict' | 'invalid'; error: string };

export function createDatePoll(event: EventRow, input: CreateDatePollInput, createdBy: string): CreateDatePollResult {
  const now = Date.now();
  const responseDueAt = endOfIsoDateUtcMs(input.responseDueOn);
  if (responseDueAt <= now) {
    return { ok: false, code: 'invalid', error: 'responseDueOn muss in der Zukunft liegen.' };
  }
  return db.transaction((): CreateDatePollResult => {
    const topic = input.topic ?? 'date_range';
    const decisionKey = input.decisionKey ?? (topic === 'date_range' ? 'date' : nanoid(12));
    const title = input.title?.trim() || (topic === 'date_range' ? 'Termin / Zeitraum' : 'Abstimmung');
    const responseMode = input.responseMode ?? 'feasibility';
    const maxSelections = responseMode === 'multiple_choice' ? (input.maxSelections ?? null) : null;
    const existingUndecided = db
      .prepare(`SELECT 1 FROM event_date_polls WHERE event_id = ? AND decision_key = ? AND status IN ('open', 'closed')`)
      .get(event.id, decisionKey);
    if (existingUndecided) {
      return { ok: false, code: 'conflict', error: 'Für diese Entscheidung läuft bereits eine Abstimmung.' };
    }
    const nextRound = (
      db.prepare(
        'SELECT COALESCE(MAX(round_number), 0) + 1 AS n FROM event_date_polls WHERE event_id = ? AND decision_key = ?',
      ).get(
        event.id,
        decisionKey,
      ) as { n: number }
    ).n;

    const pollId = nanoid();
    db.prepare(
      `INSERT INTO event_date_polls
         (id, event_id, round_number, note, created_by, response_due_at, status, created_at, updated_at,
          topic, decision_key, title, response_mode, max_selections, is_anonymous)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pollId,
      event.id,
      nextRound,
      input.note ?? null,
      createdBy,
      responseDueAt,
      now,
      now,
      topic,
      decisionKey,
      title,
      responseMode,
      maxSelections,
      input.anonymous ? 1 : 0,
    );

    const insertOption = db.prepare(
      `INSERT INTO event_date_poll_options
         (id, poll_id, starts_on, ends_on, position, label, description, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.options.forEach((option, index) => {
      const startsOn = option.startsOn ?? `0001-01-${String(index + 1).padStart(2, '0')}`;
      const endsOn = option.endsOn ?? startsOn;
      const label = option.label?.trim() || (startsOn === endsOn ? startsOn : `${startsOn} – ${endsOn}`);
      const payload = topic === 'date_range' ? { startsOn, endsOn, ...option.payload } : (option.payload ?? {});
      insertOption.run(nanoid(), pollId, startsOn, endsOn, index, label, option.description ?? null, JSON.stringify(payload));
    });

    insertInvitees(pollId, input.inviteePlayerIds, now, responseDueAt);

    return { ok: true, poll: getDatePoll(pollId)! };
  })();
}

function insertInvitees(pollId: string, playerIds: string[], now: number, responseDueAt: number): void {
  const insertInvitee = db.prepare(
    `INSERT INTO event_date_poll_invitees
       (poll_id, player_id, invited_at, automatic_reminder_stage, automatic_reminder_due_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(poll_id, player_id) DO NOTHING`,
  );
  const plan = initialReminderPlan(responseDueAt, now);
  for (const playerId of new Set(playerIds)) {
    insertInvitee.run(pollId, playerId, now, plan.stage, plan.dueAt);
  }
}

// ---------- automatic reminder scheduling ----------

interface ReminderPlan {
  stage: number;
  dueAt: number | null;
}

// Picks the next sensible automatic-reminder stage relative to `now`: the
// 48h-before mark if that's still ahead, otherwise the 2h-before mark if that's
// still ahead, otherwise no automatic reminder at all ("Bei später Erstellung
// wird nur die nächste sinnvolle Stufe versendet").
function initialReminderPlan(responseDueAt: number, now: number): ReminderPlan {
  const at48h = responseDueAt - REMINDER_48H_BEFORE_MS;
  if (at48h > now) return { stage: STAGE_NONE, dueAt: at48h };
  const at2h = responseDueAt - REMINDER_2H_BEFORE_MS;
  if (at2h > now) return { stage: STAGE_48H, dueAt: at2h };
  return { stage: STAGE_2H, dueAt: null };
}

// After sending stage `sentStage`'s reminder, this is the plan for whatever
// comes next (only the 2h-before stage, or nothing left).
function nextReminderPlan(responseDueAt: number, sentStage: number, now: number): ReminderPlan {
  if (sentStage === STAGE_48H) {
    const at2h = responseDueAt - REMINDER_2H_BEFORE_MS;
    if (at2h > now) return { stage: STAGE_48H, dueAt: at2h };
  }
  return { stage: STAGE_2H, dueAt: null };
}

// ---------- metadata / due date changes ----------

export type PollMutationResult =
  | { ok: true; poll: DatePollRow }
  | { ok: false; code: 'not_open' | 'invalid'; error: string };

export interface UpdateDatePollFields {
  note?: string | null;
  responseDueOn?: string;
}

export function updateDatePollMeta(poll: DatePollRow, fields: UpdateDatePollFields): PollMutationResult {
  if (poll.status !== 'open') {
    return { ok: false, code: 'not_open', error: 'Metadaten können nur während einer offenen Runde geändert werden.' };
  }
  const now = Date.now();
  if (fields.responseDueOn !== undefined && endOfIsoDateUtcMs(fields.responseDueOn) <= now) {
    return { ok: false, code: 'invalid', error: 'responseDueOn muss in der Zukunft liegen.' };
  }
  return db.transaction((): PollMutationResult => {
    const note = fields.note !== undefined ? fields.note : poll.note;
    const responseDueAt = fields.responseDueOn !== undefined ? endOfIsoDateUtcMs(fields.responseDueOn) : poll.response_due_at;
    db.prepare('UPDATE event_date_polls SET note = ?, response_due_at = ?, updated_at = ? WHERE id = ?').run(
      note,
      responseDueAt,
      now,
      poll.id,
    );
    if (fields.responseDueOn !== undefined && responseDueAt !== poll.response_due_at) {
      rescheduleRemindersForStillOpenInvitees(poll.id, responseDueAt, now);
    }
    return { ok: true, poll: getDatePoll(poll.id)! };
  })();
}

// A due-date extension recalculates the plan from scratch for everyone who
// hasn't fully answered yet — including re-arming the 48h stage even if it
// already fired against the old deadline, since "the plan is recalculated"
// and earlier sends only stay in history, never blocking a fresh stage.
function rescheduleRemindersForStillOpenInvitees(pollId: string, responseDueAt: number, now: number): void {
  const invitees = getDatePollInvitees(pollId);
  const plan = initialReminderPlan(responseDueAt, now);
  const update = db.prepare(
    'UPDATE event_date_poll_invitees SET automatic_reminder_stage = ?, automatic_reminder_due_at = ? WHERE poll_id = ? AND player_id = ?',
  );
  for (const invitee of invitees) {
    if (hasAnsweredDatePoll(pollId, invitee.player_id)) continue;
    update.run(plan.stage, plan.dueAt, pollId, invitee.player_id);
  }
}

// ---------- options ----------

export type OptionMutationResult =
  | { ok: true; option: DatePollOptionRow }
  | { ok: false; code: 'not_open' | 'invalid'; error: string };

export function addDatePollOption(poll: DatePollRow, input: DatePollOptionInput): OptionMutationResult {
  if (poll.status !== 'open') {
    return { ok: false, code: 'not_open', error: 'Optionen können nur während einer offenen Runde ergänzt werden.' };
  }
  const existing = getDatePollOptions(poll.id);
  if (existing.length >= MAX_OPTIONS) {
    return { ok: false, code: 'invalid', error: `Höchstens ${MAX_OPTIONS} Optionen je Abstimmung.` };
  }
  const position = existing.reduce((max, o) => Math.max(max, o.position), -1) + 1;
  const startsOn = input.startsOn ?? `0001-01-${String(position + 1).padStart(2, '0')}`;
  const endsOn = input.endsOn ?? startsOn;
  const label = input.label?.trim() || (startsOn === endsOn ? startsOn : `${startsOn} – ${endsOn}`);
  if (existing.some((o) => (o.label ?? '').toLocaleLowerCase('de') === label.toLocaleLowerCase('de'))) {
    return { ok: false, code: 'invalid', error: 'Diese Option ist bereits vorhanden.' };
  }
  const id = nanoid();
  db.prepare(
    `INSERT INTO event_date_poll_options
       (id, poll_id, starts_on, ends_on, position, label, description, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    poll.id,
    startsOn,
    endsOn,
    position,
    label,
    input.description ?? null,
    JSON.stringify(input.payload ?? {}),
  );
  db.prepare('UPDATE event_date_polls SET updated_at = ? WHERE id = ?').run(Date.now(), poll.id);
  return { ok: true, option: db.prepare('SELECT * FROM event_date_poll_options WHERE id = ?').get(id) as DatePollOptionRow };
}

export type RemoveOptionResult =
  | { ok: true }
  | { ok: false; code: 'not_open' | 'not_found' | 'invalid'; error: string };

export function removeDatePollOption(poll: DatePollRow, optionId: string): RemoveOptionResult {
  if (poll.status !== 'open') {
    return { ok: false, code: 'not_open', error: 'Optionen können nur während einer offenen Runde entfernt werden.' };
  }
  const options = getDatePollOptions(poll.id);
  if (!options.some((o) => o.id === optionId)) {
    return { ok: false, code: 'not_found', error: 'Option nicht gefunden.' };
  }
  if (options.length <= MIN_OPTIONS) {
    return { ok: false, code: 'invalid', error: `Mindestens ${MIN_OPTIONS} Optionen müssen erhalten bleiben.` };
  }
  db.transaction(() => {
    db.prepare('DELETE FROM event_date_poll_options WHERE id = ?').run(optionId);
    db.prepare('UPDATE event_date_polls SET updated_at = ? WHERE id = ?').run(Date.now(), poll.id);
  })();
  return { ok: true };
}

// ---------- invitees ----------

export type InviteeMutationResult =
  | { ok: true }
  | { ok: false; code: 'not_open' | 'not_found'; error: string };

export function addDatePollInvitee(poll: DatePollRow, playerId: string): InviteeMutationResult {
  if (poll.status !== 'open') {
    return { ok: false, code: 'not_open', error: 'Eingeladene können nur während einer offenen Runde ergänzt werden.' };
  }
  const now = Date.now();
  insertInvitees(poll.id, [playerId], now, poll.response_due_at);
  return { ok: true };
}

export function removeDatePollInvitee(poll: DatePollRow, playerId: string): InviteeMutationResult {
  if (poll.status !== 'open') {
    return { ok: false, code: 'not_open', error: 'Eingeladene können nur während einer offenen Runde entfernt werden.' };
  }
  const removed = db.prepare('DELETE FROM event_date_poll_invitees WHERE poll_id = ? AND player_id = ?').run(
    poll.id,
    playerId,
  );
  if (removed.changes === 0) return { ok: false, code: 'not_found', error: 'Person ist nicht eingeladen.' };
  db.prepare('UPDATE event_date_polls SET updated_at = ? WHERE id = ?').run(Date.now(), poll.id);
  return { ok: true };
}

// ---------- responses ----------

export type SubmitResponsesResult =
  | { ok: true }
  | { ok: false; code: 'not_open' | 'not_invitee' | 'invalid'; error: string };

export function submitMyResponses(
  poll: DatePollRow,
  playerId: string,
  responses: Array<{ optionId: string; response: DatePollResponseValue }>,
): SubmitResponsesResult {
  if (poll.status !== 'open') {
    return { ok: false, code: 'not_open', error: 'Antworten sind nur während einer offenen Runde möglich.' };
  }
  if (!isDatePollInvitee(poll.id, playerId)) {
    return { ok: false, code: 'not_invitee', error: 'Für diese Runde liegt keine Einladung vor.' };
  }
  const options = getDatePollOptions(poll.id);
  const optionIds = new Set(options.map((o) => o.id));
  const providedIds = new Set(responses.map((r) => r.optionId));
  const allowedResponses = poll.response_mode === 'rating_1_5'
    ? RATING_RESPONSE_VALUES
    : poll.response_mode === 'feasibility'
      ? FEASIBILITY_RESPONSE_VALUES
      : (['can', 'cannot'] as DatePollResponseValue[]);
  if (
    providedIds.size !== responses.length ||
    ![...providedIds].every((id) => optionIds.has(id)) ||
    !responses.every((r) => allowedResponses.includes(r.response))
  ) {
    return { ok: false, code: 'invalid', error: 'Jede übermittelte Option benötigt genau eine gültige Antwort.' };
  }
  if (poll.response_mode !== 'feasibility' && responses.length !== options.length) {
    return { ok: false, code: 'invalid', error: 'Es muss für jede Option genau eine gültige Antwort angegeben werden.' };
  }
  if (poll.response_mode === 'single_choice' && responses.filter((response) => response.response === 'can').length !== 1) {
    return { ok: false, code: 'invalid', error: 'Bei dieser Abstimmung muss genau eine Option ausgewählt werden.' };
  }
  if (poll.response_mode === 'multiple_choice' && responses.some((response) => response.response === 'if_needed')) {
    return { ok: false, code: 'invalid', error: 'Mehrfachauswahlen verwenden nur ausgewählt oder nicht ausgewählt.' };
  }
  if (poll.response_mode === 'multiple_choice') {
    const selectedCount = responses.filter((response) => response.response === 'can').length;
    if (selectedCount < 1) {
      return { ok: false, code: 'invalid', error: 'Bitte mindestens eine Option auswählen.' };
    }
    if (poll.max_selections !== null && selectedCount > poll.max_selections) {
      return { ok: false, code: 'invalid', error: `Höchstens ${poll.max_selections} Optionen dürfen ausgewählt werden.` };
    }
  }

  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO event_date_poll_responses (poll_id, option_id, player_id, response, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(poll_id, option_id, player_id) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM event_date_poll_responses WHERE poll_id = ? AND player_id = ?').run(poll.id, playerId);
    for (const r of responses) upsert.run(poll.id, r.optionId, playerId, r.response, now);
  })();
  return { ok: true };
}

// ---------- close / reopen / cancel / schedule ----------

export function closeDatePoll(poll: DatePollRow): PollMutationResult {
  const now = Date.now();
  return db.transaction((): PollMutationResult => {
    const updated = db.prepare(`UPDATE event_date_polls SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'open'`).run(
      now,
      poll.id,
    );
    if (updated.changes !== 1) {
      return { ok: false, code: 'not_open', error: 'Die Abstimmung läuft nicht mehr.' };
    }
    clearAutomaticReminders(poll.id);
    return { ok: true, poll: getDatePoll(poll.id)! };
  })();
}

export type ReopenResult =
  | { ok: true; poll: DatePollRow }
  | { ok: false; code: 'not_closed' | 'invalid'; error: string };

export function reopenDatePoll(poll: DatePollRow, responseDueOn: string | undefined): ReopenResult {
  const now = Date.now();
  let responseDueAt = poll.response_due_at;
  if (responseDueOn !== undefined) {
    responseDueAt = endOfIsoDateUtcMs(responseDueOn);
  }
  if (responseDueAt <= now) {
    return {
      ok: false,
      code: 'invalid',
      error: 'Zum Wiederöffnen wird eine neue, zukünftige Frist benötigt.',
    };
  }
  return db.transaction((): ReopenResult => {
    const updated = db
      .prepare(`UPDATE event_date_polls SET status = 'open', response_due_at = ?, updated_at = ? WHERE id = ? AND status = 'closed'`)
      .run(responseDueAt, now, poll.id);
    if (updated.changes !== 1) {
      return { ok: false, code: 'not_closed', error: 'Die Abstimmung ist nicht beendet.' };
    }
    rescheduleRemindersForStillOpenInvitees(poll.id, responseDueAt, now);
    return { ok: true, poll: getDatePoll(poll.id)! };
  })();
}

export type CancelResult =
  | { ok: true; poll: DatePollRow }
  | { ok: false; code: 'not_open_or_closed'; error: string };

export function cancelDatePoll(poll: DatePollRow): CancelResult {
  const now = Date.now();
  return db.transaction((): CancelResult => {
    const updated = db
      .prepare(`UPDATE event_date_polls SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('open', 'closed')`)
      .run(now, poll.id);
    if (updated.changes !== 1) {
      return { ok: false, code: 'not_open_or_closed', error: 'Die Abstimmung kann in diesem Zustand nicht abgebrochen werden.' };
    }
    clearAutomaticReminders(poll.id);
    return { ok: true, poll: getDatePoll(poll.id)! };
  })();
}

export type DecidePollResult =
  | { ok: true; poll: DatePollRow; changed: boolean; previousValue: string | null; nextValue: string }
  | { ok: false; code: 'not_open_or_closed' | 'invalid'; error: string };

// Records a planning result without changing the event itself. Poll results
// deliberately stay separate from dates, location, costs and participation;
// a future explicit "apply to event" workflow can bridge that boundary.
export function decideEventPoll(
  poll: DatePollRow,
  optionIds: string[],
  decisionNote?: string | null,
): DecidePollResult {
  const uniqueIds = [...new Set(optionIds)];
  if (
    uniqueIds.length === 0 ||
    (poll.topic === 'date_range' && uniqueIds.length !== 1) ||
    (poll.response_mode !== 'multiple_choice' && uniqueIds.length !== 1)
  ) {
    return { ok: false, code: 'invalid', error: 'Bitte eine gültige Auswahl festlegen.' };
  }
  if (poll.max_selections !== null && uniqueIds.length > poll.max_selections) {
    return { ok: false, code: 'invalid', error: `Höchstens ${poll.max_selections} Optionen dürfen festgehalten werden.` };
  }
  const options = getDatePollOptions(poll.id);
  if (!uniqueIds.every((id) => options.some((option) => option.id === id))) {
    return { ok: false, code: 'invalid', error: 'Mindestens eine Option gehört nicht zu dieser Abstimmung.' };
  }
  const nextValue = uniqueIds
    .map((id) => options.find((option) => option.id === id)?.label ?? id)
    .join(', ');
  const previousSelection = db
    .prepare(
      `SELECT edpo.label, edpo.starts_on AS startsOn, edpo.ends_on AS endsOn
       FROM event_poll_selected_options epso
       JOIN event_date_poll_options edpo ON edpo.id = epso.option_id
       WHERE epso.poll_id = ? ORDER BY epso.position`,
    )
    .all(poll.id) as Array<{ label: string | null; startsOn: string; endsOn: string }>;
  const previousValue = previousSelection.length
    ? previousSelection.map((option) => option.label ?? `${option.startsOn} – ${option.endsOn}`).join(', ')
    : null;
  const now = Date.now();
  return db.transaction((): DecidePollResult => {
    const current = getDatePoll(poll.id)!;
    const selected = db
      .prepare('SELECT option_id AS optionId FROM event_poll_selected_options WHERE poll_id = ? ORDER BY position')
      .all(poll.id) as Array<{ optionId: string }>;
    if (current.status === 'scheduled' && selected.map((row) => row.optionId).join(',') === uniqueIds.join(',')) {
      return { ok: true, poll: current, changed: false, previousValue, nextValue };
    }
    if (current.status !== 'closed') {
      return { ok: false, code: 'not_open_or_closed', error: 'Vor dem Festhalten eines Ergebnisses muss die Abstimmung beendet werden.' };
    }
    db.prepare(
      `UPDATE event_date_polls SET status = 'superseded'
       WHERE event_id = ? AND decision_key = ? AND status = 'scheduled' AND id != ?`,
    ).run(poll.event_id, poll.decision_key, poll.id);
    db.prepare(
      `UPDATE event_date_polls
       SET status = 'scheduled', selected_option_id = ?, decision_note = ?, updated_at = ?
       WHERE id = ?`,
    ).run(uniqueIds[0], decisionNote?.trim() || null, now, poll.id);
    db.prepare('DELETE FROM event_poll_selected_options WHERE poll_id = ?').run(poll.id);
    const insertSelected = db.prepare(
      'INSERT INTO event_poll_selected_options (poll_id, option_id, position) VALUES (?, ?, ?)',
    );
    uniqueIds.forEach((id, position) => insertSelected.run(poll.id, id, position));
    clearAutomaticReminders(poll.id);
    return { ok: true, poll: getDatePoll(poll.id)!, changed: true, previousValue, nextValue };
  })();
}

// ---------- manual reminders ----------

export interface ReminderCandidate {
  playerId: string;
}

// "Offene erinnern": everyone invited who hasn't fully answered yet AND is
// past the shared 24h minimum spacing since their last reminder (automatic
// or manual — last_reminder_at is the single shared clock for both).
export function reminderCandidates(pollId: string, now = Date.now()): ReminderCandidate[] {
  const invitees = getDatePollInvitees(pollId);
  return invitees
    .filter((invitee) => !hasAnsweredDatePoll(pollId, invitee.player_id))
    .filter((invitee) => invitee.last_reminder_at === null || now - invitee.last_reminder_at >= REMINDER_MIN_INTERVAL_MS)
    .map((invitee) => ({ playerId: invitee.player_id }));
}

export function markReminderSent(pollId: string, playerId: string, now = Date.now()): void {
  db.prepare('UPDATE event_date_poll_invitees SET last_reminder_at = ? WHERE poll_id = ? AND player_id = ?').run(
    now,
    pollId,
    playerId,
  );
}

// ---------- automatic reminder sweep ----------

export interface DueAutomaticReminder {
  pollId: string;
  eventId: string;
  playerId: string;
  stage: number;
}

export function dueAutomaticReminders(now = Date.now()): DueAutomaticReminder[] {
  const rows = db
    .prepare(
      `SELECT edpi.poll_id AS pollId, edp.event_id AS eventId, edpi.player_id AS playerId,
              edpi.automatic_reminder_due_at AS dueAt, edpi.automatic_reminder_stage AS stage
       FROM event_date_poll_invitees edpi
       JOIN event_date_polls edp ON edp.id = edpi.poll_id
       JOIN event_participants ep ON ep.event_id = edp.event_id AND ep.player_id = edpi.player_id
       WHERE edp.status = 'open'
         AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         AND edpi.automatic_reminder_due_at IS NOT NULL
         AND edpi.automatic_reminder_due_at <= ?`,
    )
    .all(now) as Array<{
    pollId: string;
    eventId: string;
    playerId: string;
    dueAt: number;
    stage: number;
  }>;
  return rows
    .filter((row) => !hasAnsweredDatePoll(row.pollId, row.playerId))
    // Manual sends must not suppress either promised automatic stage. Each
    // stage is intrinsically one-shot because advanceAutomaticReminder moves
    // its due timestamp forward (or clears it) immediately after delivery.
    .map((row) => ({ pollId: row.pollId, eventId: row.eventId, playerId: row.playerId, stage: row.stage + 1 }));
}

// Records that the automatic reminder for `stage` was sent and schedules
// whatever comes next (or nothing, once the 2h-before stage is done).
export function advanceAutomaticReminder(pollId: string, playerId: string, sentStage: number, now = Date.now()): void {
  const poll = getDatePoll(pollId);
  if (!poll) return;
  const plan = nextReminderPlan(poll.response_due_at, sentStage, now);
  db.prepare(
    `UPDATE event_date_poll_invitees
     SET last_reminder_at = ?, automatic_reminder_stage = ?, automatic_reminder_due_at = ?
     WHERE poll_id = ? AND player_id = ?`,
  ).run(now, sentStage, plan.dueAt, pollId, playerId);
}

// ---------- recommendation ("Beste Abdeckung") ----------

export interface OptionCounts {
  can: number;
  ifNeeded: number;
  cannot: number;
  open: number;
  ratings: Record<'1' | '2' | '3' | '4' | '5', number>;
  average: number | null;
}

export function optionCounts(option: DatePollOptionRow, responses: DatePollResponseRow[], inviteeCount: number): OptionCounts {
  const forOption = responses.filter((r) => r.option_id === option.id);
  const can = forOption.filter((r) => r.response === 'can').length;
  const ifNeeded = forOption.filter((r) => r.response === 'if_needed').length;
  const cannot = forOption.filter((r) => r.response === 'cannot').length;
  const ratings = {
    '1': forOption.filter((r) => r.response === '1').length,
    '2': forOption.filter((r) => r.response === '2').length,
    '3': forOption.filter((r) => r.response === '3').length,
    '4': forOption.filter((r) => r.response === '4').length,
    '5': forOption.filter((r) => r.response === '5').length,
  };
  const ratingCount = Object.values(ratings).reduce((sum, count) => sum + count, 0);
  const ratingSum = Object.entries(ratings).reduce((sum, [value, count]) => sum + Number(value) * count, 0);
  return {
    can,
    ifNeeded,
    cannot,
    open: Math.max(0, inviteeCount - forOption.length),
    ratings,
    average: ratingCount > 0 ? ratingSum / ratingCount : null,
  };
}

// Stable "Beste Abdeckung" sort, exactly per the concept's tie-break chain:
// most "Kann", then most "Kann"+"Wenn nötig", then fewest "Kann nicht",
// then earliest start, then earliest end, then lowest stored position, then
// lowest id as the final deterministic tiebreak.
export function recommendedOptionId(
  options: DatePollOptionRow[],
  responses: DatePollResponseRow[],
  inviteeCount: number,
  responseMode: EventPollResponseMode = 'feasibility',
): string | undefined {
  if (options.length === 0 || responses.length === 0) return undefined;
  const ranked = [...options].sort((a, b) => {
    const countsA = optionCounts(a, responses, inviteeCount);
    const countsB = optionCounts(b, responses, inviteeCount);
    if (responseMode === 'rating_1_5') {
      const averageA = countsA.average ?? -1;
      const averageB = countsB.average ?? -1;
      if (averageA !== averageB) return averageB - averageA;
      const ratingCountA = Object.values(countsA.ratings).reduce((sum, count) => sum + count, 0);
      const ratingCountB = Object.values(countsB.ratings).reduce((sum, count) => sum + count, 0);
      if (ratingCountA !== ratingCountB) return ratingCountB - ratingCountA;
    }
    if (countsA.can !== countsB.can) return countsB.can - countsA.can;
    const combinedA = countsA.can + countsA.ifNeeded;
    const combinedB = countsB.can + countsB.ifNeeded;
    if (combinedA !== combinedB) return combinedB - combinedA;
    if (countsA.cannot !== countsB.cannot) return countsA.cannot - countsB.cannot;
    if (a.starts_on !== b.starts_on) return a.starts_on < b.starts_on ? -1 : 1;
    if (a.ends_on !== b.ends_on) return a.ends_on < b.ends_on ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return ranked[0]?.id;
}
