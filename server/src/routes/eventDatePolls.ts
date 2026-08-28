// Event poll routes (docs/plans/event-date-poll-concept.md), nested under
// /api/events/:eventId/polls. HTTP/validation/auth layer only — the actual
// state machine lives in eventDatePolls.ts (legacy internal name).

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { BASE_EVENT_ID, db } from '../db';
import { getEvent, type EventRow } from '../events';
import { resolveGroupResource } from '../groupAuthorization';
import { writeAdminAudit } from '../adminAudit';
import { broadcast, Events } from '../realtime';
import {
  EVENT_POLL_REMINDER_TOPIC_PREFIX,
  EVENT_POLL_OPEN_TOPIC_PREFIX,
  notifyPlayers,
  resolvePushTopic,
  updatePushTopicExpiry,
} from '../push';
import { isValidIsoDate } from '../localDate';
import type { GroupRole } from '../groups';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from '../eventParticipation';
import { isAdminTestMode } from '../testDataVisibility';
import {
  RESPONSE_VALUES,
  canManageDatePoll,
  materializeExpiredPollIfNeeded,
  getDatePolls,
  getDatePollForEvent,
  getDatePollOptions,
  getDatePollInvitees,
  getDatePollResponses,
  isDatePollInvitee,
  hasAnsweredDatePoll,
  createDatePoll,
  updateDatePoll,
  addDatePollOption,
  addDatePollInvitee,
  submitMyResponses,
  closeDatePoll,
  reopenDatePoll,
  deleteDatePollSeries,
  reminderCandidates,
  markReminderSent,
  optionCounts,
  recommendedOptionId,
  type DatePollRow,
  type DatePollResponseValue,
  type EventPollTopic,
  type EventPollResponseMode,
} from '../eventDatePolls';

export const eventDatePollsRouter = Router({ mergeParams: true });

const resolveEventResourceForPolls = resolveGroupResource<EventRow>({
  resourceType: 'Event',
  paramName: 'eventId',
  load: (id) => {
    const event = getEvent(id);
    return event ? { resource: event, groupId: event.group_id } : undefined;
  },
});

const resolveEventForPolls: RequestHandler = (req, res, next) => {
  resolveEventResourceForPolls(req, res, () => {
    const event = req.groupResource as EventRow;
    if (event.is_test && !isAdminTestMode(req)) {
      res.status(404).json({ error: 'Event nicht gefunden.' });
      return;
    }
    next();
  });
};

interface PlayerNameRow {
  id: string;
  name: string;
}

function playerNames(playerIds: string[]): Map<string, string> {
  if (playerIds.length === 0) return new Map();
  const uniqueIds = [...new Set(playerIds)];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, name FROM players WHERE id IN (${placeholders})`).all(...uniqueIds) as PlayerNameRow[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

function acceptedParticipantIds(eventId: string): string[] {
  return (
    db
      .prepare(
        `SELECT ep.player_id AS playerId
         FROM event_participants ep
         JOIN players p ON p.id = ep.player_id
         WHERE ep.event_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
           AND p.deactivated_at IS NULL
         ORDER BY p.name COLLATE NOCASE`,
      )
      .all(eventId) as Array<{ playerId: string }>
  ).map((row) => row.playerId);
}

function hasAcceptedParticipation(eventId: string, playerId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM event_participants ep
         WHERE ep.event_id = ? AND ep.player_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
      )
      .get(eventId, playerId),
  );
}

function canReadPoll(event: EventRow, viewerId: string): boolean {
  return hasAcceptedParticipation(event.id, viewerId);
}

function ensureOpenPollRoster(poll: DatePollRow, event: EventRow): void {
  if (poll.status !== 'open') return;
  for (const playerId of acceptedParticipantIds(event.id)) addDatePollInvitee(poll, playerId);
}

function serializeOption(
  option: {
    id: string;
    poll_id: string;
    starts_on: string;
    ends_on: string;
    position: number;
    label: string | null;
    description: string | null;
    payload_json: string;
  },
  responses: ReturnType<typeof getDatePollResponses>,
  inviteeCount: number,
  names: Map<string, string>,
  isRecommended: boolean,
  includeResponsePeople: boolean,
) {
  const forOption = responses.filter((r) => r.option_id === option.id);
  const byResponse = (value: DatePollResponseValue) =>
    includeResponsePeople ? forOption
      .filter((r) => r.response === value)
      .map((r) => ({ playerId: r.player_id, name: names.get(r.player_id) ?? r.player_id, updatedAt: r.updated_at })) : [];
  const answeredIds = new Set(forOption.map((r) => r.player_id));
  const counts = optionCounts(option, responses, inviteeCount);
  return {
    id: option.id,
    label: option.label,
    description: option.description,
    payload: JSON.parse(option.payload_json || '{}') as unknown,
    startsOn: option.starts_on,
    endsOn: option.ends_on,
    position: option.position,
    counts: {
      can: counts.can,
      ifNeeded: counts.ifNeeded,
      cannot: counts.cannot,
      open: counts.open,
      ratings: counts.ratings,
      average: counts.average,
    },
    people: {
      can: byResponse('can'),
      ifNeeded: byResponse('if_needed'),
      cannot: byResponse('cannot'),
      ratings: {
        '1': byResponse('1'),
        '2': byResponse('2'),
        '3': byResponse('3'),
        '4': byResponse('4'),
        '5': byResponse('5'),
      },
    },
    isRecommended,
    _answeredIds: answeredIds,
  };
}

function serializeDatePoll(
  poll: DatePollRow,
  event: EventRow,
  viewerId: string,
  viewerRole: GroupRole | undefined,
) {
  ensureOpenPollRoster(poll, event);
  const options = getDatePollOptions(poll.id);
  const storedInvitees = getDatePollInvitees(poll.id);
  const currentParticipantIds = new Set(acceptedParticipantIds(event.id));
  const invitees = poll.status === 'open'
    ? storedInvitees.filter((invitee) => currentParticipantIds.has(invitee.player_id))
    : storedInvitees;
  const allResponses = getDatePollResponses(poll.id);
  const responses = poll.status === 'open'
    ? allResponses.filter((response) => currentParticipantIds.has(response.player_id))
    : allResponses;
  const names = playerNames([
    ...invitees.map((i) => i.player_id),
    ...(poll.created_by ? [poll.created_by] : []),
  ]);
  const recommendedId = recommendedOptionId(options, responses, invitees.length, poll.response_mode);
  const anonymous = Boolean(poll.is_anonymous);
  const responseDetailsVisible = poll.status !== 'open' && !anonymous;

  const serializedOptions = options.map((option) =>
    serializeOption(option, responses, invitees.length, names, option.id === recommendedId, responseDetailsVisible),
  );
  const answeredPlayerIds = new Set(responses.map((r) => r.player_id));
  const myResponses: Record<string, DatePollResponseValue> = {};
  for (const response of responses) {
    if (response.player_id === viewerId) myResponses[response.option_id] = response.response;
  }

  return {
    id: poll.id,
    eventId: poll.event_id,
    roundNumber: poll.round_number,
    topic: poll.topic,
    decisionKey: poll.decision_key,
    title: poll.title,
    responseMode: poll.response_mode,
    maxSelections: poll.max_selections,
    anonymous,
    responseDetailsVisible,
    note: poll.note,
    createdBy: poll.created_by,
    createdByName: poll.created_by ? names.get(poll.created_by) ?? null : null,
    responseDueAt: poll.response_due_at,
    status: poll.status,
    createdAt: poll.created_at,
    updatedAt: poll.updated_at,
    options: serializedOptions.map(({ _answeredIds, ...rest }) => rest),
    invitees: invitees.map((invitee) => ({
      playerId: invitee.player_id,
      name: names.get(invitee.player_id) ?? invitee.player_id,
      invitedAt: invitee.invited_at,
      hasAnswered: answeredPlayerIds.has(invitee.player_id) && hasAnsweredDatePoll(poll.id, invitee.player_id),
      lastReminderAt: invitee.last_reminder_at,
    })),
    isInvitee: invitees.some((invitee) => invitee.player_id === viewerId),
    myResponses: invitees.some((invitee) => invitee.player_id === viewerId) && (!anonymous || poll.status === 'open')
      ? myResponses
      : null,
    canManage: canManageDatePoll(poll, event, viewerId, viewerRole),
  };
}

function requirePlayerId(req: Request, res: Response): string | undefined {
  const playerId = req.player?.id;
  if (!playerId) {
    res.status(401).json({ error: 'Anmeldung erforderlich.' });
    return undefined;
  }
  return playerId;
}

// Every route below first resolves the event, then materializes an expired
// round's lazy close (idempotent, cheap when nothing changed) and audits +
// broadcasts only when this exact request performed the transition.
function loadPollOr404(
  req: Request,
  res: Response,
  event: EventRow,
): DatePollRow | undefined {
  if (!req.player || !hasAcceptedParticipation(event.id, req.player.id)) {
    res.status(404).json({ error: 'Abstimmung nicht gefunden.' });
    return undefined;
  }
  const poll = getDatePollForEvent(event.id, req.params.pollId);
  if (!poll) {
    res.status(404).json({ error: 'Abstimmung nicht gefunden.' });
    return undefined;
  }
  const materialized = materializeExpiredPollIfNeeded(poll.id);
  if (!materialized) {
    res.status(404).json({ error: 'Abstimmung nicht gefunden.' });
    return undefined;
  }
  if (materialized.transitioned) finishLazyDeadlineClose(event, poll.id);
  return materialized.poll;
}

// One notifyPlayers call per recipient (not a single batch call sharing one
// topic) so each invitee's "Neue Abstimmung"/"wieder geöffnet" notice keys to
// its own deduplicated row (pollOpenTopicKey below) - see the comment there.
function notifyInvitees(
  groupId: string,
  eventId: string,
  playerIds: string[],
  title: string,
  body: string,
  url: string,
  pollId: string,
  expiresAt: number | null,
): void {
  for (const playerId of playerIds) {
    notifyPlayers(
      [playerId],
      { title, body, url },
      'direct',
      { key: pollOpenTopicKey(pollId, playerId), expiresAt },
      { groupId, eventId },
    );
  }
}

function pollReminderTopicKey(pollId: string, playerId?: string): string {
  const base = `${EVENT_POLL_REMINDER_TOPIC_PREFIX}${pollId}`;
  return playerId ? `${base}:${playerId}` : base;
}

function pollUpdateTopicPrefix(pollId: string): string {
  return `event-poll-updated:${pollId}`;
}

function pollUpdateTopicKey(pollId: string, playerId: string): string {
  return `${pollUpdateTopicPrefix(pollId)}:${playerId}`;
}

// Per-recipient like the reminder/update topics above (not one topic shared
// by every invitee): a shared row's title/body/resolved state applies to
// every attached recipient uniformly, so it cannot represent one invitee
// having answered, muted the event or missed a later reopen while another
// hasn't. It is still a deduplicated topic (isDeduplicatedPushTopic) per
// recipient, so a reopen refreshes that one player's existing row instead of
// leaving their earlier, now-resolved notice behind as a second entry.
function pollOpenTopicPrefix(pollId: string): string {
  return `${EVENT_POLL_OPEN_TOPIC_PREFIX}${pollId}`;
}

function pollOpenTopicKey(pollId: string, playerId: string): string {
  return `${pollOpenTopicPrefix(pollId)}:${playerId}`;
}

function notifyPreviouslyAnsweredPlayers(event: EventRow, poll: DatePollRow, playerIds: string[]): void {
  for (const playerId of playerIds) {
    notifyPlayers(
      [playerId],
      {
        title: 'Abstimmung ergänzt',
        body: `${event.name}: Bei „${poll.title}“ wurden neue Optionen ergänzt. Bitte prüfe deine Antwort.`,
        url: `/#eventPolls/${poll.id}`,
        type: 'event-poll-updated',
        targetId: poll.id,
      },
      'direct',
      { key: pollUpdateTopicKey(poll.id, playerId), expiresAt: poll.response_due_at },
      { groupId: event.group_id!, eventId: event.id },
    );
  }
}

function notifyPollReminder(event: EventRow, poll: DatePollRow, playerId: string): boolean {
  return Boolean(
    notifyPlayers(
      [playerId],
      {
        title: 'Erinnerung: Abstimmung',
        body: `${event.name}: Bitte stimme bei „${poll.title}“ ab.`,
        url: `/#eventPolls/${poll.id}`,
        type: 'event-poll-reminder',
        targetId: poll.id,
      },
      'direct',
      { key: pollReminderTopicKey(poll.id, playerId), expiresAt: poll.response_due_at },
      { groupId: event.group_id!, eventId: event.id },
    ),
  );
}

// Resolves a poll's outstanding notifications. With a playerId (someone just
// completed their response), only that player's own reminder, "Neue
// Abstimmung"/"wieder geöffnet" notice and any outstanding "Abstimmung
// ergänzt" notice resolve - the poll itself is still open for everyone else.
// Without one (group-wide close/delete), every player's copy of all three
// resolves together, so a returning player's notification center can mark
// the whole poll as no longer actionable.
function resolvePollNotifications(event: EventRow, pollId: string, playerId?: string): void {
  const scope = { groupId: event.group_id!, eventId: event.id };
  resolvePushTopic(pollReminderTopicKey(pollId, playerId), playerId === undefined, scope);
  if (playerId === undefined) {
    resolvePushTopic(pollOpenTopicPrefix(pollId), true, scope);
    resolvePushTopic(pollUpdateTopicPrefix(pollId), true, scope);
  } else {
    resolvePushTopic(pollOpenTopicKey(pollId, playerId), false, scope);
    resolvePushTopic(pollUpdateTopicKey(pollId, playerId), false, scope);
  }
}

// materializeExpiredPollIfNeeded() deliberately performs only the atomic
// status transition. Whichever request wins that transition must also perform
// every observable completion side effect; the background sweep will skip the
// now-closed row and therefore cannot repair an omitted audit, topic cleanup or
// realtime refresh later.
function finishLazyDeadlineClose(event: EventRow, pollId: string): void {
  writeAdminAudit({
    groupId: event.group_id ?? undefined,
    action: 'event_date_poll_deadline_closed',
    targetType: 'event_date_poll',
    targetId: pollId,
    details: { eventId: event.id },
  });
  resolvePollNotifications(event, pollId);
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
}

// GET /api/events/:eventId/polls
eventDatePollsRouter.get('/', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  if (!hasAcceptedParticipation(event.id, playerId)) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  const polls = getDatePolls(event.id).map((poll) => {
    const materialized = materializeExpiredPollIfNeeded(poll.id)!;
    if (materialized.transitioned) finishLazyDeadlineClose(event, poll.id);
    return materialized.poll;
  });
  res.json(polls.map((poll) => serializeDatePoll(poll, event, playerId, req.groupMembership?.role)));
});

// POST /api/events/:eventId/polls
eventDatePollsRouter.post('/', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  if (!hasAcceptedParticipation(event.id, playerId)) {
    return res.status(404).json({ error: 'Event nicht gefunden.' });
  }
  if (event.id === BASE_EVENT_ID) {
    return res.status(409).json({ error: 'Für den Bereich Allgemein können keine Abstimmungen gestartet werden.' });
  }
  if (event.status === 'cancelled' || event.status === 'ended') {
    return res.status(409).json({ error: 'Für ein abgesagtes oder beendetes Event kann keine Runde gestartet werden.' });
  }
  const {
    options,
    responseDueOn,
    note,
    inviteePlayerIds,
    topic = 'custom',
    decisionKey,
    previousPollId,
    title,
    responseMode = 'feasibility',
    maxSelections,
    anonymous = false,
  } = req.body ?? {};
  const topics: EventPollTopic[] = ['date_range', 'location', 'duration', 'budget', 'custom'];
  const responseModes: EventPollResponseMode[] = ['feasibility', 'single_choice', 'multiple_choice', 'rating_1_5'];
  if (!topics.includes(topic)) return res.status(400).json({ error: 'Ungültiges Abstimmungsthema.' });
  if (!responseModes.includes(responseMode)) return res.status(400).json({ error: 'Ungültiger Antwortmodus.' });
  if (typeof anonymous !== 'boolean') return res.status(400).json({ error: 'anonymous muss ein boolescher Wert sein.' });
  if (
    maxSelections !== undefined &&
    maxSelections !== null &&
    (!Number.isInteger(maxSelections) || maxSelections < 1)
  ) {
    return res.status(400).json({ error: 'maxSelections muss eine positive ganze Zahl sein.' });
  }
  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.trim().length > 100)) {
    return res.status(400).json({ error: 'title muss 1-100 Zeichen lang sein.' });
  }
  if (decisionKey !== undefined && (typeof decisionKey !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(decisionKey))) {
    return res.status(400).json({ error: 'decisionKey ist ungültig.' });
  }
  if (previousPollId !== undefined && (typeof previousPollId !== 'string' || !previousPollId.trim())) {
    return res.status(400).json({ error: 'previousPollId ist ungültig.' });
  }
  if (previousPollId !== undefined && decisionKey !== undefined) {
    return res.status(400).json({ error: 'Eine vorherige Runde darf nicht zusammen mit decisionKey angegeben werden.' });
  }
  if (!Array.isArray(options) || options.length === 0) {
    return res.status(400).json({ error: 'Mindestens eine Option ist erforderlich.' });
  }
  if (responseMode !== 'multiple_choice' && maxSelections !== undefined && maxSelections !== null) {
    return res.status(400).json({ error: 'maxSelections ist nur bei Mehrfachauswahl erlaubt.' });
  }
  if (responseMode === 'multiple_choice' && maxSelections !== undefined && maxSelections !== null && maxSelections > options.length) {
    return res.status(400).json({ error: 'maxSelections darf die Anzahl der Optionen nicht überschreiten.' });
  }
  const parsedOptions: Array<{
    startsOn?: string;
    endsOn?: string;
    label: string;
    description?: string | null;
    payload?: Record<string, unknown>;
  }> = [];
  for (const raw of options) {
    if (topic === 'date_range') {
      const startsOn = raw?.startsOn;
      const endsOn = raw?.endsOn;
      if (!isValidIsoDate(startsOn) || !isValidIsoDate(endsOn)) {
        return res.status(400).json({ error: 'Jeder Zeitraum benötigt gültige Kalenderdaten (Beginn/Ende).' });
      }
      if (endsOn < startsOn) return res.status(400).json({ error: 'Ein Zeitraum darf nicht rückwärts laufen.' });
      parsedOptions.push({ startsOn, endsOn, label: raw?.label?.trim() || `${startsOn} – ${endsOn}`, payload: raw?.payload });
      continue;
    }
    if (typeof raw?.label !== 'string' || !raw.label.trim() || raw.label.trim().length > 120) {
      return res.status(400).json({ error: 'Jede Option benötigt eine Bezeichnung mit höchstens 120 Zeichen.' });
    }
    if (raw.description !== undefined && raw.description !== null && (typeof raw.description !== 'string' || raw.description.length > 500)) {
      return res.status(400).json({ error: 'Eine Optionsbeschreibung darf höchstens 500 Zeichen lang sein.' });
    }
    if (raw.payload !== undefined && (typeof raw.payload !== 'object' || raw.payload === null || Array.isArray(raw.payload))) {
      return res.status(400).json({ error: 'payload muss ein Objekt sein.' });
    }
    const optionUrl = raw.payload?.url;
    if (
      optionUrl !== undefined &&
      (typeof optionUrl !== 'string' || optionUrl.length > 500 || !/^https?:\/\/[^\s]+$/i.test(optionUrl))
    ) {
      return res.status(400).json({ error: 'Ein Optionslink muss eine vollständige HTTP- oder HTTPS-Adresse sein.' });
    }
    parsedOptions.push({ label: raw.label.trim(), description: raw.description?.trim() || null, payload: raw.payload });
  }
  const duplicateKey = new Set<string>();
  for (const option of parsedOptions) {
    const key = topic === 'date_range' ? `${option.startsOn}:${option.endsOn}` : option.label.toLocaleLowerCase('de');
    if (duplicateKey.has(key)) {
      return res.status(400).json({ error: 'Optionen dürfen sich nicht duplizieren.' });
    }
    duplicateKey.add(key);
  }
  if (!isValidIsoDate(responseDueOn)) {
    return res.status(400).json({ error: 'responseDueOn muss ein gültiges Kalenderdatum sein.' });
  }
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.trim().length > 500)) {
    return res.status(400).json({ error: 'note darf höchstens 500 Zeichen lang sein.' });
  }

  if (inviteePlayerIds !== undefined) {
    return res.status(400).json({ error: 'Der Teilnehmerkreis wird automatisch aus den bestätigten Eventteilnehmern gebildet.' });
  }
  const inviteeIds = acceptedParticipantIds(event.id);
  let resolvedDecisionKey = decisionKey as string | undefined;
  if (previousPollId !== undefined) {
    const previousPoll = getDatePollForEvent(event.id, previousPollId);
    if (!previousPoll) return res.status(404).json({ error: 'Vorherige Abstimmungsrunde nicht gefunden.' });
    if (!canManageDatePoll(previousPoll, event, playerId, req.groupMembership?.role)) {
      return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann erneut abstimmen.' });
    }
    const latestRound = getDatePolls(event.id)
      .filter((poll) => poll.decision_key === previousPoll.decision_key)
      .sort((a, b) => b.round_number - a.round_number)[0];
    if (latestRound?.id !== previousPoll.id) {
      return res.status(409).json({ error: 'Eine neue Runde kann nur von der letzten Runde aus gestartet werden.' });
    }
    resolvedDecisionKey = previousPoll.decision_key;
  } else if (resolvedDecisionKey !== undefined) {
    const existingSeries = getDatePolls(event.id).find((poll) => poll.decision_key === resolvedDecisionKey);
    if (existingSeries && !canManageDatePoll(existingSeries, event, playerId, req.groupMembership?.role)) {
      return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann erneut abstimmen.' });
    }
  }

  const result = createDatePoll(
    event,
    {
      options: parsedOptions,
      responseDueOn,
      note: note?.trim() || null,
      inviteePlayerIds: inviteeIds,
      topic,
      decisionKey: resolvedDecisionKey,
      title: title?.trim(),
      responseMode,
      maxSelections: responseMode === 'multiple_choice' ? (maxSelections ?? null) : null,
      anonymous,
    },
    playerId,
  );
  if (!result.ok) {
    return res.status(result.code === 'conflict' ? 409 : 400).json({ error: result.error });
  }

  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_poll_created',
    targetType: 'event_poll',
    targetId: result.poll.id,
    details: { eventId: event.id, roundNumber: result.poll.round_number },
  });
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  notifyInvitees(
    event.group_id!,
    event.id,
    inviteeIds.filter((id) => id !== playerId),
    'Neue Abstimmung',
    `${event.name}: ${(title?.trim() || 'Neue Abstimmung')} — bitte antworten.`,
    `/#eventPolls/${result.poll.id}`,
    result.poll.id,
    result.poll.response_due_at,
  );
  res.status(201).json(serializeDatePoll(result.poll, event, playerId, req.groupMembership?.role));
});

// GET /api/events/:eventId/polls/:pollId
eventDatePollsRouter.get('/:pollId', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canReadPoll(event, playerId)) {
    return res.status(404).json({ error: 'Abstimmung nicht gefunden.' });
  }
  res.json(serializeDatePoll(poll, event, playerId, req.groupMembership?.role));
});

// PATCH /api/events/:eventId/polls/:pollId
eventDatePollsRouter.patch('/:pollId', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canManageDatePoll(poll, event, playerId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann die Runde bearbeiten.' });
  }
  const { title, note, responseDueOn, options } = req.body ?? {};
  const fields: Parameters<typeof updateDatePoll>[1] = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) {
      return res.status(400).json({ error: 'title muss 1-100 Zeichen lang sein.' });
    }
    fields.title = title.trim();
  }
  if (note !== undefined) {
    if (note !== null && (typeof note !== 'string' || note.trim().length > 500)) {
      return res.status(400).json({ error: 'note darf höchstens 500 Zeichen lang sein.' });
    }
    fields.note = typeof note === 'string' ? note.trim() || null : null;
  }
  if (responseDueOn !== undefined) {
    if (!isValidIsoDate(responseDueOn)) {
      return res.status(400).json({ error: 'responseDueOn muss ein gültiges Kalenderdatum sein.' });
    }
    fields.responseDueOn = responseDueOn;
  }
  if (options !== undefined) {
    if (!Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ error: 'Mindestens eine Option ist erforderlich.' });
    }
    const parsedOptions: NonNullable<Parameters<typeof updateDatePoll>[1]['options']> = [];
    for (const raw of options) {
      if (raw?.id !== undefined && (typeof raw.id !== 'string' || !raw.id)) {
        return res.status(400).json({ error: 'Eine bestehende Option benötigt eine gültige id.' });
      }
      if (typeof raw?.label !== 'string' || !raw.label.trim() || raw.label.trim().length > 120) {
        return res.status(400).json({ error: 'Jede Option benötigt eine Bezeichnung mit höchstens 120 Zeichen.' });
      }
      if (raw.description !== undefined && raw.description !== null && (typeof raw.description !== 'string' || raw.description.length > 500)) {
        return res.status(400).json({ error: 'Eine Optionsbeschreibung darf höchstens 500 Zeichen lang sein.' });
      }
      if (raw.payload !== undefined && (typeof raw.payload !== 'object' || raw.payload === null || Array.isArray(raw.payload))) {
        return res.status(400).json({ error: 'payload muss ein Objekt sein.' });
      }
      const optionUrl = raw.payload?.url;
      if (
        optionUrl !== undefined &&
        (typeof optionUrl !== 'string' || optionUrl.length > 500 || !/^https?:\/\/[^\s]+$/i.test(optionUrl))
      ) {
        return res.status(400).json({ error: 'Ein Optionslink muss eine vollständige HTTP- oder HTTPS-Adresse sein.' });
      }
      parsedOptions.push({
        ...(raw.id ? { id: raw.id } : {}),
        label: raw.label.trim(),
        description: raw.description?.trim() || null,
        payload: raw.payload ?? {},
      });
    }
    if (new Set(parsedOptions.map((option) => option.label.toLocaleLowerCase('de'))).size !== parsedOptions.length) {
      return res.status(400).json({ error: 'Optionen dürfen sich nicht duplizieren.' });
    }
    fields.options = parsedOptions;
  }
  const result = updateDatePoll(poll, fields);
  if (!result.ok) return res.status(result.code === 'invalid' ? 400 : 409).json({ error: result.error });

  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_poll_updated',
    targetType: 'event_poll',
    targetId: poll.id,
    details: { eventId: event.id, addedOptionCount: result.addedOptionCount },
  });
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  if (responseDueOn !== undefined) {
    // Keeps the "Neue Abstimmung" notification's own expiry in step with a
    // deadline extension - otherwise it would read as obsolete (and be
    // swept up by "Obsolete aufräumen") at the old deadline even though the
    // poll itself is still open and answerable. The per-recipient "Abstimmung
    // ergänzt" notices from an earlier option addition need the same sync:
    // without it, a deadline-only extension leaves their expiry at the old
    // date, so they'd read as obsolete while that recipient's response is
    // still incomplete.
    const pollScope = { groupId: event.group_id!, eventId: event.id };
    updatePushTopicExpiry(pollOpenTopicPrefix(poll.id), result.poll.response_due_at, pollScope, true);
    updatePushTopicExpiry(pollUpdateTopicPrefix(poll.id), result.poll.response_due_at, pollScope, true);
  }
  if (result.addedOptionCount > 0) {
    notifyPreviouslyAnsweredPlayers(event, result.poll, result.previouslyAnsweredPlayerIds);
  }
  res.json(serializeDatePoll(result.poll, event, playerId, req.groupMembership?.role));
});

// POST /api/events/:eventId/polls/:pollId/options
eventDatePollsRouter.post('/:pollId/options', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canManageDatePoll(poll, event, playerId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann Optionen ergänzen.' });
  }
  const { startsOn, endsOn, label, description, payload } = req.body ?? {};
  if (poll.topic === 'date_range') {
    if (!isValidIsoDate(startsOn) || !isValidIsoDate(endsOn)) {
      return res.status(400).json({ error: 'startsOn und endsOn müssen gültige Kalenderdaten sein.' });
    }
    if (endsOn < startsOn) return res.status(400).json({ error: 'Ein Zeitraum darf nicht rückwärts laufen.' });
  } else if (typeof label !== 'string' || !label.trim() || label.trim().length > 120) {
    return res.status(400).json({ error: 'label muss 1-120 Zeichen lang sein.' });
  }
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 500)) {
    return res.status(400).json({ error: 'description darf höchstens 500 Zeichen lang sein.' });
  }
  if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
    return res.status(400).json({ error: 'payload muss ein Objekt sein.' });
  }
  if (
    payload?.url !== undefined &&
    (typeof payload.url !== 'string' || payload.url.length > 500 || !/^https?:\/\/[^\s]+$/i.test(payload.url))
  ) {
    return res.status(400).json({ error: 'Ein Optionslink muss eine vollständige HTTP- oder HTTPS-Adresse sein.' });
  }

  const previouslyAnsweredPlayerIds = getDatePollInvitees(poll.id)
    .filter((invitee) => hasAnsweredDatePoll(poll.id, invitee.player_id))
    .map((invitee) => invitee.player_id);
  const result = addDatePollOption(poll, { startsOn, endsOn, label, description, payload });
  if (!result.ok) return res.status(result.code === 'not_open' ? 409 : 400).json({ error: result.error });

  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_date_poll_option_added',
    targetType: 'event_date_poll_option',
    targetId: result.option.id,
    details: { eventId: event.id, pollId: poll.id },
  });
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  const updatedPoll = getDatePollForEvent(event.id, poll.id)!;
  notifyPreviouslyAnsweredPlayers(event, updatedPoll, previouslyAnsweredPlayerIds);
  res.status(201).json(serializeDatePoll(updatedPoll, event, playerId, req.groupMembership?.role));
});

// PUT /api/events/:eventId/polls/:pollId/my-responses
eventDatePollsRouter.put('/:pollId/my-responses', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!hasAcceptedParticipation(event.id, playerId)) {
    return res.status(404).json({ error: 'Abstimmung nicht gefunden.' });
  }
  ensureOpenPollRoster(poll, event);
  if (!isDatePollInvitee(poll.id, playerId)) return res.status(404).json({ error: 'Abstimmung nicht gefunden.' });
  const { responses } = req.body ?? {};
  if (!Array.isArray(responses)) {
    return res.status(400).json({ error: 'responses muss ein Array sein.' });
  }
  for (const entry of responses) {
    if (typeof entry?.optionId !== 'string' || !RESPONSE_VALUES.includes(entry?.response)) {
      return res.status(400).json({ error: 'Jede Antwort benötigt optionId und einen gültigen Wert.' });
    }
  }
  const result = submitMyResponses(poll, playerId, responses);
  if (!result.ok) {
    return res.status(result.code === 'not_open' ? 409 : result.code === 'not_invitee' ? 404 : 400).json({ error: result.error });
  }
  if (hasAnsweredDatePoll(poll.id, playerId)) resolvePollNotifications(event, poll.id, playerId);
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  res.json(serializeDatePoll(getDatePollForEvent(event.id, poll.id)!, event, playerId, req.groupMembership?.role));
});

// POST /api/events/:eventId/polls/:pollId/reminders
eventDatePollsRouter.post('/:pollId/reminders', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canManageDatePoll(poll, event, playerId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann erinnern.' });
  }
  if (poll.status !== 'open') {
    return res.status(409).json({ error: 'Erinnerungen sind nur während einer offenen Runde möglich.' });
  }
  ensureOpenPollRoster(poll, event);
  const participantIds = new Set(acceptedParticipantIds(event.id));
  const candidates = reminderCandidates(poll.id).filter((candidate) => participantIds.has(candidate.playerId));
  const now = Date.now();
  const remindedPlayerIds: string[] = [];
  for (const candidate of candidates) {
    if (notifyPollReminder(event, poll, candidate.playerId)) remindedPlayerIds.push(candidate.playerId);
    markReminderSent(poll.id, candidate.playerId, now);
  }
  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_date_poll_reminder_sent',
    targetType: 'event_date_poll',
    targetId: poll.id,
    details: { eventId: event.id, playerCount: remindedPlayerIds.length },
  });
  res.json({ remindedPlayerIds });
});

// POST /api/events/:eventId/polls/:pollId/close
eventDatePollsRouter.post('/:pollId/close', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canManageDatePoll(poll, event, playerId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann schließen.' });
  }
  const result = closeDatePoll(poll);
  if (!result.ok) return res.status(409).json({ error: result.error });
  resolvePollNotifications(event, poll.id);

  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_date_poll_closed',
    targetType: 'event_date_poll',
    targetId: poll.id,
    details: { eventId: event.id },
  });
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  res.json(serializeDatePoll(result.poll, event, playerId, req.groupMembership?.role));
});

// POST /api/events/:eventId/polls/:pollId/reopen
eventDatePollsRouter.post('/:pollId/reopen', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canManageDatePoll(poll, event, playerId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann wieder öffnen.' });
  }
  const latestRound = getDatePolls(event.id)
    .filter((entry) => entry.decision_key === poll.decision_key)
    .sort((left, right) => right.round_number - left.round_number)[0];
  if (latestRound?.id !== poll.id) {
    return res.status(409).json({ error: 'Nur die letzte Runde einer Abstimmung kann wieder geöffnet werden.' });
  }
  const { responseDueOn } = req.body ?? {};
  if (responseDueOn !== undefined && !isValidIsoDate(responseDueOn)) {
    return res.status(400).json({ error: 'responseDueOn muss ein gültiges Kalenderdatum sein.' });
  }
  const result = reopenDatePoll(poll, responseDueOn);
  if (!result.ok) {
    return res.status(result.code === 'not_closed' ? 409 : 400).json({ error: result.error });
  }

  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_date_poll_reopened',
    targetType: 'event_date_poll',
    targetId: poll.id,
    details: { eventId: event.id },
  });
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  const invitees = acceptedParticipantIds(event.id).filter((id) => id !== playerId);
  notifyInvitees(
    event.group_id!,
    event.id,
    invitees,
    'Abstimmung',
    `${event.name}: Die Abstimmung wurde wieder geöffnet.`,
    `/#eventPolls/${poll.id}`,
    poll.id,
    result.poll.response_due_at,
  );
  res.json(serializeDatePoll(result.poll, event, playerId, req.groupMembership?.role));
});

// DELETE /api/events/:eventId/polls/:pollId
// A card represents one decision including all its rounds, so deleting it
// removes that complete series rather than leaving orphaned history behind.
eventDatePollsRouter.delete('/:pollId', resolveEventForPolls, (req, res) => {
  const event = req.groupResource as EventRow;
  const playerId = requirePlayerId(req, res);
  if (!playerId) return;
  const poll = loadPollOr404(req, res, event);
  if (!poll) return;
  if (!canManageDatePoll(poll, event, playerId, req.groupMembership?.role)) {
    return res.status(403).json({ error: 'Nur der Ersteller oder eine berechtigte Vertretung kann löschen.' });
  }
  const deletedPollIds = deleteDatePollSeries(poll);
  for (const deletedPollId of deletedPollIds) {
    // Resolves every player's reminder, "Neue Abstimmung"/"wieder geöffnet"
    // and "Abstimmung ergänzt" notice for this round in one call.
    resolvePollNotifications(event, deletedPollId);
  }

  writeAdminAudit({
    actorPlayerId: playerId,
    groupId: event.group_id ?? undefined,
    action: 'event_date_poll_deleted',
    targetType: 'event_date_poll',
    targetId: poll.id,
    details: { eventId: event.id, deletedPollIds },
  });
  broadcast(Events.eventsChanged, null, { groupId: event.group_id! });
  res.status(204).end();
});
